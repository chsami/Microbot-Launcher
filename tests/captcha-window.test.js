const createCaptchaWindow = require('../libs/captcha-window');

class FakeWebContents {
    constructor() {
        this.listeners = {};
    }

    on(event, listener) {
        this.listeners[event] = listener;
    }

    emit(event, ...args) {
        this.listeners[event]?.(...args);
    }

    setWindowOpenHandler(handler) {
        this.openHandler = handler;
    }

    executeJavaScript(code) {
        this.executed = code;
        return Promise.resolve();
    }
}

class FakeBrowserWindow {
    constructor(options) {
        this.options = options;
        this.webContents = new FakeWebContents();
        this.listeners = {};
        this.destroyed = false;
        FakeBrowserWindow.last = this;
    }

    on(event, listener) {
        this.listeners[event] = listener;
    }

    loadURL(url, options) {
        this.url = url;
        this.loadOptions = options;
        return FakeBrowserWindow.loadResult;
    }

    isDestroyed() {
        return this.destroyed;
    }

    close() {
        this.destroyed = true;
        this.listeners.closed?.();
    }
}

describe('captcha-window', () => {
    const log = { warn: jest.fn() };
    let shell;
    let open;
    let browserCheck;
    let openInBrowser;

    beforeEach(() => {
        log.warn.mockClear();
        FakeBrowserWindow.loadResult = Promise.resolve();
        shell = { openExternal: jest.fn() };
        browserCheck = null;
        openInBrowser = jest.fn(() => {
            let resolve;
            browserCheck = { promise: new Promise((r) => { resolve = r; }), cancel: jest.fn(() => resolve(null)) };
            browserCheck.resolve = resolve;
            return browserCheck;
        });
        open = createCaptchaWindow({ BrowserWindow: FakeBrowserWindow, shell, getParent: () => null, log, openInBrowser });
    });

    test('resolves with the token the page reports and closes', async () => {
        const pending = open('https://microbot.cloud/api/captcha');
        const win = FakeBrowserWindow.last;

        win.webContents.emit('did-navigate-in-page', {}, 'https://microbot.cloud/api/captcha#token=abc%2B1');

        await expect(pending).resolves.toBe('abc+1');
        expect(win.url).toBe('https://microbot.cloud/api/captcha');
        expect(win.isDestroyed()).toBe(true);
        expect(win.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    });

    test('logs Turnstile errors from the page', () => {
        open('https://microbot.cloud/api/captcha');
        const contents = FakeBrowserWindow.last.webContents;

        contents.emit('console-message', {}, 2, '[Cloudflare Turnstile] Error: 600010.');
        contents.emit('console-message', {}, 1, 'unrelated noise');

        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith('Captcha page: [Cloudflare Turnstile] Error: 600010.');
    });

    test('continues in the browser when Cloudflare fails the check in the launcher', async () => {
        const pending = open('https://microbot.cloud/api/captcha');
        const win = FakeBrowserWindow.last;

        win.webContents.emit('did-navigate-in-page', {}, 'https://microbot.cloud/api/captcha#error=600010');

        expect(openInBrowser).toHaveBeenCalledWith('https://microbot.cloud/api/captcha');
        expect(win.isDestroyed()).toBe(false);
        expect(win.webContents.executed).toContain('Finish the check in the browser');

        browserCheck.resolve('browser-token');

        await expect(pending).resolves.toBe('browser-token');
        expect(win.isDestroyed()).toBe(true);
    });

    test('closing the window cancels the browser check', async () => {
        const pending = open('https://microbot.cloud/api/captcha');
        const win = FakeBrowserWindow.last;
        win.webContents.emit('did-navigate-in-page', {}, 'https://microbot.cloud/api/captcha#error=600010');

        win.close();

        await expect(pending).resolves.toBeNull();
        expect(browserCheck.cancel).toHaveBeenCalled();
    });

    test('resolves with null when the user closes the window', async () => {
        const pending = open('https://microbot.cloud/api/captcha');

        FakeBrowserWindow.last.close();

        await expect(pending).resolves.toBeNull();
    });

    test('resolves with null when the page cannot load', async () => {
        FakeBrowserWindow.loadResult = Promise.reject(new Error('ERR_NAME_NOT_RESOLVED'));

        await expect(open('https://microbot.cloud/api/captcha')).resolves.toBeNull();
    });

    test('keeps navigation on the captcha page and opens links in the browser', () => {
        open('https://microbot.cloud/api/captcha');
        const win = FakeBrowserWindow.last;
        const away = { preventDefault: jest.fn() };
        const same = { preventDefault: jest.fn() };

        win.webContents.emit('will-navigate', away, 'https://evil.example/');
        win.webContents.emit('will-navigate', same, 'https://microbot.cloud/api/captcha');
        const result = win.webContents.openHandler({ url: 'https://www.cloudflare.com/privacypolicy/' });

        expect(away.preventDefault).toHaveBeenCalled();
        expect(same.preventDefault).not.toHaveBeenCalled();
        expect(result).toEqual({ action: 'deny' });
        expect(shell.openExternal).toHaveBeenCalledWith('https://www.cloudflare.com/privacypolicy/');
    });
});
