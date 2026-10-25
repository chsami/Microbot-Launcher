const fs = require('fs');
const os = require('os');
const path = require('path');

const setupProfileLauncher = require('../libs/profile-launcher.js');
const { isSafeClientVersion } = require('../libs/client-jars.js');

const JAGEX_MAIN = { accountId: '111', sessionId: 's-1', displayName: 'Zezima', profile: 'main', proxyIp: '' };
const JAGEX_ALT = { accountId: '222', sessionId: 's-2', displayName: 'Lynx', profile: 'alt', proxyIp: '10.0.0.2:1080' };

function setup({ accounts = [JAGEX_MAIN, JAGEX_ALT], properties = {}, jars = ['2.6.43'], launchOutcome } = {}) {
    const microbotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-launcher-'));
    fs.writeFileSync(path.join(microbotDir, 'accounts.json'), JSON.stringify(accounts));
    fs.writeFileSync(
        path.join(microbotDir, 'resource_versions.json'),
        JSON.stringify({ version_pref: '2.6.43', client_ram: '2g', proxyip: '10.0.0.9:1080', ...properties })
    );
    jars.forEach((version) => fs.writeFileSync(path.join(microbotDir, `microbot-${version}.jar`), ''));

    const events = [];
    const deps = {
        fs,
        path,
        log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        microbotDir,
        isSafeClientVersion,
        launch: jest.fn(async (options) => {
            events.push(['launch', options.account?.accountId || options.noJagexProfile]);
            return launchOutcome ? launchOutcome(options) : { started: true };
        }),
        writeCredentials: jest.fn((account) => events.push(['credentials', account.accountId])),
        downloadClient: jest.fn(async () => ({ success: true })),
        prepareNightly: jest.fn(async () => ({ info: { build: 'nightly-20261025' } })),
        fetchLatestVersion: jest.fn(async () => '2.6.44'),
        recordClientUse: jest.fn(async () => {})
    };
    const { launchProfile } = setupProfileLauncher(deps);
    return { deps, events, launchProfile };
}

