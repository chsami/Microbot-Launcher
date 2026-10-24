const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const setupApiAuth = require('../libs/api-auth');
const setupDashboardSession = require('../libs/dashboard-session');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }

    invoke(channel, payload) {
        return this.handlers.get(channel)(null, payload);
    }
}

class FakeCookies extends EventEmitter {
    constructor() {
        super();
        this.jar = new Map();
    }

    async set({ name, value }) {
        this.jar.set(name, value);
        this.emit('changed', {}, { domain: 'dashboard.test', name, value });
    }

    async remove(_url, name) {
        if (!this.jar.has(name)) return;
        const value = this.jar.get(name);
        this.jar.delete(name);
        this.emit('changed', {}, { domain: 'dashboard.test', name, value }, 'explicit', true);
    }

    async get() {
        return [...this.jar].map(([name, value]) => ({ name, value }));
    }
}

const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`),
    decryptString: (buffer) => buffer.toString().replace(/^enc:/, '')
};

const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });

const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe('dashboard session', () => {
    let dir;
    let sessionFile;
    let axios;
    let routes;
    let cookies;
    let sent;
    let ipcMain;
    let auth;

    const stored = () => JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile)));

    const setup = () => {
        ipcMain = new FakeIpcMain();
        auth = setupApiAuth({ ipcMain, log, axios, fs, safeStorage, sessionFile, baseUrl: 'https://api.test' });
        const win = { isDestroyed: () => false, webContents: { send: (channel) => sent.push(channel) } };
        setupDashboardSession({
            ipcMain,
            log,
            session: { fromPartition: () => ({ cookies }) },
            auth,
            getWindow: () => win,
            baseUrl: 'https://dashboard.test/'
        });
    };

    const signIn = () => ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'secret123' });

    const calls = (endpoint) =>
        axios.post.mock.calls.filter(([url]) => url === `https://api.test/api/auth/${endpoint}`).map(([, body]) => body);

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-session-'));
        sessionFile = path.join(dir, 'session.dat');
        cookies = new FakeCookies();
        sent = [];
        routes = {
            login: () => ({ data: { token: 'access', refreshToken: 'refresh' } }),
            'fork-session': () => ({ data: { token: 'dash-access', refreshToken: 'dash-refresh' } }),
            'refresh-token': () => ({ data: { token: 'rotated-access', refreshToken: 'rotated-refresh' } }),
            logout: () => ({ data: {} })
        };
        axios = {
            post: jest.fn(async (url) => {
                const route = routes[url.replace('https://api.test/api/auth/', '')];
                return route();
            })
        };
        setup();
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('opening the dashboard forks its own session and hands it over as cookies', async () => {
        await signIn();

        const result = await ipcMain.invoke('dashboard:open');

        expect(result).toEqual({ url: 'https://dashboard.test/dashboard/' });
        expect(calls('fork-session')).toEqual([{ refreshToken: 'refresh' }]);
        expect(cookies.jar.get('auth-token')).toBe('dash-access');
        expect(cookies.jar.get('refresh-token')).toBe('dash-refresh');
        expect(stored()).toMatchObject({
            refreshToken: 'refresh',
            dashboard: { accessToken: 'dash-access', refreshToken: 'dash-refresh' }
        });
    });

    test('the stored dashboard session is reused instead of forking again', async () => {
        await signIn();
        await ipcMain.invoke('dashboard:open');

        setup();
        await ipcMain.invoke('auth:status');
        await settle();
        await ipcMain.invoke('dashboard:open');

        expect(calls('fork-session')).toHaveLength(1);
        expect(cookies.jar.get('refresh-token')).toBe('dash-refresh');
    });

    test('signed out or an API without fork-session shows no dashboard', async () => {
        expect(await ipcMain.invoke('dashboard:open')).toEqual({ url: null });

        routes['fork-session'] = () => {
            throw httpError(404);
        };
        await signIn();

        expect(await ipcMain.invoke('dashboard:open')).toEqual({ url: null });
        expect(cookies.jar.size).toBe(0);
        expect((await ipcMain.invoke('auth:status')).authenticated).toBe(true);
    });

    test('tokens the dashboard rotates are saved for the next start', async () => {
        await signIn();
        await ipcMain.invoke('dashboard:open');

        await cookies.set({ name: 'auth-token', value: 'dash-access-2' });
        await cookies.set({ name: 'refresh-token', value: 'dash-refresh-2' });
        await settle();

        expect(stored()).toMatchObject({
            refreshToken: 'refresh',
            dashboard: { accessToken: 'dash-access-2', refreshToken: 'dash-refresh-2' }
        });
    });

    test('logging out in the dashboard signs the launcher out too', async () => {
        await signIn();
        await ipcMain.invoke('dashboard:open');

        await cookies.remove('', 'auth-token');
        await cookies.remove('', 'refresh-token');
        await settle();

        expect((await ipcMain.invoke('auth:status')).authenticated).toBe(false);
        expect(calls('logout')).toEqual(
            expect.arrayContaining([{ refreshToken: 'refresh' }, { refreshToken: 'rotated-refresh' }])
        );
        expect(sent).toContain('auth:changed');
        expect(fs.existsSync(sessionFile)).toBe(false);
    });

    test('a dead dashboard session is replaced and the launcher stays signed in', async () => {
        await signIn();
        await ipcMain.invoke('dashboard:open');
        routes['refresh-token'] = () => {
            throw httpError(401);
        };

        await cookies.remove('', 'auth-token');
        await cookies.remove('', 'refresh-token');
        await settle();

        expect((await ipcMain.invoke('auth:status')).authenticated).toBe(true);
        expect(stored().dashboard).toBeUndefined();
        expect(sent).toContain('dashboard:reload');

        routes['fork-session'] = () => ({ data: { token: 'dash-access-3', refreshToken: 'dash-refresh-3' } });
        await ipcMain.invoke('dashboard:open');
        expect(cookies.jar.get('refresh-token')).toBe('dash-refresh-3');
    });

    test('signing out of the launcher ends both sessions and clears the dashboard cookies', async () => {
        await signIn();
        await ipcMain.invoke('dashboard:open');

        await ipcMain.invoke('auth:signout');
        await settle();

        expect(calls('logout')).toEqual([{ refreshToken: 'refresh' }, { refreshToken: 'dash-refresh' }]);
        expect(cookies.jar.size).toBe(0);
        expect(calls('refresh-token')).toEqual([]);
    });

    test('a stale launcher refresh token is refreshed once before forking', async () => {
        await signIn();
        let forks = 0;
        routes['fork-session'] = () => {
            forks += 1;
            if (forks === 1) throw httpError(401);
            return { data: { token: 'dash-access', refreshToken: 'dash-refresh' } };
        };

        expect(await ipcMain.invoke('dashboard:open')).toEqual({ url: 'https://dashboard.test/dashboard/' });
        expect(calls('fork-session')).toEqual([{ refreshToken: 'refresh' }, { refreshToken: 'rotated-refresh' }]);
    });
});
