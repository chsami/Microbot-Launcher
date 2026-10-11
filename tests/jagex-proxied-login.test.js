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
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jagex-proxied-login-'));
process.env.HOME = homeDir;

const axios = require('axios');
const { chromium } = require('patchright');
const { shell } = require('electron');
const { startLoginProxy } = require('../libs/login-proxy.js');
const { startAuthFlow, cancelAuthFlow } = require('../libs/oauth-jagex.js');

afterAll(() => fs.rmSync(homeDir, { recursive: true, force: true }));

function fakeBrowser(gotoError) {
    const handlers = {};
    const page = {
        handlers,
        once: jest.fn((event, fn) => (handlers[event] = fn)),
        on: jest.fn((event, fn) => (handlers[event] = fn)),
        route: jest.fn(async () => {}),
        goto: jest.fn(async () => {
            if (gotoError) throw gotoError;
        })
    };
    const browser = {
        newContext: jest.fn(async () => ({ newPage: async () => page })),
        close: jest.fn(async () => {})
    };
    return { browser, page };
}

function loginUrlParam(page, name) {
    return new URL(page.goto.mock.calls[0][0]).searchParams.get(name);
}

function redirectWithIdToken(page, idToken = 'token-1') {
    return { url: () => `http://localhost/#id_token=${idToken}&state=${loginUrlParam(page, 'state')}` };
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

    test('fails and closes the local proxy when the browser context cannot be created', async () => {
        const { browser } = fakeBrowser();
        browser.newContext.mockRejectedValue(new Error('Target page, context or browser has been closed'));
        chromium.launch.mockResolvedValue(browser);

        await expect(startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } })).rejects.toThrow(
            'Target page, context or browser has been closed'
        );
        expect(browser.close).toHaveBeenCalled();
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('cancelling while the browser is starting closes it and the local proxy', async () => {
        const { browser } = fakeBrowser();
        let finishLaunch;
        chromium.launch.mockReturnValue(new Promise((resolve) => (finishLaunch = resolve)));

        const flow = startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } });
        await new Promise((resolve) => setImmediate(resolve));
        expect(cancelAuthFlow()).toBe(true);
        finishLaunch(browser);

        await expect(flow).rejects.toMatchObject({ code: 'CANCELLED' });
        expect(browser.close).toHaveBeenCalled();
        expect(browser.newContext).not.toHaveBeenCalled();
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('creates the game session and fetches accounts through the local proxy', async () => {
        const { browser, page } = fakeBrowser();
        chromium.launch.mockResolvedValue(browser);
        axios.post.mockResolvedValue({ data: { sessionId: 'session-1' } });
        axios.get.mockResolvedValue({ data: [{ accountId: 'acc-1', displayName: 'Bob' }] });

        const flow = startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } });
        await new Promise((resolve) => setImmediate(resolve));
        await page.handlers.framenavigated(redirectWithIdToken(page));

        await expect(flow).resolves.toBe('Authentication successful.');
        expect(axios.post).toHaveBeenCalledWith(
            'https://auth.jagex.com/game-session/v1/sessions',
            { idToken: 'token-1' },
            expect.objectContaining({ proxy: false })
        );
        expect(axios.get).toHaveBeenCalledWith(
            'https://auth.jagex.com/game-session/v1/accounts',
            expect.objectContaining({ proxy: false })
        );
        const saved = JSON.parse(fs.readFileSync(path.join(homeDir, '.microbot', 'accounts.json'), 'utf8'));
        expect(saved).toEqual([expect.objectContaining({ accountId: 'acc-1', sessionId: 'session-1' })]);
        expect(browser.close).toHaveBeenCalled();
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('fails the login when the game session cannot be created through the proxy', async () => {
        const { browser, page } = fakeBrowser();
        chromium.launch.mockResolvedValue(browser);
        axios.post.mockRejectedValue(new Error('socket hang up'));

        const flow = startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } });
        await new Promise((resolve) => setImmediate(resolve));
        await page.handlers.framenavigated(redirectWithIdToken(page));

        await expect(flow).rejects.toThrow('Could not create a game session.');
        expect(axios.get).not.toHaveBeenCalled();
        expect(browser.close).toHaveBeenCalled();
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('keeps the local proxy open until the accounts are saved even if the page closes', async () => {
        const { browser, page } = fakeBrowser();
        chromium.launch.mockResolvedValue(browser);
        let finishSession;
        axios.post.mockReturnValue(new Promise((resolve) => (finishSession = resolve)));
        axios.get.mockResolvedValue({ data: [] });

        const flow = startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } });
        await new Promise((resolve) => setImmediate(resolve));
        const navigated = page.handlers.framenavigated(redirectWithIdToken(page));
        page.handlers.close();
        expect(cancelAuthFlow()).toBe(true);
        expect(loginProxy.close).not.toHaveBeenCalled();
        finishSession({ data: { sessionId: 'session-1' } });
        await navigated;

        await expect(flow).resolves.toBe('Authentication successful.');
        expect(axios.get).toHaveBeenCalled();
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('ignores an id_token whose state does not belong to this login', async () => {
        const { browser, page } = fakeBrowser();
        chromium.launch.mockResolvedValue(browser);

        const flow = startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } });
        await new Promise((resolve) => setImmediate(resolve));
        await page.handlers.framenavigated({ url: () => 'http://localhost/#id_token=injected&state=wrong' });
        await page.handlers.framenavigated({ url: () => 'http://localhost/#id_token=injected' });

        expect(axios.post).not.toHaveBeenCalled();
        expect(cancelAuthFlow()).toBe(true);
        await expect(flow).rejects.toMatchObject({ code: 'CANCELLED' });
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('uses a fresh state and PKCE challenge for every login', async () => {
        const logins = [];
        for (let i = 0; i < 2; i++) {
            const { browser, page } = fakeBrowser();
            chromium.launch.mockResolvedValue(browser);
            const flow = startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } });
            await new Promise((resolve) => setImmediate(resolve));
            logins.push({ state: loginUrlParam(page, 'state'), challenge: loginUrlParam(page, 'code_challenge') });
            cancelAuthFlow();
            await expect(flow).rejects.toMatchObject({ code: 'CANCELLED' });
        }

        expect(logins[0].state).toBeTruthy();
        expect(logins[0].challenge).toBeTruthy();
        expect(logins[1].state).not.toBe(logins[0].state);
        expect(logins[1].challenge).not.toBe(logins[0].challenge);
    });

    test('exchanges the code with the verifier that matches this login\'s challenge', async () => {
        const { browser, page } = fakeBrowser();
        chromium.launch.mockResolvedValue(browser);
        axios.post.mockResolvedValue({ data: {} });

        const flow = startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } });
        await new Promise((resolve) => setImmediate(resolve));
        await page.handlers.framenavigated({
            url: () => 'https://secure.runescape.com/m=weblogin/launcher-redirect?code=abc'
        });

        const [tokenUrl, body, options] = axios.post.mock.calls[0];
        expect(tokenUrl).toBe('https://account.jagex.com/oauth2/token');
        expect(body.get('code')).toBe('abc');
        const challenge = require('crypto').createHash('sha256').update(body.get('code_verifier')).digest('base64url');
        expect(challenge).toBe(loginUrlParam(page, 'code_challenge'));
        expect(options).toMatchObject({ proxy: false });
        cancelAuthFlow();
        await expect(flow).rejects.toMatchObject({ code: 'CANCELLED' });
    });
});
