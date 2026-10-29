const fs = require('fs');
const os = require('os');
const path = require('path');

const setupRemoteStart = require('../libs/remote-start.js');

const TOKEN = `mbl_${'a'.repeat(43)}`;
const OTHER_TOKEN = `mbl_${'b'.repeat(43)}`;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const waitFor = async (predicate) => {
    for (let i = 0; i < 200 && !predicate(); i += 1) await flush();
};

function setup({
    settings = {},
    signedIn = true,
    linked = { main: 'link-1', alt: 'link-2' },
    backgroundError,
    proxies = [{ id: 'p1', label: 'Germany (10.0.0.7:1080)' }],
    startOptions,
    accounts,
    accountLinks = {}
} = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-start-'));
    const settingsFile = path.join(dir, 'launcher-settings.json');
    const launcherFile = path.join(dir, 'launcher-link.dat');
    fs.writeFileSync(settingsFile, JSON.stringify(settings));

    const syncs = [];
    const results = [];
    const pending = [];
    const axios = {
        post: jest.fn((url, body, options) => {
            if (url.includes('/result')) {
                results.push({ url, body, token: options.headers['X-Microbot-Launcher-Token'] });
                return Promise.resolve({ status: 202 });
            }
            syncs.push({ url, body, token: options.headers['X-Microbot-Launcher-Token'] });
            const next = pending.shift();
            if (next) return next();
            return new Promise((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ERR_CANCELED' })));
            });
        })
    };
    const listeners = new Set();
    let email = signedIn ? 'player@example.com' : null;
    let tokens = [TOKEN, OTHER_TOKEN];
    const auth = {
        baseUrl: 'https://api.test',
        email: () => email,
        request: jest.fn(async () => ({ data: { id: 'launcher-1', token: tokens.shift() } })),
        onChange: (listener) => listeners.add(listener)
    };
    const handlers = {};
    const backgroundListeners = [];
    const background = {
        enable: jest.fn(() => (backgroundError ? { error: backgroundError } : {})),
        onDisabled: (listener) => backgroundListeners.push(listener)
    };
    const trayOff = () => backgroundListeners.forEach((listener) => listener());
    const launchProfile = jest.fn(async () => ({ started: true }));
    const launchOptions = jest.fn(async (_options, { onAccepted }) => {
        onAccepted({ profile: 'alt', account: 'Zezima' });
        return { started: true };
    });
    const launchAccount = jest.fn(async (_accountId, { onAccepted }) => {
        onAccepted({ profile: 'main', account: 'Lynx' });
        return { started: true };
    });
    const linkedAccounts = jest.fn((list) => {
        const linked = {};
        list.forEach((account) => {
            if (accountLinks[account.accountId]) linked[account.accountId] = accountLinks[account.accountId];
        });
        return linked;
    });
    const notify = jest.fn();
    const log = { info: jest.fn(), warn: jest.fn() };
    const remote = setupRemoteStart({
        ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
        log,
        fs,
        safeStorage: {
            isEncryptionAvailable: () => true,
            getSelectedStorageBackend: () => 'gnome_libsecret',
            encryptString: (value) => Buffer.from(`enc:${value}`),
            decryptString: (buffer) => buffer.toString().slice(4)
        },
        axios,
        auth,
        alerts: { linkedProfiles: () => linked, linkedAccounts },
        background,
        launchProfile,
        launchAccount,
        launchOptions,
        listProxies: () => ({ proxies, suggested: { alt: 'p1' }, ...(accounts ? { accounts } : {}) }),
        startOptions,
        settingsFile,
        launcherFile,
        launcherName: 'Gaming\nPC',
        version: '3.2.21',
        notify,
        sleep: () => flush(),
        retryMinMs: 1
    });
    const respond = (data) => pending.push(() => Promise.resolve({ data }));
    const fail = (status) => pending.push(() => Promise.reject(Object.assign(new Error(`HTTP ${status}`), { response: { status } })));
    const signOut = () => {
        email = null;
        listeners.forEach((listener) => listener(null));
    };
    const signIn = () => {
        email = 'player@example.com';
        listeners.forEach((listener) => listener({ email }));
    };
    const readSettings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return { remote, handlers, axios, auth, syncs, results, respond, fail, background, launchProfile, launchAccount, launchOptions, linkedAccounts, notify, log, launcherFile, readSettings, signOut, signIn, trayOff };
}

