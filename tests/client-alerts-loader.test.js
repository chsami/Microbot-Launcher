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

const LOADER_TOKEN = `mbc_${'L'.repeat(43)}`;
const PROFILE_TOKEN = `mbc_${'P'.repeat(43)}`;
const NEXT_TOKEN = `mbc_${'N'.repeat(43)}`;
const LOADER_ID = '44444444-4444-4444-4444-444444444444';
const PROFILE_ID = '55555555-5555-5555-5555-555555555555';
const NEXT_ID = '66666666-6666-6666-6666-666666666666';

describe('client-alerts RuneLite link', () => {
    let dir;
    let linksFile;
    let log;
    let auth;
    let email;
    let serverLinks;
    let created;

    const setup = (overrides = {}) =>
        setupClientAlerts({
            ipcMain: new FakeIpcMain(),
            log,
            fs,
            safeStorage,
            auth,
            linksFile,
            settingsFile: path.join(dir, 'alert-profiles.json'),
            ...overrides
        });

    const stored = () => JSON.parse(safeStorage.decryptString(fs.readFileSync(linksFile)));
    const posts = () => auth.request.mock.calls.filter(([config]) => config.method === 'post').map(([config]) => config.data.label);
    const logged = () => [...log.info.mock.calls, ...log.warn.mock.calls].map((args) => args.join(' ')).join('\n');

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-alerts-loader-'));
        linksFile = path.join(dir, 'alert-links.dat');
        log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        email = 'admin@example.com';
        serverLinks = [];
        created = [];
        auth = {
            email: () => email,
            request: jest.fn(async (config) => {
                if (config.method === 'get') return { data: serverLinks.map((id) => ({ id, label: 'x' })) };
                if (config.method === 'delete') {
                    serverLinks = serverLinks.filter((id) => config.path !== `/api/alerts/client-links/${id}`);
                    return { status: 204 };
                }
                const next = created.shift();
                serverLinks.push(next.id);
                return { data: { id: next.id, label: config.data.label, token: next.token } };
            })
        };
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('creates one link named for RuneLite and reuses it', async () => {
        created = [{ id: LOADER_ID, token: LOADER_TOKEN }];

        expect(await setup().tokenForLoader()).toBe(LOADER_TOKEN);
        expect(await setup().tokenForLoader()).toBe(LOADER_TOKEN);

        expect(posts()).toEqual(['RuneLite (Microbot Loader)']);
        expect(stored().loader).toEqual({ runelite: { id: LOADER_ID, token: LOADER_TOKEN, label: 'RuneLite (Microbot Loader)' } });
        expect(logged()).not.toContain(LOADER_TOKEN);
    });

    test('keeps its own slot next to a profile called runelite', async () => {
        created = [{ id: PROFILE_ID, token: PROFILE_TOKEN }, { id: LOADER_ID, token: LOADER_TOKEN }];
        const alerts = setup();

        expect(await alerts.tokenForProfile('runelite')).toBe(PROFILE_TOKEN);
        expect(await alerts.tokenForLoader()).toBe(LOADER_TOKEN);
        expect(await alerts.tokenForProfile('runelite')).toBe(PROFILE_TOKEN);

        expect(stored().profiles.runelite.token).toBe(PROFILE_TOKEN);
        expect(stored().loader.runelite.token).toBe(LOADER_TOKEN);
        expect(alerts.linkedProfiles()).toEqual({ runelite: PROFILE_ID });
    });

    test('profile writes keep the RuneLite link', async () => {
        created = [{ id: LOADER_ID, token: LOADER_TOKEN }, { id: PROFILE_ID, token: PROFILE_TOKEN }];
        const alerts = setup();
        await alerts.tokenForLoader();
        await alerts.tokenForProfile('Main');

        expect(stored().loader.runelite.id).toBe(LOADER_ID);
    });

    test('a link revoked on the dashboard is replaced', async () => {
        created = [{ id: LOADER_ID, token: LOADER_TOKEN }, { id: NEXT_ID, token: NEXT_TOKEN }];
        const alerts = setup();
        await alerts.tokenForLoader();
        serverLinks = [];

        expect(await alerts.tokenForLoader()).toBe(NEXT_TOKEN);
    });

    test('two calls at once create one link', async () => {
        created = [{ id: LOADER_ID, token: LOADER_TOKEN }];
        const alerts = setup();

        expect(await Promise.all([alerts.tokenForLoader(), alerts.tokenForLoader()])).toEqual([LOADER_TOKEN, LOADER_TOKEN]);
        expect(posts()).toHaveLength(1);
    });

    test('signed out is a 401', async () => {
        email = null;

        await expect(setup().tokenForLoader()).rejects.toMatchObject({ response: { status: 401 } });
        expect(auth.request).not.toHaveBeenCalled();
    });

    test('forgetting the link revokes it on the dashboard', async () => {
        created = [{ id: LOADER_ID, token: LOADER_TOKEN }];
        const alerts = setup();
        await alerts.tokenForLoader();

        await alerts.forgetLoaderToken();

        expect(auth.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'delete', path: `/api/alerts/client-links/${LOADER_ID}` }));
        expect(stored().loader).toBeUndefined();
        expect(stored().revoke).toEqual([]);
        expect(serverLinks).toEqual([]);
    });

    test('without secure storage the earlier RuneLite links are revoked before a new one is made', async () => {
        created = [{ id: NEXT_ID, token: NEXT_TOKEN }];
        serverLinks = [LOADER_ID, PROFILE_ID];
        const labels = { [LOADER_ID]: 'RuneLite (Microbot Loader)', [PROFILE_ID]: 'Microbot client' };
        const request = auth.request;
        auth.request = jest.fn(async (config) => {
            if (config.method === 'get') return { data: serverLinks.map((id) => ({ id, label: labels[id] })) };
            return request(config);
        });
        const alerts = setup({ safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });

        expect(await alerts.tokenForLoader()).toBe(NEXT_TOKEN);

        const calls = auth.request.mock.calls.map(([config]) => `${config.method} ${config.path}`);
        expect(calls).toEqual([
            'get /api/alerts/client-links?includeHidden=true',
            `delete /api/alerts/client-links/${LOADER_ID}`,
            'post /api/alerts/client-links'
        ]);
        expect(serverLinks).toEqual([PROFILE_ID, NEXT_ID]);
        expect(fs.existsSync(linksFile)).toBe(false);
    });

    test('without secure storage Remove revokes the RuneLite links by name', async () => {
        serverLinks = [LOADER_ID, PROFILE_ID];
        const labels = { [LOADER_ID]: 'RuneLite (Microbot Loader)', [PROFILE_ID]: 'Microbot client' };
        const request = auth.request;
        auth.request = jest.fn(async (config) => {
            if (config.method === 'get') return { data: serverLinks.map((id) => ({ id, label: labels[id] })) };
            return request(config);
        });
        const alerts = setup({ safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });

        await alerts.forgetLoaderToken();

        expect(serverLinks).toEqual([PROFILE_ID]);
    });

    test('without secure storage a failed listing still creates the link', async () => {
        created = [{ id: LOADER_ID, token: LOADER_TOKEN }];
        const request = auth.request;
        auth.request = jest.fn(async (config) => {
            if (config.method === 'get') throw Object.assign(new Error('HTTP 500'), { response: { status: 500 } });
            return request(config);
        });
        const alerts = setup({ safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });

        expect(await alerts.tokenForLoader()).toBe(LOADER_TOKEN);
        expect(log.warn).toHaveBeenCalled();
    });

    test('without secure storage a link is still created but not saved', async () => {
        created = [{ id: LOADER_ID, token: LOADER_TOKEN }];
        const alerts = setup({ safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });

        expect(await alerts.tokenForLoader()).toBe(LOADER_TOKEN);
        expect(fs.existsSync(linksFile)).toBe(false);
    });
});
