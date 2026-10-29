const fs = require('fs');
const os = require('os');
const path = require('path');

const setupProfileLauncher = require('../libs/profile-launcher.js');
const setupProxyChoices = require('../libs/proxy-choices.js');
const { isSafeClientVersion, listClientJars } = require('../libs/client-jars.js');

const JAGEX_MAIN = { accountId: '111', sessionId: 's-1', displayName: 'Zezima', profile: 'main', proxyIp: '' };
const JAGEX_ALT = { accountId: '222', sessionId: 's-2', displayName: 'Lynx', profile: 'alt', proxyIp: '10.0.0.2:1080:bob:hunter2' };
const SAVED_PROXIES = [
    { name: 'Germany', address: 'socks5://amy:secret@10.0.0.7:1080' },
    { name: '', address: '10.0.0.8:1080' },
    { name: 'Broken', address: 'not a proxy' }
];

function setup({ accounts = [JAGEX_MAIN, JAGEX_ALT], properties = {}, jars = ['2.6.43'], profiles = ['main', 'alt'], launchOutcome, deadlineMs } = {}) {
    const microbotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-launcher-'));
    fs.writeFileSync(path.join(microbotDir, 'accounts.json'), JSON.stringify(accounts));
    fs.writeFileSync(
        path.join(microbotDir, 'resource_versions.json'),
        JSON.stringify({ version_pref: '2.6.43', client_ram: '2g', proxyip: '10.0.0.9:1080', proxies: SAVED_PROXIES, ...properties })
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
        recordClientUse: jest.fn(async () => {}),
        proxyChoices: setupProxyChoices({ fs, path, microbotDir }),
        listProfiles: jest.fn(() => profiles),
        listVersions: () => listClientJars(fs, microbotDir).map((entry) => entry.version),
        deadlineMs
    };
    const { launchProfile, launchAccount, launchOptions, listProxies, startOptions } = setupProfileLauncher(deps);
    return { deps, events, launchProfile, launchAccount, launchOptions, listProxies, startOptions };
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
            proxy: { proxyIp: '' },
            ramPreference: '2g',
            hwidSpoof: true,
            account: JAGEX_MAIN
        });
        expect(deps.recordClientUse).toHaveBeenCalledWith('2.6.43');
        expect(deps.downloadClient).not.toHaveBeenCalled();
    });

    test('starts without a proxy unless one is chosen, even when one was last picked in the launcher', async () => {
        const { deps, launchProfile } = setup();
        await launchProfile('alt');
        expect(deps.launch.mock.calls[0][0].proxy).toEqual({ proxyIp: '' });
    });

    test('lists saved proxies by name and host only, and suggests the one each account logged in through', () => {
        const { listProxies } = setup();
        const { proxies, suggested } = listProxies();
        expect(proxies.map((proxy) => proxy.label)).toEqual([
            'Germany (10.0.0.7:1080)',
            '10.0.0.8:1080',
            '10.0.0.9:1080',
            '10.0.0.2:1080'
        ]);
        expect(JSON.stringify(proxies)).not.toMatch(/secret|hunter2|amy|bob/);
        expect(suggested).toEqual({ alt: proxies[3].id });
    });

    test('lists each Jagex account with its profile and the proxy it logged in through, without addresses', () => {
        const { listProxies } = setup();
        const { proxies, accounts } = listProxies();
        expect(accounts).toEqual([
            { accountId: '111', profile: 'main', proxyId: null },
            { accountId: '222', profile: 'alt', proxyId: proxies[3].id }
        ]);
        expect(JSON.stringify(accounts)).not.toMatch(/hunter2|bob|10\.0\.0/);
    });

    test('starts one Jagex account on its own profile even when another account shares it', async () => {
        const { deps, events, launchAccount } = setup({ accounts: [JAGEX_MAIN, { ...JAGEX_ALT, profile: 'main' }] });
        const onAccepted = jest.fn();

        await expect(launchAccount('222', { onAccepted })).resolves.toEqual({ started: true });

        expect(onAccepted).toHaveBeenCalledWith({ profile: 'main', account: 'Lynx' });
        expect(events).toEqual([
            ['credentials', '222'],
            ['launch', '222']
        ]);
        expect(deps.launch).toHaveBeenCalledWith({
            version: '2.6.43',
            proxy: { proxyIp: '' },
            ramPreference: '2g',
            hwidSpoof: true,
            account: { ...JAGEX_ALT, profile: 'main' }
        });
    });

    test('starts a Jagex account through the chosen proxy', async () => {
        const { deps, launchAccount, listProxies } = setup();
        const germany = listProxies().proxies[0];
        await launchAccount('111', { proxyId: germany.id });
        expect(deps.launch.mock.calls[0][0].proxy).toEqual({ proxyIp: 'socks5://amy:secret@10.0.0.7:1080' });
    });

    test('refuses a Jagex account that is no longer logged in', async () => {
        const { deps, launchAccount } = setup();
        const outcome = await launchAccount('999');
        expect(outcome.problem.kind).toBe('unknown-client');
        expect(deps.launch).not.toHaveBeenCalled();
    });

    test('looks the Jagex account up again when its turn comes', async () => {
        const { deps, launchAccount } = setup();
        const outcome = await launchAccount('222', {
            stillWanted: () => {
                fs.writeFileSync(path.join(deps.microbotDir, 'accounts.json'), JSON.stringify([JAGEX_MAIN]));
                return true;
            }
        });
        expect(outcome.problem.kind).toBe('unknown-client');
        expect(deps.writeCredentials).not.toHaveBeenCalled();
        expect(deps.launch).not.toHaveBeenCalled();
    });

    test('starts through the chosen proxy, looked up on this PC', async () => {
        const { deps, launchProfile, listProxies } = setup();
        const germany = listProxies().proxies[0];
        await launchProfile('main', { proxyId: germany.id });
        expect(deps.launch.mock.calls[0][0].proxy).toEqual({ proxyIp: 'socks5://amy:secret@10.0.0.7:1080' });
        const alt = listProxies().suggested.alt;
        await launchProfile('alt', { proxyId: alt });
        expect(deps.launch.mock.calls[1][0].proxy).toEqual({ proxyIp: '10.0.0.2:1080:bob:hunter2' });
    });

    test('refuses a proxy id it does not know, rather than starting without one', async () => {
        const { deps, launchProfile } = setup();
        const outcome = await launchProfile('main', { proxyId: 'socks5://evil:1080' });
        expect(outcome.problem.kind).toBe('unknown-proxy');
        expect(deps.launch).not.toHaveBeenCalled();
        expect(deps.writeCredentials).not.toHaveBeenCalled();
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

    test('a launch that never finishes is given up on, and the next one still runs', async () => {
        const { launchProfile } = setup({
            deadlineMs: 50,
            launchOutcome: (options) => (options.account.accountId === '111' ? new Promise(() => {}) : { started: true })
        });
        const stuck = launchProfile('main');
        const next = launchProfile('alt');
        await expect(stuck).resolves.toMatchObject({ problem: { kind: 'timed-out' } });
        await expect(next).resolves.toEqual({ started: true });
    });

    test('a launch given up on during its download never writes the login file or starts later', async () => {
        let finishDownload;
        const { deps, events, launchProfile } = setup({ jars: [], deadlineMs: 50 });
        deps.downloadClient.mockImplementationOnce(() => new Promise((resolve) => (finishDownload = resolve)));
        const stuck = launchProfile('main');
        await expect(stuck).resolves.toMatchObject({ problem: { kind: 'timed-out' } });
        await expect(launchProfile('alt')).resolves.toEqual({ started: true });
        finishDownload({ success: true });
        await new Promise((resolve) => setImmediate(resolve));
        expect(events).toEqual([
            ['credentials', '222'],
            ['launch', '222']
        ]);
    });

    test('refuses more launches while three are already waiting', async () => {
        let release;
        const held = new Promise((resolve) => (release = resolve));
        const { deps, launchProfile } = setup({ launchOutcome: () => held });
        const waiting = [launchProfile('main'), launchProfile('alt'), launchProfile('main')];
        const refused = await launchProfile('alt');
        expect(refused.problem.kind).toBe('too-many-launches');
        release({ started: true });
        await Promise.all(waiting);
        await expect(launchProfile('alt')).resolves.toEqual({ started: true });
        expect(deps.launch).toHaveBeenCalledTimes(4);
    });

    test('a start that is no longer wanted when its turn comes never writes the login or starts', async () => {
        const { deps, launchProfile } = setup();
        let wanted = false;
        await expect(launchProfile('main', { stillWanted: () => wanted })).resolves.toMatchObject({ problem: { kind: 'disabled' } });
        expect(deps.writeCredentials).not.toHaveBeenCalled();
        expect(deps.launch).not.toHaveBeenCalled();
        wanted = true;
        await expect(launchProfile('main', { stillWanted: () => wanted })).resolves.toEqual({ started: true });
    });

    test('a start turned off while its client downloads stops before writing the login', async () => {
        let wanted = true;
        const { deps, launchProfile } = setup({ jars: [] });
        deps.downloadClient.mockImplementationOnce(async () => {
            wanted = false;
            return { success: true };
        });
        await expect(launchProfile('main', { stillWanted: () => wanted })).resolves.toMatchObject({ problem: { kind: 'disabled' } });
        expect(deps.writeCredentials).not.toHaveBeenCalled();
        expect(deps.launch).not.toHaveBeenCalled();
    });

    test('a broken accounts file counts as no Jagex accounts', async () => {
        const { deps, launchProfile } = setup();
        fs.writeFileSync(path.join(deps.microbotDir, 'accounts.json'), '{oops');
        await launchProfile('main');
        expect(deps.launch).toHaveBeenCalledWith(expect.objectContaining({ noJagexProfile: 'main' }));
        expect(deps.log.warn).toHaveBeenCalled();
    });
});