describe('starting clients from the dashboard', () => {
    test('is off by default and does not contact the dashboard', async () => {
        const { remote, axios, auth, handlers } = setup();
        remote.start();
        await flush();
        expect(axios.post).not.toHaveBeenCalled();
        expect(auth.request).not.toHaveBeenCalled();
        await expect(handlers['remote-start:status']()).resolves.toEqual({ enabled: false, signedIn: true, available: true });
    });

    test('needs a Microbot sign-in to switch on', async () => {
        const { handlers, background, readSettings } = setup({ signedIn: false });
        const result = await handlers['remote-start:set-enabled']({}, true);
        expect(result).toEqual({ error: 'Sign in to your Microbot account first.', enabled: false });
        expect(background.enable).not.toHaveBeenCalled();
        expect(readSettings().remoteStartFor).toBeUndefined();
    });

    test('switching on keeps the launcher in the tray, links it once and listens', async () => {
        const { handlers, background, auth, syncs, readSettings, launcherFile } = setup();
        await expect(handlers['remote-start:set-enabled']({}, true)).resolves.toEqual({ enabled: true });
        expect(background.enable).toHaveBeenCalled();
        expect(readSettings().remoteStartFor).toBe('player@example.com');
        await waitFor(() => syncs.length === 1);

        expect(auth.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'post', path: '/api/launchers', data: { name: 'GamingPC' } }));
        expect(fs.readFileSync(launcherFile, 'utf8')).toMatch(/^enc:/);
        if (process.platform !== 'win32') expect(fs.statSync(launcherFile).mode & 0o777).toBe(0o600);
        expect(syncs[0].url).toBe('https://api.test/api/launchers/sync?wait=25');
        expect(syncs[0].token).toBe(TOKEN);
        expect(syncs[0].body).toEqual({
            startAllowed: true,
            version: '3.2.21',
            clients: [
                { clientLinkId: 'link-1', suggestedProxyId: null },
                { clientLinkId: 'link-2', suggestedProxyId: 'p1' }
            ],
            proxies: [{ id: 'p1', label: 'Germany (10.0.0.7:1080)' }]
        });
    });

    test('will not switch on when the tray cannot be turned on', async () => {
        const { handlers, readSettings, syncs } = setup({ backgroundError: 'Another Microbot Launcher is already running in the background.' });
        const result = await handlers['remote-start:set-enabled']({}, true);
        expect(result.enabled).toBe(false);
        expect(result.error).toMatch(/already running/);
        expect(readSettings().remoteStartFor).toBeUndefined();
        await flush();
        expect(syncs).toHaveLength(0);
    });

    test('starts the profile behind the client link with the chosen proxy and reports it', async () => {
        const { remote, respond, launchProfile, results, notify } = setup({ settings: { remoteStartFor: 'player@example.com' } });
        respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: 'link-2', proxyId: 'p1' }] });
        remote.start();
        await waitFor(() => results.length === 1);

        expect(launchProfile).toHaveBeenCalledWith('alt', expect.objectContaining({ proxyId: 'p1' }));
        expect(notify).toHaveBeenCalledWith('Starting a client from the dashboard', 'Profile: alt');
        expect(results[0]).toEqual({
            url: 'https://api.test/api/launchers/starts/start-1/result',
            body: { succeeded: true, reason: null },
            token: TOKEN
        });
        remote.stop();
    });

    test('reports why a start failed', async () => {
        const { remote, respond, launchProfile, results } = setup({ settings: { remoteStartFor: 'player@example.com' } });
        launchProfile.mockResolvedValueOnce({ problem: { kind: 'java-needs-install', title: 'Java', message: 'x' } });
        respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: 'link-1', proxyId: null }] });
        remote.start();
        await waitFor(() => results.length === 1);
        expect(launchProfile).toHaveBeenCalledWith('main', expect.objectContaining({ proxyId: null }));
        expect(results[0].body).toEqual({ succeeded: false, reason: 'java-needs-install' });
        remote.stop();
    });

    test('refuses a client link it does not own, and ignores other command types', async () => {
        const { remote, respond, launchProfile, results } = setup({ settings: { remoteStartFor: 'player@example.com' } });
        respond({
            commands: [
                { id: 'start-1', type: 'start_client', clientLinkId: 'someone-else', proxyId: null },
                { id: 'cmd-2', type: 'run_shell', clientLinkId: 'link-1' }
            ]
        });
        remote.start();
        await waitFor(() => results.length === 1);
        await flush();
        expect(launchProfile).not.toHaveBeenCalled();
        expect(results).toHaveLength(1);
        expect(results[0].body).toEqual({ succeeded: false, reason: 'unknown-client' });
        remote.stop();
    });

    test('turns itself off when the launcher was removed from the dashboard', async () => {
        const { remote, fail, syncs, auth, readSettings, notify, launcherFile, handlers } = setup({ settings: { remoteStartFor: 'player@example.com' } });
        fail(401);
        remote.start();
        await waitFor(() => readSettings().remoteStartFor === null);
        await flush();
        expect(syncs).toHaveLength(1);
        expect(auth.request).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(launcherFile)).toBe(false);
        expect(notify).toHaveBeenCalledWith('Dashboard starts turned off', 'This launcher was removed from the Microbot dashboard.');
        await expect(handlers['remote-start:status']()).resolves.toMatchObject({ enabled: false });
    });

    test('only runs for the account that turned it on', async () => {
        const { remote, syncs, handlers } = setup({ settings: { remoteStartFor: 'someone-else@example.com' } });
        remote.start();
        await flush();
        expect(syncs).toHaveLength(0);
        await expect(handlers['remote-start:status']()).resolves.toMatchObject({ enabled: false });
    });

    test('a start still waiting its turn is dropped once the switch is turned off', async () => {
        const { remote, respond, launchProfile, handlers, results } = setup({ settings: { remoteStartFor: 'player@example.com' } });
        let stillWanted;
        let finish;
        launchProfile.mockImplementationOnce((_profile, options) => {
            stillWanted = options.stillWanted;
            return new Promise((resolve) => (finish = resolve));
        });
        respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: 'link-1', proxyId: null }] });
        remote.start();
        await waitFor(() => Boolean(stillWanted));
        expect(stillWanted()).toBe(true);
        respond({ commands: [] });
        await handlers['remote-start:set-enabled']({}, false);
        expect(stillWanted()).toBe(false);
        finish({ problem: { kind: 'disabled' } });
        await waitFor(() => results.length === 1);
        expect(results[0].body).toEqual({ succeeded: false, reason: 'disabled' });
    });

    test('sends at most 100 proxies with short labels, so the sync stays under the API limit', async () => {
        const proxies = Array.from({ length: 150 }, (_, i) => ({ id: `p${i}`, label: `${'x'.repeat(100)} (10.0.0.${i % 250}:1080)` }));
        const { remote, syncs } = setup({ settings: { remoteStartFor: 'player@example.com' }, proxies });
        remote.start();
        await waitFor(() => syncs.length === 1);
        expect(syncs[0].body.proxies).toHaveLength(100);
        expect(syncs[0].body.proxies[0].label).toHaveLength(80);
        remote.stop();
    });

    test('keeps trying after the API is unreachable', async () => {
        const { remote, fail, syncs, log } = setup({ settings: { remoteStartFor: 'player@example.com' } });
        fail(503);
        remote.start();
        await waitFor(() => syncs.length === 2);
        expect(syncs[1].token).toBe(TOKEN);
        expect(log.warn).toHaveBeenCalled();
        remote.stop();
    });

    test('switching off stops listening and tells the dashboard right away', async () => {
        const { handlers, remote, syncs, readSettings, respond } = setup({ settings: { remoteStartFor: 'player@example.com' } });
        remote.start();
        await waitFor(() => syncs.length === 1);
        respond({ commands: [] });
        await expect(handlers['remote-start:set-enabled']({}, false)).resolves.toEqual({ enabled: false });
        await waitFor(() => syncs.length === 2);
        expect(syncs[1].url).toBe('https://api.test/api/launchers/sync?wait=0');
        expect(syncs[1].body.startAllowed).toBe(false);
        expect(readSettings().remoteStartFor).toBeNull();
        await flush();
        expect(syncs).toHaveLength(2);
    });

    test('turning the tray off turns dashboard starts off too', async () => {
        const { remote, syncs, respond, trayOff, readSettings, handlers } = setup({ settings: { remoteStartFor: 'player@example.com' } });
        remote.start();
        await waitFor(() => syncs.length === 1);
        respond({ commands: [] });
        trayOff();
        await waitFor(() => syncs.length === 2);
        expect(syncs[1].body.startAllowed).toBe(false);
        expect(readSettings().remoteStartFor).toBeNull();
        await expect(handlers['remote-start:status']()).resolves.toMatchObject({ enabled: false });
    });

    test('stops on sign-out and picks up again on sign-in', async () => {
        const { remote, syncs, signOut, signIn } = setup({ settings: { remoteStartFor: 'player@example.com' } });
        remote.start();
        await waitFor(() => syncs.length === 1);
        signOut();
        await flush();
        expect(syncs).toHaveLength(1);
        signIn();
        await waitFor(() => syncs.length === 2);
        remote.stop();
    });

    describe('with a dashboard link per Jagex account', () => {
        const ACCOUNTS = [
            { accountId: '111', profile: 'main', proxyId: null },
            { accountId: '222', profile: 'main', proxyId: 'p1' },
            { accountId: '333', profile: 'alt', proxyId: null }
        ];
        const ACCOUNT_LINKS = { 111: 'link-zezima', 222: 'link-lynx' };

        test('reports every linked account with its own proxy, then the links of clients without an account', async () => {
            const startOptions = jest.fn(async () => ({ accounts: [] }));
            const { remote, syncs, linkedAccounts } = setup({
                settings: { remoteStartFor: 'player@example.com' },
                linked: { alt: 'link-2' },
                accounts: ACCOUNTS,
                accountLinks: ACCOUNT_LINKS,
                startOptions
            });
            remote.start();
            await waitFor(() => syncs.length === 1);

            expect(linkedAccounts).toHaveBeenCalledWith(ACCOUNTS);
            expect(syncs[0].body.clients).toEqual([
                { clientLinkId: 'link-zezima', suggestedProxyId: null },
                { clientLinkId: 'link-lynx', suggestedProxyId: 'p1' },
                { clientLinkId: 'link-2', suggestedProxyId: 'p1' }
            ]);
            expect(startOptions).toHaveBeenCalledWith({ alt: 'link-2' }, [{ id: 'p1', label: 'Germany (10.0.0.7:1080)' }], ACCOUNT_LINKS);
            expect(JSON.stringify(syncs[0].body)).not.toMatch(/"111"|"222"|"333"/);
            remote.stop();
        });

        test('an older dashboard starting an account link starts that account on its own profile', async () => {
            const { remote, respond, launchProfile, launchAccount, results, notify } = setup({
                settings: { remoteStartFor: 'player@example.com' },
                linked: {},
                accounts: ACCOUNTS,
                accountLinks: ACCOUNT_LINKS
            });
            respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: 'link-lynx', proxyId: 'p1' }] });
            remote.start();
            await waitFor(() => results.length === 1);

            expect(launchAccount).toHaveBeenCalledWith('222', expect.objectContaining({ proxyId: 'p1' }));
            expect(launchAccount.mock.calls[0][1].stillWanted()).toBe(true);
            expect(launchProfile).not.toHaveBeenCalled();
            expect(notify).toHaveBeenCalledWith('Starting a client from the dashboard', 'Lynx on profile main');
            expect(results[0].body).toEqual({ succeeded: true, reason: null });
            remote.stop();
        });

        test('an account start that fails is reported with its reason', async () => {
            const { remote, respond, launchAccount, results } = setup({
                settings: { remoteStartFor: 'player@example.com' },
                accounts: ACCOUNTS,
                accountLinks: ACCOUNT_LINKS
            });
            launchAccount.mockResolvedValueOnce({ problem: { kind: 'unknown-client' } });
            respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: 'link-zezima', proxyId: null }] });
            remote.start();
            await waitFor(() => results.length === 1);
            expect(launchAccount).toHaveBeenCalledWith('111', expect.objectContaining({ proxyId: null }));
            expect(results[0].body).toEqual({ succeeded: false, reason: 'unknown-client' });
            remote.stop();
        });

        test('a link of an account whose profile has alerts off is neither reported nor started', async () => {
            const { remote, respond, launchAccount, launchProfile, results, syncs } = setup({
                settings: { remoteStartFor: 'player@example.com' },
                linked: {},
                accounts: ACCOUNTS,
                accountLinks: {}
            });
            respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: 'link-lynx', proxyId: null }] });
            remote.start();
            await waitFor(() => results.length === 1);
            expect(syncs[0].body.clients).toEqual([]);
            expect(launchAccount).not.toHaveBeenCalled();
            expect(launchProfile).not.toHaveBeenCalled();
            expect(results[0].body).toEqual({ succeeded: false, reason: 'unknown-client' });
            remote.stop();
        });
    });

    describe('with launcher options', () => {
        const OPTIONS = {
            accountId: 'a_x9',
            profileId: 'p_k2',
            channel: 'stable',
            version: '2.6.44',
            ram: '2g',
            hwidSpoof: true,
            proxyId: null
        };
        const REPORTED = { accounts: [], profiles: [], versions: [], latestVersion: null, ramChoices: ['2g'], defaults: {} };

        test('sends the start options with every sync', async () => {
            const startOptions = jest.fn(async () => REPORTED);
            const { remote, syncs } = setup({ settings: { remoteStartFor: 'player@example.com' }, startOptions });
            remote.start();
            await waitFor(() => syncs.length === 1);
            expect(startOptions).toHaveBeenCalledWith({ main: 'link-1', alt: 'link-2' }, [{ id: 'p1', label: 'Germany (10.0.0.7:1080)' }], {});
            expect(syncs[0].body).toEqual({
                startAllowed: true,
                version: '3.2.21',
                clients: [
                    { clientLinkId: 'link-1', suggestedProxyId: null },
                    { clientLinkId: 'link-2', suggestedProxyId: 'p1' }
                ],
                proxies: [{ id: 'p1', label: 'Germany (10.0.0.7:1080)' }],
                startOptions: REPORTED
            });
            remote.stop();
        });

        test('still syncs when the start options cannot be listed', async () => {
            const startOptions = jest.fn(async () => {
                throw new Error('disk');
            });
            const { remote, syncs, log } = setup({ settings: { remoteStartFor: 'player@example.com' }, startOptions });
            remote.start();
            await waitFor(() => syncs.length === 1);
            expect(syncs[0].body.startOptions).toBeUndefined();
            expect(syncs[0].body.clients).toHaveLength(2);
            expect(log.warn).toHaveBeenCalledWith('Could not list the start options: disk');
            remote.stop();
        });

        test('starts with the chosen options instead of the client link', async () => {
            const { remote, respond, launchProfile, launchOptions, results, notify } = setup({ settings: { remoteStartFor: 'player@example.com' } });
            respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: 'link-1', proxyId: null, options: OPTIONS }] });
            remote.start();
            await waitFor(() => results.length === 1);
            expect(launchOptions).toHaveBeenCalledWith(OPTIONS, expect.objectContaining({ stillWanted: expect.any(Function) }));
            expect(launchOptions.mock.calls[0][1].stillWanted()).toBe(true);
            expect(launchProfile).not.toHaveBeenCalled();
            expect(notify).toHaveBeenCalledWith('Starting a client from the dashboard', 'Zezima on profile alt');
            expect(results[0].body).toEqual({ succeeded: true, reason: null });
            remote.stop();
        });

        test('reports an option the launcher no longer has', async () => {
            const { remote, respond, launchOptions, results, log } = setup({ settings: { remoteStartFor: 'player@example.com' } });
            launchOptions.mockResolvedValueOnce({ problem: { kind: 'unknown-option', title: 'Unknown Option', message: 'That proxy is no longer saved in the launcher on this PC.' } });
            respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: null, proxyId: null, options: OPTIONS }] });
            remote.start();
            await waitFor(() => results.length === 1);
            expect(results[0].body).toEqual({ succeeded: false, reason: 'unknown-option' });
            expect(log.warn).toHaveBeenCalledWith('Refused a dashboard start: That proxy is no longer saved in the launcher on this PC.');
            remote.stop();
        });

        test('a start that throws is reported as a failed launch', async () => {
            const { remote, respond, launchOptions, results } = setup({ settings: { remoteStartFor: 'player@example.com' } });
            launchOptions.mockRejectedValueOnce(new Error('boom'));
            respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: null, proxyId: null, options: OPTIONS }] });
            remote.start();
            await waitFor(() => results.length === 1);
            expect(results[0].body).toEqual({ succeeded: false, reason: 'launch-failed' });
            remote.stop();
        });

        test('a command with no options keeps using the client link', async () => {
            const { remote, respond, launchProfile, launchOptions, results, notify } = setup({ settings: { remoteStartFor: 'player@example.com' } });
            respond({ commands: [{ id: 'start-1', type: 'start_client', clientLinkId: 'link-2', proxyId: 'p1', options: null }] });
            remote.start();
            await waitFor(() => results.length === 1);
            expect(launchOptions).not.toHaveBeenCalled();
            expect(launchProfile).toHaveBeenCalledWith('alt', expect.objectContaining({ proxyId: 'p1' }));
            expect(notify).toHaveBeenCalledWith('Starting a client from the dashboard', 'Profile: alt');
            expect(results[0].body).toEqual({ succeeded: true, reason: null });
            remote.stop();
        });
    });
});
