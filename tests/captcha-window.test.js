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

    loadURL(url) {
        this.url = url;
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

    beforeEach(() => {
        FakeBrowserWindow.loadResult = Promise.resolve();
        shell = { openExternal: jest.fn() };
        open = createCaptchaWindow({ BrowserWindow: FakeBrowserWindow, shell, getParent: () => null, log });
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
