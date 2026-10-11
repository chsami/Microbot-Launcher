jest.mock('electron-log', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('electron', () => ({ shell: { openExternal: jest.fn() } }), { virtual: true });
jest.mock('http', () => ({
    ...jest.requireActual('http'),
    createServer: jest.fn(() => {
        const { EventEmitter } = require('events');
        const server = new EventEmitter();
        server.listen = () => {
            const error = new Error('listen EACCES: permission denied 127.0.0.1:80');
            error.code = 'EACCES';
            process.nextTick(() => server.emit('error', error));
        };
        server.close = jest.fn();
        return server;
    })
}));
jest.mock('../libs/browser-util.js', () => ({
    getAvailableBrowser: jest.fn(async () => ({ browser: 'Google Chrome', executable: '/usr/bin/google-chrome' }))
}));
jest.mock('../libs/login-proxy.js', () => ({
    ...jest.requireActual('../libs/login-proxy.js'),
    startLoginProxy: jest.fn()
}));
jest.mock('patchright', () => ({ chromium: { launch: jest.fn() } }));

const { chromium } = require('patchright');
const { shell } = require('electron');
const { startLoginProxy } = require('../libs/login-proxy.js');
const { startAuthFlow } = require('../libs/oauth-jagex.js');

function fakeBrowser(gotoError) {
    const page = {
        once: jest.fn(),
        on: jest.fn(),
        route: jest.fn(async () => {}),
        goto: jest.fn(async () => {
            throw gotoError;
        })
    };
    const browser = {
        newContext: jest.fn(async () => ({ newPage: async () => page })),
        close: jest.fn(async () => {})
    };
    return { browser, page };
}

describe('startAuthFlow proxy routing', () => {
    let loginProxy;

    beforeEach(() => {
        jest.clearAllMocks();
        loginProxy = { url: 'http://127.0.0.1:5555', httpOptions: { proxy: false }, close: jest.fn(async () => {}) };
        startLoginProxy.mockResolvedValue(loginProxy);
    });

    test('logs in through the proxy in an isolated browser instead of the system browser', async () => {
        const { browser } = fakeBrowser(new Error('net::ERR_TUNNEL_CONNECTION_FAILED'));
        chromium.launch.mockResolvedValue(browser);

        await expect(startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080:bob:hunter2' } })).rejects.toThrow(
            'Could not reach Jagex through the proxy: net::ERR_TUNNEL_CONNECTION_FAILED'
        );

        expect(startLoginProxy).toHaveBeenCalledWith('socks5://bob:hunter2@1.2.3.4:1080');
        expect(chromium.launch).toHaveBeenCalledWith({
            headless: false,
            executablePath: '/usr/bin/google-chrome',
            proxy: { server: 'http://127.0.0.1:5555' },
            args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']
        });
        expect(browser.newContext).toHaveBeenCalledWith();
        expect(shell.openExternal).not.toHaveBeenCalled();
        expect(browser.close).toHaveBeenCalled();
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('closes the local proxy when the browser cannot start', async () => {
        chromium.launch.mockRejectedValue(new Error('Executable doesn\'t exist'));

        await expect(startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } })).rejects.toThrow(
            'Could not start the login browser: Executable doesn\'t exist'
        );
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('does not start a local proxy when no proxy is set', async () => {
        const { browser } = fakeBrowser(new Error('net::ERR_NAME_NOT_RESOLVED'));
        chromium.launch.mockResolvedValue(browser);

        await expect(startAuthFlow({ proxy: { proxyIp: '' } })).rejects.toThrow(
            'Could not open the Jagex login page: net::ERR_NAME_NOT_RESOLVED'
        );

        expect(startLoginProxy).not.toHaveBeenCalled();
        expect(chromium.launch).toHaveBeenCalledWith({
            headless: false,
            executablePath: '/usr/bin/google-chrome'
        });
    });
});
