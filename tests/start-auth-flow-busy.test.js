const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../libs/oauth-jagex.js', () => ({
    startAuthFlow: jest.fn(async () => 'Authentication successful.'),
    cancelAuthFlow: jest.fn(),
    authFlowRunning: jest.fn(() => false),
    writeAccountsToFile: jest.fn()
}));

jest.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => null } }), { virtual: true });

describe('the sidebar login while another Jagex login runs', () => {
    let dir;
    let handlers;
    let oauth;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-busy-'));
        handlers = {};
        oauth = require('../libs/oauth-jagex.js');
        await require('../libs/ipc-handlers.js')({
            ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
            axios: {},
            microbotDir: dir,
            packageJson: { version: '1.0.0' },
            path,
            log: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
            dialog: {},
            fs,
            projectDir: path.join(__dirname, '..'),
            app: {}
        });
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        jest.clearAllMocks();
    });

    test('start-auth-flow is refused while a card login runs, so it cannot replace that login', async () => {
        oauth.authFlowRunning.mockReturnValue(true);

        expect(await handlers['start-auth-flow']({ sender: {} }, { proxyIp: '' })).toEqual({ error: 'A Jagex login is already open in your browser.' });
        expect(oauth.startAuthFlow).not.toHaveBeenCalled();
    });

    test('start-auth-flow runs as before when no login is open', async () => {
        oauth.authFlowRunning.mockReturnValue(false);

        expect(await handlers['start-auth-flow']({ sender: {} }, { proxyIp: '' })).toBe('Authentication successful.');
        expect(oauth.startAuthFlow).toHaveBeenCalledWith({ proxy: { proxyIp: '' } });
    });
});

describe('authFlowRunning', () => {
    test('is true from the moment a login starts until it ends', async () => {
        let oauth;
        let fail;
        jest.isolateModules(() => {
            jest.doMock('patchright', () => ({ chromium: {} }));
            jest.doMock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
            jest.doMock('electron-log', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
            jest.doMock('../libs/login-proxy.js', () => ({
                toProxyUri: (raw) => (raw ? `socks5://${raw}` : null),
                startLoginProxy: () => new Promise((_resolve, reject) => (fail = reject))
            }));
            oauth = jest.requireActual('../libs/oauth-jagex.js');
        });

        expect(oauth.authFlowRunning()).toBe(false);
        const flow = oauth.startAuthFlow({ proxy: { proxyIp: '203.0.113.7:1080' }, keepProxies: true });
        expect(oauth.authFlowRunning()).toBe(true);

        fail(new Error('proxy down'));
        await expect(flow).rejects.toThrow('proxy down');
        expect(oauth.authFlowRunning()).toBe(false);
    });
});
