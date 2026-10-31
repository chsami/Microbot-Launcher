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
    ...jest.requireActual('../libs/browser-util.js'),
    getAvailableBrowsers: jest.fn(async () => [{ browser: 'Google Chrome', executable: '/usr/bin/google-chrome' }])
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
const log = require('electron-log');
const { chromium } = require('patchright');
const { getAvailableBrowsers } = require('../libs/browser-util.js');
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

async function failureAfterRetries(flow) {
    const failure = flow.then(() => null, (error) => error);
    for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        await jest.advanceTimersByTimeAsync(1000);
    }
    return failure;
}

describe('startAuthFlow proxy routing', () => {
    let loginProxy;

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        jest.clearAllMocks();
        loginProxy = { url: 'http://127.0.0.1:5555', httpOptions: { proxy: false }, close: jest.fn(async () => {}) };
        startLoginProxy.mockResolvedValue(loginProxy);
    });

    afterEach(() => {
        jest.useRealTimers();
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
            timeout: 60000,
            env: expect.any(Object),
            proxy: { server: 'http://127.0.0.1:5555' },
            args: [
                '--edge-skip-compat-layer-relaunch',
                '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'
            ]
        });
        expect(browser.newContext).toHaveBeenCalledWith();
        expect(shell.openExternal).not.toHaveBeenCalled();
        expect(browser.close).toHaveBeenCalled();
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('closes the local proxy when the browser cannot start', async () => {
        chromium.launch.mockRejectedValue(new Error('Executable doesn\'t exist'));

        const error = await failureAfterRetries(startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } }));

        expect(error.message).toContain('Could not open the Jagex login window in Google Chrome.');
        expect(error.message).not.toContain('install Google Chrome');
        expect(chromium.launch).toHaveBeenCalledTimes(2);
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
            executablePath: '/usr/bin/google-chrome',
            timeout: 60000,
            env: expect.any(Object),
            args: ['--edge-skip-compat-layer-relaunch']
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

        const flow = startAuthFlow({ proxy: { proxyIp: ' 1.2.3.4:1080 ' } });
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
        expect(saved).toEqual([
            expect.objectContaining({ accountId: 'acc-1', sessionId: 'session-1', proxyIp: '1.2.3.4:1080' })
        ]);
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