describe('starting with options chosen on the dashboard', () => {
    const readFile = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

    async function prepare(options = {}) {
        const context = setup(options);
        const reported = await context.startOptions({ alt: 'link-2' }, context.listProxies().proxies);
        const profileId = (name) => context.deps.proxyChoices.profileIdFor(name);
        const accountId = (id) => context.deps.proxyChoices.accountIdFor(id);
        const choose = (overrides = {}) => ({
            accountId: accountId('111'),
            profileId: profileId('main'),
            channel: 'stable',
            version: '2.6.43',
            ram: '4g',
            hwidSpoof: false,
            proxyId: null,
            ...overrides
        });
        return { ...context, reported, profileId, accountId, choose };
    }

    test('reports what Play would use, with ids that match the launch lookups', async () => {
        const { reported, profileId, accountId, listProxies } = await prepare({
            properties: { selected_account: '222', hwid_spoof: 'false' }
        });
        const altProxy = listProxies().suggested.alt;
        expect(reported.accounts).toEqual([
            { id: accountId('111'), label: 'Zezima', profileId: profileId('main'), proxyId: null, clientLinkId: null },
            { id: accountId('222'), label: 'Lynx', profileId: profileId('alt'), proxyId: altProxy, clientLinkId: null }
        ]);
        expect(reported.profiles).toEqual([
            { id: profileId('default'), label: 'Default', clientLinkId: null },
            { id: profileId('main'), label: 'main', clientLinkId: null },
            { id: profileId('alt'), label: 'alt', clientLinkId: 'link-2' }
        ]);
        expect(reported.versions).toEqual(['2.6.43']);
        expect(reported.latestVersion).toBe('2.6.44');
        expect(reported.defaults).toEqual({
            accountId: accountId('222'),
            profileId: profileId('alt'),
            channel: 'stable',
            version: '2.6.43',
            ram: '2g',
            hwidSpoof: false,
            proxyId: altProxy
        });
        expect(reported.accounts[0].id).toMatch(/^a_[A-Za-z0-9_-]{22}$/);
        expect(reported.profiles[0].id).toMatch(/^p_[A-Za-z0-9_-]{22}$/);
    });

    test('looks the latest version up at most every few minutes, and still reports when it cannot', async () => {
        const { deps, startOptions } = setup();
        await startOptions();
        await startOptions();
        expect(deps.fetchLatestVersion).toHaveBeenCalledTimes(1);
        const offline = setup();
        offline.deps.fetchLatestVersion.mockRejectedValue(new Error('offline'));
        await expect(offline.startOptions()).resolves.toMatchObject({ latestVersion: null, versions: ['2.6.43'] });
    });

    test('starts the chosen account with an explicit stable version and the chosen settings', async () => {
        const { deps, events, launchOptions, choose } = await prepare();
        const accepted = jest.fn();
        await expect(launchOptions(choose(), { onAccepted: accepted })).resolves.toEqual({ started: true });
        expect(accepted).toHaveBeenCalledWith({ profile: 'main', account: 'Zezima' });
        expect(events).toEqual([
            ['credentials', '111'],
            ['launch', '111']
        ]);
        expect(deps.launch).toHaveBeenCalledWith({
            version: '2.6.43',
            proxy: { proxyIp: '' },
            ramPreference: '4g',
            hwidSpoof: false,
            account: JAGEX_MAIN
        });
        expect(deps.recordClientUse).toHaveBeenCalledWith('2.6.43');
        expect(deps.downloadClient).not.toHaveBeenCalled();
    });

    test('uses the chosen profile and proxy for this start only, without saving them', async () => {
        const { deps, launchOptions, choose, profileId, listProxies } = await prepare();
        const germany = listProxies().proxies[0];
        const before = ['accounts.json', 'resource_versions.json'].map((name) => readFile(deps.microbotDir, name));
        await launchOptions(choose({ profileId: profileId('alt'), proxyId: germany.id }));
        expect(deps.launch.mock.calls[0][0].account).toEqual({ ...JAGEX_MAIN, profile: 'alt' });
        expect(deps.launch.mock.calls[0][0].proxy).toEqual({ proxyIp: 'socks5://amy:secret@10.0.0.7:1080' });
        expect(deps.writeCredentials).toHaveBeenCalledWith(JAGEX_MAIN);
        expect(['accounts.json', 'resource_versions.json'].map((name) => readFile(deps.microbotDir, name))).toEqual(before);
        expect(fs.existsSync(path.join(deps.microbotDir, 'non-jagex-preferred-profile.json'))).toBe(false);
    });

    test('two accounts on one profile can each be started', async () => {
        const { deps, launchOptions, choose, accountId } = await prepare({ accounts: [JAGEX_MAIN, { ...JAGEX_ALT, profile: 'main' }] });
        await expect(launchOptions(choose({ accountId: accountId('222') }))).resolves.toEqual({ started: true });
        expect(deps.launch.mock.calls[0][0].account.accountId).toBe('222');
    });

    test('starts the latest stable client when no version is chosen, downloading it if needed', async () => {
        const { deps, launchOptions, choose } = await prepare();
        await launchOptions(choose({ version: null }));
        expect(deps.downloadClient).toHaveBeenCalledWith('2.6.44');
        expect(deps.launch.mock.calls[0][0].version).toBe('2.6.44');
    });

    test('downloads the latest version when it is chosen by number but not downloaded yet', async () => {
        const { deps, launchOptions, choose } = await prepare();
        await expect(launchOptions(choose({ version: '2.6.44' }))).resolves.toEqual({ started: true });
        expect(deps.downloadClient).toHaveBeenCalledWith('2.6.44');
    });

    test('starts the nightly build when Nightly is chosen, even when the launcher is on Stable', async () => {
        const { deps, launchOptions, choose } = await prepare();
        await launchOptions(choose({ channel: 'nightly', version: null }));
        expect(deps.prepareNightly).toHaveBeenCalled();
        expect(deps.launch.mock.calls[0][0].version).toBe('nightly-20261025');
        expect(deps.recordClientUse).not.toHaveBeenCalled();
    });

    test('starts without a Jagex account on the chosen profile when no account is chosen', async () => {
        const { deps, launchOptions, choose, profileId } = await prepare();
        const accepted = jest.fn();
        await launchOptions(choose({ accountId: null, profileId: profileId('alt'), hwidSpoof: true }), { onAccepted: accepted });
        expect(accepted).toHaveBeenCalledWith({ profile: 'alt', account: null });
        expect(deps.writeCredentials).not.toHaveBeenCalled();
        expect(deps.launch).toHaveBeenCalledWith({
            version: '2.6.43',
            proxy: { proxyIp: '' },
            ramPreference: '4g',
            hwidSpoof: true,
            noJagexProfile: 'alt'
        });
    });

    test.each([
        ['an account that is gone', { accountId: 'a_gone' }, /Jagex account/],
        ['an account id that is not text', { accountId: 7 }, /Jagex account/],
        ['a profile that is gone', { profileId: 'p_gone' }, /profile/],
        ['a missing profile', { profileId: undefined }, /profile/],
        ['an unknown channel', { channel: 'beta' }, /Stable or Nightly/],
        ['a version on Nightly', { channel: 'nightly', version: '2.6.43' }, /Stable channel/],
        ['an unsafe version', { version: '../../evil' }, /version/],
        ['a custom version name', { version: '2.6.43-dev' }, /version/],
        ['a RAM amount not offered', { ram: '64g' }, /RAM/],
        ['RAM that is not text', { ram: 4 }, /RAM/],
        ['a spoof choice that is not on or off', { hwidSpoof: 'true' }, /hardware IDs/],
        ['a proxy that is gone', { proxyId: 'socks5://evil:1080' }, /proxy/],
        ['a proxy id that is not text', { proxyId: { address: 'x' } }, /proxy/]
    ])('refuses %s without starting anything', async (_name, overrides, message) => {
        const { deps, launchOptions, choose } = await prepare();
        const accepted = jest.fn();
        const outcome = await launchOptions(choose(overrides), { onAccepted: accepted });
        expect(outcome.problem.kind).toBe('unknown-option');
        expect(outcome.problem.message).toMatch(message);
        expect(accepted).not.toHaveBeenCalled();
        expect(deps.launch).not.toHaveBeenCalled();
        expect(deps.writeCredentials).not.toHaveBeenCalled();
        expect(deps.downloadClient).not.toHaveBeenCalled();
    });

    test('refuses options that are not an object', async () => {
        const { deps, launchOptions } = await prepare();
        for (const options of ['start', [], 7]) {
            await expect(launchOptions(options)).resolves.toMatchObject({ problem: { kind: 'unknown-option' } });
        }
        expect(deps.launch).not.toHaveBeenCalled();
    });

    test('refuses an older version that is no longer downloaded, rather than fetching it', async () => {
        const { deps, launchOptions, choose } = await prepare();
        const outcome = await launchOptions(choose({ version: '2.6.30' }));
        expect(outcome.problem).toMatchObject({ kind: 'unknown-option', message: 'Client version 2.6.30 is no longer downloaded on this PC.' });
        expect(deps.downloadClient).not.toHaveBeenCalled();
        expect(deps.launch).not.toHaveBeenCalled();
    });

    test('checks the choices again when its turn comes', async () => {
        let release;
        const held = new Promise((resolve) => (release = resolve));
        const { deps, launchOptions, choose } = await prepare({ launchOutcome: (options) => (options.account?.accountId === '222' ? held : { started: true }) });
        const first = launchOptions(choose({ accountId: deps.proxyChoices.accountIdFor('222') }));
        const second = launchOptions(choose());
        await new Promise((resolve) => setImmediate(resolve));
        fs.writeFileSync(path.join(deps.microbotDir, 'accounts.json'), JSON.stringify([JAGEX_ALT]));
        release({ started: true });
        await expect(first).resolves.toEqual({ started: true });
        await expect(second).resolves.toMatchObject({ problem: { kind: 'unknown-option' } });
        expect(deps.launch).toHaveBeenCalledTimes(1);
    });

    test('shares the launch queue limit with profile starts', async () => {
        let release;
        const held = new Promise((resolve) => (release = resolve));
        const { launchProfile, launchOptions, choose } = await prepare({ launchOutcome: () => held });
        const waiting = [launchProfile('main'), launchOptions(choose()), launchProfile('alt')];
        const accepted = jest.fn();
        await expect(launchOptions(choose(), { onAccepted: accepted })).resolves.toMatchObject({ problem: { kind: 'too-many-launches' } });
        expect(accepted).not.toHaveBeenCalled();
        release({ started: true });
        await Promise.all(waiting);
    });

    test('a start no longer wanted when its turn comes never writes the login or starts', async () => {
        const { deps, launchOptions, choose } = await prepare();
        await expect(launchOptions(choose(), { stillWanted: () => false })).resolves.toMatchObject({ problem: { kind: 'disabled' } });
        expect(deps.writeCredentials).not.toHaveBeenCalled();
        expect(deps.launch).not.toHaveBeenCalled();
    });

    test('gives up on a start that never finishes', async () => {
        const { launchOptions, choose } = await prepare({ deadlineMs: 50, launchOutcome: () => new Promise(() => {}) });
        await expect(launchOptions(choose())).resolves.toMatchObject({ problem: { kind: 'timed-out' } });
    });
});
