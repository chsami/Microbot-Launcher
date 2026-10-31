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
const THIRD_TOKEN = `mbc_${'C'.repeat(43)}`;
const FIRST_ID = '11111111-1111-1111-1111-111111111111';
const SECOND_ID = '22222222-2222-2222-2222-222222222222';
const THIRD_ID = '33333333-3333-3333-3333-333333333333';
const ZEZIMA = { accountId: '1001', displayName: 'Zezima', profile: 'Main' };
const LYNX = { accountId: '1002', displayName: 'Lynx', profile: 'Main' };

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
                if (config.method === 'patch') {
                    const id = serverLinks.find((linkId) => config.path === `/api/alerts/client-links/${linkId}`);
                    if (!id) throw httpError(404);
                    serverLabels[id] = config.data.label;
                    return { data: linkRow(id, config.data.label) };
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
    const patches = () => auth.request.mock.calls.filter(([config]) => config.method === 'patch').map(([config]) => [config.path, config.data.label]);
    const stored = () => JSON.parse(safeStorage.decryptString(fs.readFileSync(linksFile)));
    const writeAccounts = (accounts) => {
        const file = path.join(dir, 'accounts.json');
        fs.writeFileSync(file, JSON.stringify(accounts));
        return file;
    };
    const writeOldStore = (profiles) => {
        fs.writeFileSync(linksFile, safeStorage.encryptString(JSON.stringify({ email, profiles, revoke: [] })));
        serverLinks = Object.values(profiles).map((link) => link.id);
    };

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

    test('switching a profile off keeps its link, and switching it on again reuses that link', async () => {
        const { alerts, ipcMain } = setup();
        await alerts.tokenForProfile('Main');
        await alerts.tokenForProfile('Ironman');

        expect(await ipcMain.invoke('alerts:set-enabled', 'Main', false)).toEqual({ enabled: false, label: 'Microbot client' });

        expect(deletes()).toEqual([]);
        expect(serverLinks).toEqual([FIRST_ID, SECOND_ID]);
        expect(stored().profiles.Main).toEqual({ id: FIRST_ID, token: FIRST_TOKEN, label: 'Microbot client', noJagex: true });
        expect(stored().revoke).toEqual([]);
        expect(await alerts.tokenForProfile('Main')).toBeNull();
        expect(alerts.linkedProfiles()).toEqual({ Ironman: SECOND_ID });

        expect(await ipcMain.invoke('alerts:set-enabled', 'Main', true)).toEqual({ enabled: true, label: 'Microbot client' });
        expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
        expect(posts()).toHaveLength(2);
        expect(alerts.linkedProfiles()).toEqual({ Main: FIRST_ID, Ironman: SECOND_ID });
    });

    test('revokes queued by an older launcher are still sent, and retried when they fail', async () => {
        fs.writeFileSync(linksFile, safeStorage.encryptString(JSON.stringify({ email, profiles: {}, accounts: {}, revoke: [THIRD_ID] })));
        serverLinks = [THIRD_ID];
        const online = auth.request.getMockImplementation();
        auth.request.mockImplementation(async (config) => {
            if (config.method === 'delete') throw new Error('ECONNREFUSED');
            return online(config);
        });
        const { alerts } = setup();

        await alerts.tokenForProfile('Main');
        await alerts.retryRevokes();
        expect(stored().revoke).toEqual([THIRD_ID]);

        auth.request.mockImplementation(online);
        await alerts.retryRevokes();

        expect(deletes()).toEqual(Array(3).fill(`/api/alerts/client-links/${THIRD_ID}`));
        expect(serverLinks).toEqual([FIRST_ID]);
        expect(stored().revoke).toEqual([]);
        expect(stored().profiles.Main.token).toBe(FIRST_TOKEN);
    });

    test('a queued revoke already gone on the server is not retried', async () => {
        fs.writeFileSync(linksFile, safeStorage.encryptString(JSON.stringify({ email, profiles: {}, accounts: {}, revoke: [THIRD_ID] })));
        const online = auth.request.getMockImplementation();
        auth.request.mockImplementation(async (config) => {
            if (config.method === 'delete') throw httpError(404);
            return online(config);
        });
        const { alerts } = setup();

        await alerts.retryRevokes();
        await alerts.retryRevokes();

        expect(deletes()).toHaveLength(1);
        expect(stored().revoke).toEqual([]);
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

    test('switching alerts off while the link is being created keeps the new link for later', async () => {
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
        expect(deletes()).toEqual([]);
        expect(stored().profiles.Main).toMatchObject({ id: FIRST_ID, token: FIRST_TOKEN });
        expect(stored().revoke).toEqual([]);
        expect(alerts.linkedProfiles()).toEqual({});

        await ipcMain.invoke('alerts:set-enabled', 'Main', true);
        expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
        expect(posts()).toHaveLength(1);
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
        expect(deletes()).toEqual([]);
        expect(stored().profiles.Main.id).toBe(FIRST_ID);
    });

    describe('a link per Jagex account', () => {
        test('each Jagex account gets its own link named after the account, even on one profile', async () => {
            const { alerts } = setup();

            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);
            expect(await alerts.tokenForLaunch('Main', LYNX)).toBe(SECOND_TOKEN);
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);
            expect(await setup().alerts.tokenForLaunch('Main', LYNX)).toBe(SECOND_TOKEN);

            expect(posts().map(([config]) => config.data.label)).toEqual(['Zezima', 'Lynx']);
            expect(stored().accounts).toEqual({
                1001: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Zezima', profile: 'Main' },
                1002: { id: SECOND_ID, token: SECOND_TOKEN, label: 'Lynx', profile: 'Main' }
            });
            expect(stored().profiles).toEqual({});
        });

        test('an account without a usable name gets the default name', async () => {
            const { alerts } = setup();

            await alerts.tokenForLaunch('Main', { accountId: '1003', displayName: ' \u0007 ' });

            expect(posts()[0][0].data.label).toBe('Microbot client');
        });

        test('the account name and id never reach the log', async () => {
            const { alerts } = setup();

            await alerts.tokenForLaunch('Main', ZEZIMA);

            const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
            expect(logged).not.toMatch(/Zezima|1001/);
        });

        test('a launch without a Jagex account keeps the profile link next to the account links', async () => {
            const { alerts } = setup();
            created.push({ id: THIRD_ID, token: THIRD_TOKEN });

            expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(SECOND_TOKEN);
            expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
            expect(await alerts.tokenForLaunch('Main', LYNX)).toBe(THIRD_TOKEN);

            expect(posts().map(([config]) => config.data.label)).toEqual(['Microbot client', 'Zezima', 'Lynx']);
            expect(stored().profiles.Main.id).toBe(FIRST_ID);
            expect(patches()).toEqual([]);
        });

        test('the first account on a profile takes over its old link and its name, the next account gets a new one', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Microbot client' }, Ironman: { id: THIRD_ID, token: THIRD_TOKEN, label: 'Iron PC' } });
            created = [{ id: SECOND_ID, token: SECOND_TOKEN }];
            const { alerts } = setup();

            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);

            expect(posts()).toHaveLength(0);
            expect(patches()).toEqual([[`/api/alerts/client-links/${FIRST_ID}`, 'Zezima']]);
            expect(stored().accounts).toEqual({ 1001: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Zezima', profile: 'Main' } });
            expect(stored().profiles).toEqual({ Ironman: { id: THIRD_ID, token: THIRD_TOKEN, label: 'Iron PC' } });

            expect(await alerts.tokenForLaunch('Main', LYNX)).toBe(SECOND_TOKEN);
            expect(posts().map(([config]) => config.data.label)).toEqual(['Lynx']);
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);
            expect(patches()).toHaveLength(1);
            expect(serverLinks).toContain(FIRST_ID);
        });

        test('a launch without an account after the takeover gets a fresh profile link that no account takes over later', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Microbot client' } });
            created = [{ id: SECOND_ID, token: SECOND_TOKEN }, { id: THIRD_ID, token: THIRD_TOKEN }];
            const { alerts } = setup();

            await alerts.tokenForLaunch('Main', ZEZIMA);
            expect(await alerts.tokenForProfile('Main')).toBe(SECOND_TOKEN);
            expect(stored().profiles.Main).toEqual({ id: SECOND_ID, token: SECOND_TOKEN, label: 'Microbot client', noJagex: true });

            expect(await alerts.tokenForLaunch('Main', LYNX)).toBe(THIRD_TOKEN);
            expect(stored().profiles.Main.id).toBe(SECOND_ID);
            expect(await alerts.tokenForProfile('Main')).toBe(SECOND_TOKEN);
        });

        test('a client still running with the old profile link keeps working after the takeover', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Main PC' } });
            const { alerts } = setup();

            await alerts.tokenForLaunch('Main', ZEZIMA);

            expect(deletes()).toEqual([]);
            expect(stored().revoke).toEqual([]);
            expect(serverLinks).toEqual([FIRST_ID]);
        });

        test('accounts launched at the same time never share the old profile link', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Microbot client' } });
            created = [{ id: SECOND_ID, token: SECOND_TOKEN }, { id: THIRD_ID, token: THIRD_TOKEN }];
            const { alerts } = setup();

            const tokens = await Promise.all([
                alerts.tokenForLaunch('Main', ZEZIMA),
                alerts.tokenForLaunch('Main', LYNX),
                alerts.tokenForProfile('Main'),
                alerts.tokenForLaunch('Main', ZEZIMA)
            ]);

            expect(tokens[0]).toBe(FIRST_TOKEN);
            expect(tokens[3]).toBe(FIRST_TOKEN);
            expect(new Set(tokens.slice(0, 3)).size).toBe(3);
            expect(tokens).not.toContain(null);
            expect(Object.values(stored().accounts).map((link) => link.id).sort()).toEqual(
                [FIRST_ID, tokens[1] === SECOND_TOKEN ? SECOND_ID : THIRD_ID].sort()
            );
            expect(stored().profiles.Main.noJagex).toBe(true);
        });

        test('a profile link already checked when an account takes it over is not handed to the launch without an account', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Microbot client' } });
            created = [{ id: SECOND_ID, token: SECOND_TOKEN }];
            const online = auth.request.getMockImplementation();
            let releaseCheck;
            auth.request.mockImplementationOnce(async (config) => {
                await new Promise((resolve) => {
                    releaseCheck = resolve;
                });
                return online(config);
            });
            const { alerts } = setup();

            const plain = alerts.tokenForProfile('Main');
            await new Promise((resolve) => setImmediate(resolve));
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);
            releaseCheck();

            expect(await plain).toBe(SECOND_TOKEN);
            expect(stored().profiles.Main.id).toBe(SECOND_ID);
            expect(stored().accounts[1001].id).toBe(FIRST_ID);
        });

        test('a failed rename keeps the old name and is tried again at the next launch', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Microbot client' } });
            const online = auth.request.getMockImplementation();
            auth.request.mockImplementation(async (config) => {
                if (config.method === 'patch') throw new Error('ECONNREFUSED');
                return online(config);
            });
            const { alerts } = setup();

            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);
            expect(stored().accounts[1001]).toMatchObject({ label: 'Microbot client', renameTo: 'Zezima' });

            auth.request.mockImplementation(online);
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);
            expect(stored().accounts[1001]).toEqual({ id: FIRST_ID, token: FIRST_TOKEN, label: 'Zezima', profile: 'Main' });
            expect(serverLabels[FIRST_ID]).toBe('Zezima');
        });

        test('a rename the dashboard refuses is not tried again', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Main PC' } });
            const online = auth.request.getMockImplementation();
            auth.request.mockImplementation(async (config) => {
                if (config.method === 'patch') throw httpError(400);
                return online(config);
            });
            const { alerts } = setup();

            await alerts.tokenForLaunch('Main', ZEZIMA);
            await alerts.tokenForLaunch('Main', ZEZIMA);

            expect(patches()).toHaveLength(1);
            expect(stored().accounts[1001]).toEqual({ id: FIRST_ID, token: FIRST_TOKEN, label: 'Main PC', profile: 'Main' });
        });

        test('an old link revoked on the dashboard is replaced by a new one named after the account', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Microbot client' } });
            serverLinks = [];
            created = [{ id: SECOND_ID, token: SECOND_TOKEN }];
            const { alerts } = setup();

            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(SECOND_TOKEN);

            expect(posts()[0][0].data.label).toBe('Zezima');
            expect(patches()).toEqual([]);
            expect(stored().accounts).toEqual({ 1001: { id: SECOND_ID, token: SECOND_TOKEN, label: 'Zezima', profile: 'Main' } });
            expect(stored().profiles).toEqual({});
        });

        test('an account on a profile switched off by an older launcher gives no token and takes over nothing', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Microbot client' } });
            fs.writeFileSync(settingsFile, JSON.stringify({ disabled: ['Main'] }));
            const { alerts } = setup();

            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBeNull();

            expect(auth.request).not.toHaveBeenCalled();
            expect(stored()).toEqual({ email, profiles: { Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Microbot client' } }, revoke: [] });
        });

        test('the profile switch only decides launches without a Jagex account', async () => {
            const { alerts, ipcMain } = setup({ accountsFile: writeAccounts([ZEZIMA, LYNX]) });
            created.push({ id: THIRD_ID, token: THIRD_TOKEN });
            await alerts.tokenForLaunch('Main', ZEZIMA);
            await alerts.tokenForLaunch('Main', LYNX);
            await alerts.tokenForProfile('Main');

            await ipcMain.invoke('alerts:set-enabled', 'Main', false);

            expect(deletes()).toEqual([]);
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);
            expect(await alerts.tokenForLaunch('Main', LYNX)).toBe(SECOND_TOKEN);
            expect(await alerts.tokenForProfile('Main')).toBeNull();
            expect(alerts.linkedAccounts([ZEZIMA, LYNX])).toEqual({ 1001: FIRST_ID, 1002: SECOND_ID });
            expect(alerts.linkedProfiles()).toEqual({});
            expect(stored().profiles.Main.id).toBe(THIRD_ID);
        });

        test('an account keeps its own switch when it moves to another profile', async () => {
            const { alerts, ipcMain } = setup({ accountsFile: writeAccounts([ZEZIMA]) });
            await alerts.tokenForLaunch('Main', ZEZIMA);
            await ipcMain.invoke('alerts:set-enabled', 'Ironman', false);

            expect(await alerts.tokenForLaunch('Ironman', { ...ZEZIMA, profile: 'Ironman' })).toBe(FIRST_TOKEN);
            expect(stored().accounts[1001].profile).toBe('Ironman');

            await ipcMain.invoke('alerts:set-account-enabled', '1001', false);
            await ipcMain.invoke('alerts:set-enabled', 'Ironman', true);
            expect(await alerts.tokenForLaunch('Ironman', { ...ZEZIMA, profile: 'Ironman' })).toBeNull();
            expect(deletes()).toEqual([]);
        });

        test('linked accounts lists the links of accounts still logged in whose switch is on', async () => {
            const { alerts, ipcMain } = setup({ accountsFile: writeAccounts([ZEZIMA, LYNX]) });
            created.push({ id: THIRD_ID, token: THIRD_TOKEN });
            await alerts.tokenForLaunch('Main', ZEZIMA);
            await alerts.tokenForLaunch('Main', LYNX);
            await alerts.tokenForLaunch(undefined, { accountId: '1003', displayName: 'Iron Ted' });
            await ipcMain.invoke('alerts:set-account-enabled', '1002', false);
            await ipcMain.invoke('alerts:set-enabled', 'default', false);

            expect(
                alerts.linkedAccounts([
                    { accountId: '1001', profile: 'Main' },
                    { accountId: '1002', profile: 'Main' },
                    { accountId: '1003', profile: 'default' },
                    { accountId: '1004', profile: 'Main' },
                    { accountId: 'constructor', profile: 'Main' }
                ])
            ).toEqual({ 1001: FIRST_ID, 1003: THIRD_ID });
            expect(alerts.linkedProfiles()).toEqual({});
            email = null;
            expect(alerts.linkedAccounts([{ accountId: '1001', profile: 'Main' }])).toEqual({});
        });

        test('only profile links made for clients without an account are listed as such', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Main PC' } });
            created = [{ id: SECOND_ID, token: SECOND_TOKEN }];
            const { alerts } = setup();

            expect(alerts.profilesWithoutAccount()).toEqual([]);
            await alerts.tokenForProfile('Ironman');
            expect(alerts.profilesWithoutAccount()).toEqual(['Ironman']);
            email = null;
            expect(alerts.profilesWithoutAccount()).toEqual([]);
        });

        test('a user without Jagex accounts keeps one link per profile', async () => {
            writeOldStore({ Main: { id: FIRST_ID, token: FIRST_TOKEN, label: 'Main PC' } });
            created = [{ id: SECOND_ID, token: SECOND_TOKEN }];
            const { alerts } = setup();

            expect(await alerts.tokenForProfile('Main')).toBe(FIRST_TOKEN);
            expect(await alerts.tokenForLaunch('Ironman', null)).toBe(SECOND_TOKEN);

            expect(stored().profiles.Main).toEqual({ id: FIRST_ID, token: FIRST_TOKEN, label: 'Main PC' });
            expect(stored().accounts).toEqual({});
            expect(alerts.linkedProfiles()).toEqual({ Main: FIRST_ID, Ironman: SECOND_ID });
            expect(alerts.linkedAccounts([])).toEqual({});
            expect(patches()).toEqual([]);
        });
    });

    describe('the dashboard switch of each Jagex account', () => {
        const IRON_TED = { accountId: '1003', displayName: 'Iron Ted' };
        const settings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));

        test('is on by default, and off launches the account without a token or an API call', async () => {
            const { alerts, ipcMain } = setup({ accountsFile: writeAccounts([ZEZIMA, LYNX]) });

            expect(await ipcMain.invoke('alerts:accounts', ['1001', '1002'])).toEqual({ signedIn: true, available: true, enabled: { 1001: true, 1002: true } });
            expect(await ipcMain.invoke('alerts:set-account-enabled', '1001', false)).toEqual({ enabled: false });

            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBeNull();
            expect(auth.request).not.toHaveBeenCalled();
            expect(await alerts.tokenForLaunch('Main', LYNX)).toBe(FIRST_TOKEN);
            expect(await ipcMain.invoke('alerts:accounts', ['1001', '1002'])).toMatchObject({ enabled: { 1001: false, 1002: true } });

            expect(await ipcMain.invoke('alerts:set-account-enabled', '1001', true)).toEqual({ enabled: true });
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(SECOND_TOKEN);
        });

        test('switching off never revokes, and switching on again reuses the same link', async () => {
            const { alerts, ipcMain } = setup({ accountsFile: writeAccounts([ZEZIMA]) });
            await alerts.tokenForLaunch('Main', ZEZIMA);

            await ipcMain.invoke('alerts:set-account-enabled', '1001', false);
            await alerts.retryRevokes();

            expect(deletes()).toEqual([]);
            expect(serverLinks).toEqual([FIRST_ID]);
            expect(stored().accounts[1001]).toEqual({ id: FIRST_ID, token: FIRST_TOKEN, label: 'Zezima', profile: 'Main' });
            expect(stored().revoke).toEqual([]);
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBeNull();
            expect(alerts.linkedAccounts([ZEZIMA])).toEqual({});

            await ipcMain.invoke('alerts:set-account-enabled', '1001', true);

            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);
            expect(posts()).toHaveLength(1);
            expect(alerts.linkedAccounts([ZEZIMA])).toEqual({ 1001: FIRST_ID });
        });

        test('a link revoked on the dashboard while the switch was off is replaced once it is on again', async () => {
            const { alerts, ipcMain } = setup({ accountsFile: writeAccounts([ZEZIMA]) });
            await alerts.tokenForLaunch('Main', ZEZIMA);
            await ipcMain.invoke('alerts:set-account-enabled', '1001', false);
            serverLinks = [];

            await ipcMain.invoke('alerts:set-account-enabled', '1001', true);

            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(SECOND_TOKEN);
            expect(stored().accounts[1001].id).toBe(SECOND_ID);
        });

        test('starts as the switch of the profile each account uses, and keeps it when that profile switch changes', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ disabled: ['Main'] }));
            const accountsFile = writeAccounts([ZEZIMA, { ...LYNX, profile: 'Ironman' }, IRON_TED]);
            const { alerts, ipcMain } = setup({ accountsFile });

            expect((await ipcMain.invoke('alerts:accounts', ['1001', '1002', '1003'])).enabled).toEqual({ 1001: false, 1002: true, 1003: true });
            expect(settings()).toEqual({ disabled: ['Main'], accounts: { 1001: false, 1002: true, 1003: true }, accountsMigrated: true });

            await ipcMain.invoke('alerts:set-enabled', 'Main', true);
            await ipcMain.invoke('alerts:set-enabled', 'default', false);

            expect((await ipcMain.invoke('alerts:accounts', ['1001', '1003'])).enabled).toEqual({ 1001: false, 1003: true });
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBeNull();
            expect(await alerts.tokenForLaunch(undefined, IRON_TED)).toBe(FIRST_TOKEN);
            expect(await alerts.tokenForProfile(undefined)).toBeNull();
        });

        test('the switch values are kept per account and an account added later starts on', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ disabled: ['Main'] }));
            const accountsFile = writeAccounts([ZEZIMA]);
            setup({ accountsFile });
            const { alerts, ipcMain } = setup({ accountsFile });
            await ipcMain.invoke('alerts:accounts', ['1001']);
            writeAccounts([ZEZIMA, LYNX]);

            expect((await ipcMain.invoke('alerts:accounts', ['1001', '1002'])).enabled).toEqual({ 1001: false, 1002: true });
            expect(await alerts.tokenForLaunch('Main', LYNX)).toBe(FIRST_TOKEN);
        });

        test('an unreadable account list falls back to the profile switch and migrates later', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ disabled: ['Main'] }));
            const accountsFile = path.join(dir, 'accounts.json');
            fs.writeFileSync(accountsFile, '{not json');
            const { alerts, ipcMain } = setup({ accountsFile });

            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBeNull();
            expect(settings()).toEqual({ disabled: ['Main'] });

            writeAccounts([ZEZIMA]);
            await ipcMain.invoke('alerts:set-enabled', 'Main', true);

            expect(settings()).toEqual({ disabled: [], accounts: { 1001: false }, accountsMigrated: true });
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBeNull();
        });

        test('only accepts account ids and stores unusual ids as plain keys', async () => {
            const { alerts, ipcMain } = setup({ accountsFile: writeAccounts([]) });

            expect(await ipcMain.invoke('alerts:set-account-enabled', '', false)).toEqual({ error: 'That Jagex account could not be found.' });
            expect(await ipcMain.invoke('alerts:set-account-enabled', 42, false)).toEqual({ error: 'That Jagex account could not be found.' });
            expect(await ipcMain.invoke('alerts:set-account-enabled', '__proto__', false)).toEqual({ enabled: false });

            expect((await ipcMain.invoke('alerts:accounts', ['__proto__', 'constructor', 7])).enabled).toEqual({ ['__proto__']: false, constructor: true });
            expect(await alerts.tokenForLaunch('Main', ZEZIMA)).toBe(FIRST_TOKEN);
        });

        test('is not available signed out or without secure storage', async () => {
            const { ipcMain } = setup({ safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });
            expect(await ipcMain.invoke('alerts:accounts', ['1001'])).toEqual({ signedIn: true, available: false, enabled: { 1001: true } });

            email = null;
            expect((await setup().ipcMain.invoke('alerts:accounts', ['1001'])).available).toBe(false);
        });

        test('a failed save reports the switch as it still is', async () => {
            const { ipcMain } = setup({ accountsFile: writeAccounts([ZEZIMA]) });
            await ipcMain.invoke('alerts:accounts', ['1001']);
            const writeFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
                throw new Error('EACCES');
            });

            expect(await ipcMain.invoke('alerts:set-account-enabled', '1001', false)).toEqual({ error: 'Could not save the dashboard setting.', enabled: true });
            writeFileSync.mockRestore();
        });

        test('the account name and id never reach the log', async () => {
            const { alerts, ipcMain } = setup({ accountsFile: writeAccounts([ZEZIMA]) });
            await ipcMain.invoke('alerts:set-account-enabled', '1001', false);
            await alerts.tokenForLaunch('Main', ZEZIMA);
            await ipcMain.invoke('alerts:set-account-enabled', '1001', true);
            await alerts.tokenForLaunch('Main', ZEZIMA);

            const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
            expect(logged).not.toMatch(/Zezima|1001/);
        });
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
        const alerts = { tokenForLaunch: jest.fn().mockResolvedValue(FIRST_TOKEN) };
        const harness = createHarness(alerts);
        const account = { accountId: '1001', profile: 'Main', displayName: 'Hero' };

        expect(await launch(harness, account)).toEqual({ success: true });

        expect(alerts.tokenForLaunch).toHaveBeenCalledWith('Main', account);
        expect(harness.launches).toHaveLength(1);
        const [{ args, options }] = harness.launches;
        expect(options.env).toEqual({ ...process.env, MICROBOT_CLIENT_TOKEN: FIRST_TOKEN });
        expect(args.join(' ')).not.toContain(FIRST_TOKEN);
        const logged = JSON.stringify([harness.log.info.mock.calls, harness.log.warn.mock.calls, harness.log.error.mock.calls]);
        expect(logged).not.toContain(FIRST_TOKEN);
    });

    test('the no-Jagex launch passes the preferred profile token the same way', async () => {
        const alerts = { tokenForLaunch: jest.fn().mockResolvedValue(FIRST_TOKEN) };
        const harness = createHarness(alerts);
        fs.writeFileSync(path.join(harness.deps.microbotDir, 'non-jagex-preferred-profile.json'), JSON.stringify({ profile: 'Ironman' }));
        await require('../libs/jar-executor')(harness.deps);

        await harness.handlers['play-no-jagex-account']({}, VERSION, null, '');
        await waitFor(() => harness.launches.length > 0);
        fs.rmSync(harness.deps.microbotDir, { recursive: true, force: true });

        expect(alerts.tokenForLaunch).toHaveBeenCalledWith('Ironman', null);
        expect(harness.launches[0].options.env.MICROBOT_CLIENT_TOKEN).toBe(FIRST_TOKEN);
        expect(harness.launches[0].args.join(' ')).not.toContain(FIRST_TOKEN);
    });

    test('signed out launches pass no token to the client', async () => {
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
        expect(harness.launches[0].options.env).not.toHaveProperty('MICROBOT_CLIENT_TOKEN');
    });

    test('a failing alert setup never blocks the launch', async () => {
        const alerts = { tokenForLaunch: jest.fn().mockRejectedValue(new Error('boom')) };
        const harness = createHarness(alerts);

        expect(await launch(harness, { profile: 'Main' })).toEqual({ success: true });

        expect(harness.launches).toHaveLength(1);
        expect(harness.launches[0].options.env).not.toHaveProperty('MICROBOT_CLIENT_TOKEN');
    });
});