describe('launching a profile without the launcher window', () => {
    test('starts the Jagex account that uses the profile, with the saved settings', async () => {
        const { deps, events, launchProfile } = setup();
        await expect(launchProfile('main')).resolves.toEqual({ started: true });
        expect(events).toEqual([
            ['credentials', '111'],
            ['launch', '111']
        ]);
        expect(deps.launch).toHaveBeenCalledWith({
            version: '2.6.43',
            proxy: { proxyIp: '10.0.0.9:1080' },
            ramPreference: '2g',
            hwidSpoof: true,
            account: JAGEX_MAIN
        });
        expect(deps.recordClientUse).toHaveBeenCalledWith('2.6.43');
        expect(deps.downloadClient).not.toHaveBeenCalled();
    });

    test("uses the account's own proxy before the one last picked in the launcher", async () => {
        const { deps, launchProfile } = setup();
        await launchProfile('alt');
        expect(deps.launch.mock.calls[0][0].proxy).toEqual({ proxyIp: '10.0.0.2:1080' });
    });

    test('keeps hardware ID spoofing off when it was switched off', async () => {
        const { deps, launchProfile } = setup({ properties: { hwid_spoof: 'false' } });
        await launchProfile('main');
        expect(deps.launch.mock.calls[0][0].hwidSpoof).toBe(false);
    });

    test('a profile no Jagex account uses starts without one', async () => {
        const { deps, launchProfile } = setup();
        await launchProfile('ironman');
        expect(deps.writeCredentials).not.toHaveBeenCalled();
        expect(deps.launch).toHaveBeenCalledWith(expect.objectContaining({ noJagexProfile: 'ironman' }));
        expect(deps.launch.mock.calls[0][0].account).toBeUndefined();
    });

    test('accounts without a profile count as the default profile', async () => {
        const { deps, launchProfile } = setup({ accounts: [{ ...JAGEX_MAIN, profile: undefined }] });
        await launchProfile('');
        expect(deps.launch.mock.calls[0][0].account.accountId).toBe('111');
    });

    test('refuses to guess when two Jagex accounts share the profile', async () => {
        const { deps, launchProfile } = setup({ accounts: [JAGEX_MAIN, { ...JAGEX_ALT, profile: 'main' }] });
        const outcome = await launchProfile('main');
        expect(outcome.problem.kind).toBe('ambiguous-profile');
        expect(deps.launch).not.toHaveBeenCalled();
        expect(deps.writeCredentials).not.toHaveBeenCalled();
    });

    test('downloads the selected version when it is missing', async () => {
        const { deps, launchProfile } = setup({ jars: [] });
        await launchProfile('main');
        expect(deps.downloadClient).toHaveBeenCalledWith('2.6.43');
        expect(deps.launch).toHaveBeenCalled();
    });

    test('reports a failed download instead of launching', async () => {
        const { deps, launchProfile } = setup({ jars: [] });
        deps.downloadClient.mockResolvedValue({ error: 'offline' });
        const outcome = await launchProfile('main');
        expect(outcome).toEqual({ problem: { kind: 'download-failed', title: 'Download Failed', message: 'offline' } });
        expect(deps.launch).not.toHaveBeenCalled();
    });

    test('falls back to the latest client when no version was ever picked', async () => {
        const { deps, launchProfile } = setup({ properties: { version_pref: '0.0.0' }, jars: [] });
        await launchProfile('main');
        expect(deps.downloadClient).toHaveBeenCalledWith('2.6.44');
        expect(deps.launch.mock.calls[0][0].version).toBe('2.6.44');
    });

    test('uses the nightly build when the launcher is on Nightly', async () => {
        const { deps, launchProfile } = setup({ properties: { client_channel: 'nightly' } });
        await launchProfile('main');
        expect(deps.prepareNightly).toHaveBeenCalled();
        expect(deps.launch.mock.calls[0][0].version).toBe('nightly-20261025');
        expect(deps.recordClientUse).not.toHaveBeenCalled();
    });

    test('refuses an unsafe saved version', async () => {
        const { deps, launchProfile } = setup({ properties: { version_pref: '../../evil' } });
        const outcome = await launchProfile('main');
        expect(outcome.problem.kind).toBe('version-unavailable');
        expect(deps.launch).not.toHaveBeenCalled();
    });

    test('refuses a profile name with control characters', async () => {
        const { deps, launchProfile } = setup();
        const outcome = await launchProfile('main\n-evil');
        expect(outcome.problem.kind).toBe('invalid-profile');
        expect(deps.launch).not.toHaveBeenCalled();
    });

    test('starts one client at a time, so each reads its own login file', async () => {
        let release;
        const firstDone = new Promise((resolve) => (release = resolve));
        const { events, launchProfile } = setup({
            launchOutcome: (options) => (options.account.accountId === '111' ? firstDone : { started: true })
        });
        const first = launchProfile('main');
        const second = launchProfile('alt');
        await new Promise((resolve) => setImmediate(resolve));
        expect(events).toEqual([
            ['credentials', '111'],
            ['launch', '111']
        ]);
        release({ started: true });
        await Promise.all([first, second]);
        expect(events).toEqual([
            ['credentials', '111'],
            ['launch', '111'],
            ['credentials', '222'],
            ['launch', '222']
        ]);
    });

    test('a failure does not block the next launch', async () => {
        const { deps, launchProfile } = setup();
        deps.launch.mockRejectedValueOnce(new Error('boom'));
        const failed = await launchProfile('main');
        expect(failed.problem).toMatchObject({ kind: 'launch-failed', message: 'boom' });
        await expect(launchProfile('alt')).resolves.toEqual({ started: true });
    });

    test('a broken accounts file counts as no Jagex accounts', async () => {
        const { deps, launchProfile } = setup();
        fs.writeFileSync(path.join(deps.microbotDir, 'accounts.json'), '{oops');
        await launchProfile('main');
        expect(deps.launch).toHaveBeenCalledWith(expect.objectContaining({ noJagexProfile: 'main' }));
        expect(deps.log.warn).toHaveBeenCalled();
    });
});
