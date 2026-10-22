const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const setupClientAlerts = require('../libs/client-alerts');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }

    invoke(channel, ...args) {
        return this.handlers.get(channel)(null, ...args);
    }
}

const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).reverse(),
    decryptString: (buffer) => Buffer.from(buffer).reverse().toString()
};

const FIRST_TOKEN = `mbc_${'A'.repeat(43)}`;
const SECOND_TOKEN = `mbc_${'B'.repeat(43)}`;
const FIRST_ID = '11111111-1111-1111-1111-111111111111';
const SECOND_ID = '22222222-2222-2222-2222-222222222222';

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

const linkRow = (id, label = 'Main') => ({ id, label, createdAt: '2026-10-21T10:00:00Z', lastSeenAt: null, online: false, runningScripts: [] });

describe('client-alerts', () => {
    let dir;
    let linksFile;
    let settingsFile;
    let log;
    let auth;
    let email;
    let serverLinks;
    let created;
    let serverLabels;

    const setup = (overrides = {}) => {
        const ipcMain = new FakeIpcMain();
        const alerts = setupClientAlerts({ ipcMain, log, fs, safeStorage, auth, linksFile, settingsFile, ...overrides });
        return { ipcMain, alerts };
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-alerts-'));
        linksFile = path.join(dir, 'alert-links.dat');
        settingsFile = path.join(dir, 'alert-profiles.json');
        log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        email = 'player@example.com';
        serverLinks = [];
        serverLabels = {};
        created = [{ id: FIRST_ID, token: FIRST_TOKEN }, { id: SECOND_ID, token: SECOND_TOKEN }];
        auth = {
            email: () => email,
            request: jest.fn(async (config) => {
                if (config.method === 'get') return { data: serverLinks.map((id) => linkRow(id, serverLabels[id])) };
                if (config.method === 'delete') {
                    serverLinks = serverLinks.filter((id) => config.path !== `/api/alerts/client-links/${id}`);
                    return { status: 204 };
                }
                const next = created.shift();
                serverLinks.push(next.id);
                return { data: { id: next.id, label: config.data.label, token: next.token, createdAt: '2026-10-21T10:00:00Z' } };
            })
        };
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const posts = () => auth.request.mock.calls.filter(([config]) => config.method === 'post');
    const deletes = () => auth.request.mock.calls.filter(([config]) => config.method === 'delete').map(([config]) => config.path);
    const stored = () => JSON.parse(safeStorage.decryptString(fs.readFileSync(linksFile)));

    test('creates a link once per profile and reuses it on later launches', async () => {
        const { alerts } = setup();

        expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
        expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
        expect(await setup().alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);

        expect(posts()).toHaveLength(1);
        expect(posts()[0][0]).toMatchObject({ path: '/api/alerts/client-links', data: { label: 'Microbot client' } });
        const gets = auth.request.mock.calls.filter(([config]) => config.method === 'get');
        expect(gets.length).toBeGreaterThan(0);
        gets.forEach(([config]) => expect(config.path).toBe('/api/alerts/client-links?includeHidden=true'));
    });

    test('each profile gets its own link with a neutral numbered name', async () => {
        const { alerts } = setup();

        expect(await alerts.tokenForProfile(undefined)).toBe(FIRST_TOKEN);
        expect(await alerts.tokenForProfile('Ironman')).toBe(SECOND_TOKEN);

        expect(posts().map(([config]) => config.data.label)).toEqual(['Microbot client', 'Microbot client 2']);
    });

    test('two launches at once create a single link', async () => {
        const { alerts } = setup();

        const tokens = await Promise.all([alerts.tokenForProfile('Main'), alerts.tokenForProfile('Main')]);

        expect(tokens).toEqual([FIRST_TOKEN, FIRST_TOKEN]);
        expect(posts()).toHaveLength(1);
    });

    test('the token is stored encrypted and never logged', async () => {
        const { alerts } = setup();

        await alerts.tokenForProfile('Main');

        expect(fs.readFileSync(linksFile).toString()).not.toContain(FIRST_TOKEN);
        const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
        expect(logged).not.toContain(FIRST_TOKEN);
    });

    test('a revoked link is dropped and replaced with a new one', async () => {
        const { alerts } = setup();
        await alerts.tokenForProfile('Main');
        serverLinks = [];

        expect(await alerts.tokenForProfile('Main')).toBe(SECOND_TOKEN);
        expect(await alerts.tokenForProfile('Main')).toBe(SECOND_TOKEN);

        expect(posts()).toHaveLength(2);
    });

    test('a revoked link whose replacement fails is not reused', async () => {
        const { alerts } = setup();
        await alerts.tokenForProfile('Main');
        serverLinks = [];
        created = [];
        auth.request.mockImplementation(async (config) => {
            if (config.method === 'get') return { data: [] };
            throw httpError(409);
        });

        expect(await alerts.tokenForProfile('Main')).toBeNull();
        expect(JSON.parse(safeStorage.decryptString(fs.readFileSync(linksFile))).profiles).toEqual({});
    });

    test('replacing a revoked link keeps a link another profile saved meanwhile', async () => {
        const { alerts } = setup();
        await alerts.tokenForProfile('Main');
        serverLinks = [];
        created.push({ id: '33333333-3333-3333-3333-333333333333', token: `mbc_${'C'.repeat(43)}` });
        let releaseCheck;
        auth.request.mockImplementationOnce(async () => {
            await new Promise((resolve) => {
                releaseCheck = resolve;
            });
            return { data: [] };
        });

        const main = alerts.tokenForProfile('Main');
        await new Promise((resolve) => setImmediate(resolve));
        const ironman = await alerts.tokenForProfile('Ironman');
        releaseCheck();
        await main;

        const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(linksFile))).profiles;
        expect(stored.Ironman.token).toBe(ironman);
        expect(Object.keys(stored).sort()).toEqual(['Ironman', 'Main']);
    });

    test('a slow API does not hold the launch and the stored link is used', async () => {
        const { alerts } = setup({ launchBudgetMs: 20 });
        await alerts.tokenForProfile('Main');
        auth.request.mockImplementation(() => new Promise(() => {}));

        expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
        expect(await alerts.tokenForProfile('Ironman')).toBeNull();
    });

    test('a link created after the launch budget is saved for the next launch', async () => {
        const { alerts } = setup({ launchBudgetMs: 20 });
        let releaseCreate;
        auth.request.mockImplementationOnce(async (config) => {
            await new Promise((resolve) => {
                releaseCreate = resolve;
            });
            serverLinks.push(FIRST_ID);
            return { data: { id: FIRST_ID, label: config.data.label, token: FIRST_TOKEN, createdAt: '2026-10-21T10:00:00Z' } };
        });

        expect(await alerts.tokenForProfile('Main')).toBeNull();
        releaseCreate();
        await new Promise((resolve) => setImmediate(resolve));

        expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
        expect(posts()).toHaveLength(1);
    });

    test('an expired sign-in launches without a token', async () => {
        const { alerts } = setup();
        await alerts.tokenForProfile('Main');
        auth.request.mockRejectedValue(httpError(401));

        expect(await alerts.tokenForProfile('Main')).toBeNull();
    });

    test('the stored link is still used when the API cannot be reached', async () => {
        const { alerts } = setup();
        await alerts.tokenForProfile('Main');
        auth.request.mockRejectedValue(new Error('ECONNREFUSED'));

        expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
    });

    test('a failed link launches without a token', async () => {
        auth.request.mockRejectedValue(new Error('ECONNREFUSED'));
        const { alerts } = setup();

        expect(await alerts.tokenForProfile('Main')).toBeNull();
        expect(fs.existsSync(linksFile)).toBe(false);
    });

    test('signed out passes nothing and calls no API', async () => {
        email = null;
        const { alerts } = setup();

        expect(await alerts.tokenForProfile('Main')).toBeNull();
        expect(auth.request).not.toHaveBeenCalled();
    });

    test('without the API sign-in there is no token', async () => {
        const { alerts, ipcMain } = setup({ auth: null });

        expect(await alerts.tokenForProfile('Main')).toBeNull();
        expect(await ipcMain.invoke('alerts:status', ['default'])).toEqual({
            signedIn: false,
            available: false,
            enabled: { default: true },
            labels: { default: 'Microbot client' }
        });
    });

    test('links of another account are not reused', async () => {
        const { alerts } = setup();
        await alerts.tokenForProfile('Main');
        email = 'other@example.com';

        expect(await alerts.tokenForProfile('Main')).toBe(SECOND_TOKEN);
        expect(posts()).toHaveLength(2);
    });

    test('no token and no API call without secure storage', async () => {
        const { alerts } = setup({ safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });

        expect(await alerts.tokenForProfile('Main')).toBeNull();
        expect(auth.request).not.toHaveBeenCalled();
    });

    test('the Alerts toggle is on by default and turning it off skips the link', async () => {
        const { alerts, ipcMain } = setup();

        expect(await ipcMain.invoke('alerts:status', ['default', 'Main'])).toEqual({
            signedIn: true,
            available: true,
            enabled: { default: true, Main: true },
            labels: { default: 'Microbot client', Main: 'Microbot client' }
        });

        expect(await ipcMain.invoke('alerts:set-enabled', 'Main', false)).toEqual({ enabled: false, label: 'Microbot client' });
        expect(await alerts.tokenForProfile('Main')).toBeNull();
        expect(auth.request).not.toHaveBeenCalled();
        expect((await ipcMain.invoke('alerts:status', ['default', 'Main'])).enabled).toEqual({ default: true, Main: false });

        expect(await ipcMain.invoke('alerts:set-enabled', 'Main', true)).toEqual({ enabled: true, label: 'Microbot client' });
        expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
    });

    test('switching alerts off revokes the link and drops the token', async () => {
        const { alerts, ipcMain } = setup();
        await alerts.tokenForProfile('Main');
        await alerts.tokenForProfile('Ironman');

        expect(await ipcMain.invoke('alerts:set-enabled', 'Main', false)).toEqual({ enabled: false, label: 'Microbot client' });

        expect(deletes()).toEqual([`/api/alerts/client-links/${FIRST_ID}`]);
        expect(serverLinks).toEqual([SECOND_ID]);
        expect(stored().profiles).toEqual({ Ironman: { id: SECOND_ID, token: SECOND_TOKEN, label: 'Microbot client 2' } });
        expect(stored().revoke).toEqual([]);
        expect(await alerts.tokenForProfile('Main')).toBeNull();
        const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
        expect(logged).not.toContain(FIRST_TOKEN);
    });

    test('a failed revoke still drops the token and is retried later', async () => {
        const { alerts, ipcMain } = setup();
        await alerts.tokenForProfile('Main');
        const online = auth.request.getMockImplementation();
        auth.request.mockImplementation(async (config) => {
            if (config.method === 'delete') throw new Error('ECONNREFUSED');
            return online(config);
        });

        expect(await ipcMain.invoke('alerts:set-enabled', 'Main', false)).toEqual({ enabled: false, label: 'Microbot client' });

        expect(deletes()).toHaveLength(1);
        expect(stored().profiles).toEqual({});
        expect(stored().revoke).toEqual([FIRST_ID]);
        expect(await alerts.tokenForProfile('Main')).toBeNull();

        auth.request.mockImplementation(online);
        await alerts.tokenForProfile('Ironman');
        await alerts.retryRevokes();

        expect(deletes()).toEqual([`/api/alerts/client-links/${FIRST_ID}`, `/api/alerts/client-links/${FIRST_ID}`]);
        expect(serverLinks).toEqual([SECOND_ID]);
        expect(stored().revoke).toEqual([]);
        expect(stored().profiles.Ironman.token).toBe(SECOND_TOKEN);
    });

    test('a link already gone on the server is not retried', async () => {
        const { alerts, ipcMain } = setup();
        await alerts.tokenForProfile('Main');
        const online = auth.request.getMockImplementation();
        auth.request.mockImplementation(async (config) => {
            if (config.method === 'delete') throw httpError(404);
            return online(config);
        });

        await ipcMain.invoke('alerts:set-enabled', 'Main', false);
        await alerts.retryRevokes();

        expect(deletes()).toHaveLength(1);
        expect(stored().revoke).toEqual([]);
    });

    test('switching alerts on again creates a new link at the next launch', async () => {
        const { alerts, ipcMain } = setup();
        await alerts.tokenForProfile('Main');
        await ipcMain.invoke('alerts:set-enabled', 'Main', false);

        await ipcMain.invoke('alerts:set-enabled', 'Main', true);
        expect(posts()).toHaveLength(1);

        expect(await alerts.tokenForProfile('Main')).toBe(SECOND_TOKEN);
        expect(posts()).toHaveLength(2);
        expect(posts()[1][0]).toMatchObject({ path: '/api/alerts/client-links', data: { label: 'Microbot client' } });
        expect(stored().profiles.Main).toEqual({ id: SECOND_ID, token: SECOND_TOKEN, label: 'Microbot client' });
    });

    test('status returns the dashboard name of each linked profile', async () => {
        const { alerts, ipcMain } = setup();
        await alerts.tokenForProfile('Main');
        serverLabels[FIRST_ID] = 'Main PC';

        expect((await ipcMain.invoke('alerts:status', ['default', 'Main'])).labels).toEqual({ default: 'Microbot client', Main: 'Main PC' });

        auth.request.mockRejectedValue(new Error('ECONNREFUSED'));
        expect((await ipcMain.invoke('alerts:status', ['default', 'Main'])).labels).toEqual({ default: 'Microbot client', Main: 'Main PC' });
    });

    test('status shows the default name once the linked client is gone from the dashboard', async () => {
        const { alerts, ipcMain } = setup();
        await alerts.tokenForProfile('Main');
        serverLabels[FIRST_ID] = 'Main PC';
        await ipcMain.invoke('alerts:status', ['Main']);
        serverLinks = [];

        expect((await ipcMain.invoke('alerts:status', ['Main'])).labels).toEqual({ Main: 'Microbot client' });
        expect(await alerts.tokenForProfile('Main')).toBe(SECOND_TOKEN);
        expect(posts()[1][0]).toMatchObject({ data: { label: 'Microbot client' } });
    });

    test('switching alerts off while the link is being created revokes the new link', async () => {
        const { alerts, ipcMain } = setup();
        let releaseCreate;
        auth.request.mockImplementationOnce(async (config) => {
            await new Promise((resolve) => {
                releaseCreate = resolve;
            });
            serverLinks.push(FIRST_ID);
            return { data: { id: FIRST_ID, label: config.data.label, token: FIRST_TOKEN, createdAt: '2026-10-21T10:00:00Z' } };
        });

        const launch = alerts.tokenForProfile('Main');
        await new Promise((resolve) => setImmediate(resolve));
        await ipcMain.invoke('alerts:set-enabled', 'Main', false);
        releaseCreate();

        expect(await launch).toBeNull();
        await alerts.retryRevokes();
        expect(deletes()).toEqual([`/api/alerts/client-links/${FIRST_ID}`]);
        expect(serverLinks).toEqual([]);
        expect(stored().profiles).toEqual({});
        expect(stored().revoke).toEqual([]);
    });

    test('switching alerts off while the link is being checked does not hand out its token', async () => {
        const { alerts, ipcMain } = setup();
        await alerts.tokenForProfile('Main');
        let releaseCheck;
        const online = auth.request.getMockImplementation();
        auth.request.mockImplementationOnce(async (config) => {
            await new Promise((resolve) => {
                releaseCheck = resolve;
            });
            return online(config);
        });

        const launch = alerts.tokenForProfile('Main');
        await new Promise((resolve) => setImmediate(resolve));
        await ipcMain.invoke('alerts:set-enabled', 'Main', false);
        releaseCheck();

        expect(await launch).toBeNull();
        expect(deletes()).toEqual([`/api/alerts/client-links/${FIRST_ID}`]);
        expect(stored().profiles).toEqual({});
    });

    test('the renderer never gets the token or the link id', async () => {
        const { alerts, ipcMain } = setup();
        await alerts.tokenForProfile('Main');

        const status = await ipcMain.invoke('alerts:status', ['Main']);

        expect(JSON.stringify(status)).not.toContain(FIRST_TOKEN);
        expect(JSON.stringify(status)).not.toContain(FIRST_ID);
    });
});