describe('login browser launch', () => {
    const edge = { browser: 'Microsoft Edge', executable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' };
    const opera = { browser: 'Opera', executable: 'C:\\Users\\bob\\AppData\\Local\\Programs\\Opera\\opera.exe' };
    const closedError = 'browserType.launch: Target page, context or browser has been closed';
    let loginProxy;

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        jest.clearAllMocks();
        loginProxy = { url: 'http://127.0.0.1:5555', httpOptions: { proxy: false }, close: jest.fn(async () => {}) };
        startLoginProxy.mockResolvedValue(loginProxy);
        getAvailableBrowsers.mockResolvedValue([edge, opera]);
        process.env.__compat_layer = 'RunAsAdmin';
    });

    afterEach(() => {
        delete process.env.__compat_layer;
        jest.useRealTimers();
    });

    test('starts the browser without the compatibility layer and with the Edge relaunch switch', async () => {
        const { browser } = fakeBrowser(new Error('net::ERR_TUNNEL_CONNECTION_FAILED'));
        chromium.launch.mockResolvedValue(browser);

        await expect(startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } })).rejects.toThrow(
            'Could not reach Jagex through the proxy'
        );

        const options = chromium.launch.mock.calls[0][0];
        expect(options.executablePath).toBe(edge.executable);
        expect(options.args).toContain('--edge-skip-compat-layer-relaunch');
        expect(Object.keys(options.env).map((key) => key.toUpperCase())).not.toContain('__COMPAT_LAYER');
        expect(options.env.HOME).toBe(process.env.HOME);
        expect(process.env.__compat_layer).toBe('RunAsAdmin');
        const logged = log.info.mock.calls.map(([line]) => line).join('\n');
        expect(logged).toContain('__COMPAT_LAYER is set');
        expect(logged).not.toContain('RunAsAdmin');
        expect(logged).toContain(`Microsoft Edge (${edge.executable})`);
    });

    test('retries the same browser once, then falls back to the next one', async () => {
        const { browser } = fakeBrowser(new Error('net::ERR_TUNNEL_CONNECTION_FAILED'));
        chromium.launch
            .mockRejectedValueOnce(new Error(closedError))
            .mockRejectedValueOnce(new Error(closedError))
            .mockResolvedValueOnce(browser);

        const error = await failureAfterRetries(startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } }));

        expect(error.message).toContain('Could not reach Jagex through the proxy');
        expect(chromium.launch.mock.calls.map(([options]) => options.executablePath)).toEqual([
            edge.executable,
            edge.executable,
            opera.executable
        ]);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(`Microsoft Edge (${edge.executable}) failed to start, attempt 1/2: ${closedError}`));
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('attempt 2/2'));
        expect(browser.close).toHaveBeenCalled();
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('a retry that succeeds keeps the same browser', async () => {
        const { browser } = fakeBrowser(new Error('net::ERR_TUNNEL_CONNECTION_FAILED'));
        chromium.launch.mockRejectedValueOnce(new Error(closedError)).mockResolvedValueOnce(browser);

        const error = await failureAfterRetries(startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } }));

        expect(error.message).toContain('Could not reach Jagex through the proxy');
        expect(chromium.launch.mock.calls.map(([options]) => options.executablePath)).toEqual([
            edge.executable,
            edge.executable
        ]);
    });

    const adminStep =
        'If the Microbot Launcher runs as administrator or in compatibility mode, turn that off ' +
        '(right-click its shortcut → Properties → Compatibility) and restart the launcher.';
    const helpLine = 'If it still fails, ask for help in the Microbot Discord.';
    const chrome = { browser: 'Google Chrome', executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' };
    const brave = { browser: 'Brave Browser', executable: '/usr/bin/brave-browser' };
    const operaStub = { browser: 'Opera', executable: 'C:\\Users\\bob\\AppData\\Local\\Programs\\Opera\\launcher.exe' };

    async function failedLoginMessage(browsers, platform) {
        const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: platform });
        try {
            getAvailableBrowsers.mockResolvedValue(browsers);
            chromium.launch.mockRejectedValue(new Error(closedError));
            const error = await failureAfterRetries(startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } }));
            return error.message;
        } finally {
            Object.defineProperty(process, 'platform', realPlatform);
        }
    }

    test('shows the player numbered steps instead of the raw error once every browser fails', async () => {
        const message = await failedLoginMessage([edge, opera], 'win32');

        expect(message).toBe(
            'Could not open the Jagex login window in Microsoft Edge or Opera.\n' +
            '\n' +
            `1. ${adminStep}\n` +
            '2. Install Google Chrome and try again.\n' +
            '\n' +
            helpLine
        );
        expect(message).not.toContain(closedError);
        expect(chromium.launch).toHaveBeenCalledTimes(4);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(closedError));
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('on Windows with only Edge it suggests the compatibility fix and Chrome', async () => {
        expect(await failedLoginMessage([edge], 'win32')).toBe(
            'Could not open the Jagex login window in Microsoft Edge.\n' +
            '\n' +
            `1. ${adminStep}\n` +
            '2. Install Google Chrome and try again.\n' +
            '\n' +
            helpLine
        );
    });

    test('drops the Chrome step when Chrome was already tried', async () => {
        expect(await failedLoginMessage([chrome, edge], 'win32')).toBe(
            'Could not open the Jagex login window in Google Chrome or Microsoft Edge.\n' +
            '\n' +
            `1. ${adminStep}\n` +
            '\n' +
            helpLine
        );
    });

    test('leaves out the Windows compatibility advice on macOS and Linux', async () => {
        for (const platform of ['darwin', 'linux']) {
            const message = await failedLoginMessage([edge], platform);
            expect(message).toBe(
                'Could not open the Jagex login window in Microsoft Edge.\n' +
                '\n' +
                '1. Close all Microsoft Edge windows, restart the launcher and try again.\n' +
                '2. Install Google Chrome and try again.\n' +
                '\n' +
                helpLine
            );
            expect(message).not.toContain('Compatibility');
        }
    });

    test('lists three or more browsers as "A, B or C"', async () => {
        expect(await failedLoginMessage([brave, { ...chrome, executable: '/usr/bin/google-chrome' }, edge], 'linux')).toBe(
            'Could not open the Jagex login window in Brave Browser, Google Chrome or Microsoft Edge.\n' +
            '\n' +
            '1. Close all Brave Browser, Google Chrome and Microsoft Edge windows, restart the launcher and try again.\n' +
            '\n' +
            helpLine
        );
    });

    test('asks the player to close empty windows when the Opera launcher stub was tried', async () => {
        expect(await failedLoginMessage([edge, operaStub], 'win32')).toBe(
            'Could not open the Jagex login window in Microsoft Edge or Opera.\n' +
            '\n' +
            '1. Close any empty browser windows the launcher opened.\n' +
            `2. ${adminStep}\n` +
            '3. Install Google Chrome and try again.\n' +
            '\n' +
            helpLine
        );
    });

    test('cancelling between attempts stops trying other browsers', async () => {
        chromium.launch.mockRejectedValue(new Error(closedError));

        const flow = startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } });
        await new Promise((resolve) => setImmediate(resolve));
        expect(cancelAuthFlow()).toBe(true);

        expect(await failureAfterRetries(flow)).toMatchObject({ code: 'CANCELLED' });
        expect(chromium.launch).toHaveBeenCalledTimes(1);
        expect(loginProxy.close).toHaveBeenCalled();
    });

    test('a browser that times out is not retried and the next one is tried', async () => {
        const { browser } = fakeBrowser(new Error('net::ERR_TUNNEL_CONNECTION_FAILED'));
        const timeout = new Error('browserType.launch: Timeout 60000ms exceeded.');
        timeout.name = 'TimeoutError';
        chromium.launch.mockRejectedValueOnce(timeout).mockResolvedValueOnce(browser);

        const error = await failureAfterRetries(startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } }));

        expect(error.message).toContain('Could not reach Jagex through the proxy');
        expect(chromium.launch.mock.calls.map(([options]) => options.executablePath)).toEqual([
            edge.executable,
            opera.executable
        ]);
        expect(chromium.launch.mock.calls[0][0].timeout).toBe(60000);
    });

    test('cancelling during the last attempt does not report a launch failure', async () => {
        getAvailableBrowsers.mockResolvedValue([edge]);
        let failLastLaunch;
        chromium.launch
            .mockRejectedValueOnce(new Error(closedError))
            .mockReturnValueOnce(new Promise((resolve, reject) => (failLastLaunch = reject)));

        const flow = startAuthFlow({ proxy: { proxyIp: '1.2.3.4:1080' } });
        const failure = flow.then(() => null, (error) => error);
        await new Promise((resolve) => setImmediate(resolve));
        await jest.advanceTimersByTimeAsync(1000);
        expect(chromium.launch).toHaveBeenCalledTimes(2);
        expect(cancelAuthFlow()).toBe(true);
        failLastLaunch(new Error(closedError));

        expect(await failure).toMatchObject({ code: 'CANCELLED' });
        await new Promise((resolve) => setImmediate(resolve));
        expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('Could not start any login browser'));
        expect(loginProxy.close).toHaveBeenCalled();
    });
});