describe('jar-executor alert token', () => {
    const VERSION = '9.9.9';
    const PROBE_OUTPUT = 'openjdk version "17.0.12"\n    java.version = 17.0.12\n    sun.arch.data.model = 64\n';
    let originalDebug;

    const fakeProcess = () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stderr.destroy = jest.fn();
        child.unref = jest.fn();
        child.kill = jest.fn();
        return child;
    };

    const createHarness = (alerts) => {
        const handlers = {};
        const launches = [];
        const spawn = jest.fn((command, args, options) => {
            const child = fakeProcess();
            if (args.includes('-version')) {
                setImmediate(() => {
                    child.stdout.emit('data', PROBE_OUTPUT);
                    child.emit('close', 0);
                });
            } else {
                launches.push({ command, args, options });
            }
            return child;
        });
        const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const deps = {
            spawn,
            path,
            fs,
            log,
            microbotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-launch-')),
            packageJson: { version: '3.2.14-test' },
            ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
            shell: { openExternal: jest.fn() },
            dialog: { showMessageBox: jest.fn(() => Promise.resolve({ response: 0 })) },
            alerts
        };
        return { deps, handlers, launches, log };
    };

    const waitFor = async (predicate) => {
        for (let i = 0; i < 200 && !predicate(); i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    };

    beforeEach(() => {
        originalDebug = process.env.DEBUG;
        delete process.env.DEBUG;
    });

    afterEach(() => {
        if (originalDebug === undefined) delete process.env.DEBUG;
        else process.env.DEBUG = originalDebug;
    });

    const launch = async (harness, account) => {
        await require('../libs/jar-executor')(harness.deps);
        const result = await harness.handlers['open-client']({}, VERSION, null, account, '');
        await waitFor(() => harness.launches.length > 0);
        fs.rmSync(harness.deps.microbotDir, { recursive: true, force: true });
        return result;
    };

    test('the token reaches the client only through MICROBOT_CLIENT_TOKEN', async () => {
        const alerts = { tokenForProfile: jest.fn().mockResolvedValue(FIRST_TOKEN) };
        const harness = createHarness(alerts);

        expect(await launch(harness, { profile: 'Main', displayName: 'Hero' })).toEqual({ success: true });

        expect(alerts.tokenForProfile).toHaveBeenCalledWith('Main');
        expect(harness.launches).toHaveLength(1);
        const [{ args, options }] = harness.launches;
        expect(options.env).toEqual({ ...process.env, MICROBOT_CLIENT_TOKEN: FIRST_TOKEN });
        expect(args.join(' ')).not.toContain(FIRST_TOKEN);
        const logged = JSON.stringify([harness.log.info.mock.calls, harness.log.warn.mock.calls, harness.log.error.mock.calls]);
        expect(logged).not.toContain(FIRST_TOKEN);
    });

    test('the no-Jagex launch passes the preferred profile token the same way', async () => {
        const alerts = { tokenForProfile: jest.fn().mockResolvedValue(FIRST_TOKEN) };
        const harness = createHarness(alerts);
        fs.writeFileSync(path.join(harness.deps.microbotDir, 'non-jagex-preferred-profile.json'), JSON.stringify({ profile: 'Ironman' }));
        await require('../libs/jar-executor')(harness.deps);

        await harness.handlers['play-no-jagex-account']({}, VERSION, null, '');
        await waitFor(() => harness.launches.length > 0);
        fs.rmSync(harness.deps.microbotDir, { recursive: true, force: true });

        expect(alerts.tokenForProfile).toHaveBeenCalledWith('Ironman');
        expect(harness.launches[0].options.env.MICROBOT_CLIENT_TOKEN).toBe(FIRST_TOKEN);
        expect(harness.launches[0].args.join(' ')).not.toContain(FIRST_TOKEN);
    });

    test('signed out launches exactly as before, with no env override', async () => {
        const ipcMain = new FakeIpcMain();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-alerts-'));
        const request = jest.fn();
        const alerts = setupClientAlerts({
            ipcMain,
            log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
            fs,
            safeStorage,
            auth: { email: () => null, request },
            linksFile: path.join(dir, 'alert-links.dat'),
            settingsFile: path.join(dir, 'alert-profiles.json')
        });
        const harness = createHarness(alerts);

        await launch(harness, { profile: 'Main' });
        fs.rmSync(dir, { recursive: true, force: true });

        expect(request).not.toHaveBeenCalled();
        expect(harness.launches).toHaveLength(1);
        expect(harness.launches[0].options).not.toHaveProperty('env');
    });

    test('a failing alert setup never blocks the launch', async () => {
        const alerts = { tokenForProfile: jest.fn().mockRejectedValue(new Error('boom')) };
        const harness = createHarness(alerts);

        expect(await launch(harness, { profile: 'Main' })).toEqual({ success: true });

        expect(harness.launches).toHaveLength(1);
        expect(harness.launches[0].options).not.toHaveProperty('env');
    });
});
