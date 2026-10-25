const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const setupBackgroundMode = require('../libs/background-mode.js');

function setup({ settings, lockAvailable = true, trayFails = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'background-mode-'));
    const settingsFile = path.join(dir, 'launcher-settings.json');
    if (settings !== undefined) fs.writeFileSync(settingsFile, settings);

    let locked = false;
    const app = Object.assign(new EventEmitter(), {
        quit: jest.fn(),
        requestSingleInstanceLock: jest.fn(() => {
            if (lockAvailable) locked = true;
            return lockAvailable;
        }),
        hasSingleInstanceLock: jest.fn(() => locked),
        releaseSingleInstanceLock: jest.fn(() => {
            locked = false;
        })
    });
    const handlers = {};
    const ipcMain = { handle: (channel, fn) => (handlers[channel] = fn) };
    const trays = [];
    class Tray extends EventEmitter {
        constructor(icon) {
            super();
            if (trayFails) throw new Error('no tray');
            this.icon = icon;
            this.setToolTip = jest.fn();
            this.setContextMenu = jest.fn((menu) => (this.menu = menu));
            this.destroy = jest.fn();
            trays.push(this);
        }
    }
    const Menu = { buildFromTemplate: (template) => template };
    const nativeImage = { createFromPath: jest.fn(() => ({ resize: () => 'icon' })) };
    const notifications = [];
    class Notification {
        static isSupported() {
            return true;
        }
        constructor(options) {
            this.options = options;
            this.show = jest.fn();
            notifications.push(this);
        }
    }
    const win = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        isMinimized: jest.fn(() => false),
        restore: jest.fn(),
        show: jest.fn(),
        focus: jest.fn(),
        hide: jest.fn()
    });
    const log = { info: jest.fn(), warn: jest.fn() };
    const background = setupBackgroundMode({
        app,
        ipcMain,
        Tray,
        Menu,
        nativeImage,
        Notification,
        log,
        fs,
        settingsFile,
        iconPath: '/icon.png',
        getWindow: () => win
    });
    background.attachWindow(win);

    const closeWindow = () => {
        const event = { preventDefault: jest.fn() };
        win.emit('close', event);
        return event;
    };
    const readSettings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));

    return { app, handlers, trays, notifications, win, log, background, closeWindow, readSettings };
}

describe('background mode', () => {
    test('is off by default, so closing quits like before', async () => {
        const { app, background, closeWindow, trays, handlers } = setup();
        expect(background.claimInstance()).toBe(true);
        expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
        background.start();
        expect(trays).toHaveLength(0);

        background.close();
        expect(app.quit).toHaveBeenCalled();
        expect(closeWindow().preventDefault).not.toHaveBeenCalled();
        await expect(handlers['background:status']()).resolves.toEqual({ enabled: false });
    });

    test('hides to the tray on close once switched on, and says so once', async () => {
        const { app, background, closeWindow, trays, handlers, win, notifications, readSettings } = setup();
        await expect(handlers['background:set-enabled']({}, true)).resolves.toEqual({ enabled: true });
        expect(readSettings()).toEqual({ runInBackground: true });
        expect(trays).toHaveLength(1);
        expect(app.requestSingleInstanceLock).toHaveBeenCalled();

        background.close();
        expect(app.quit).not.toHaveBeenCalled();
        expect(win.hide).toHaveBeenCalledTimes(1);

        const event = closeWindow();
        expect(event.preventDefault).toHaveBeenCalled();
        expect(win.hide).toHaveBeenCalledTimes(2);
        expect(notifications).toHaveLength(1);
        expect(notifications[0].show).toHaveBeenCalled();
    });

    test('quits for real from the tray menu', () => {
        const { app, background, closeWindow, trays } = setup({ settings: '{"runInBackground":true}' });
        background.start();
        const quitItem = trays[0].menu.find((item) => item.label === 'Quit');
        quitItem.click();
        expect(app.quit).toHaveBeenCalled();
        expect(closeWindow().preventDefault).not.toHaveBeenCalled();
    });

    test('lets the app quit after before-quit, as on Cmd+Q', () => {
        const { app, closeWindow } = setup({ settings: '{"runInBackground":true}' });
        app.emit('before-quit');
        expect(closeWindow().preventDefault).not.toHaveBeenCalled();
    });

    test('lets an update install close the window', () => {
        const { background, closeWindow } = setup({ settings: '{"runInBackground":true}' });
        background.allowQuit();
        expect(closeWindow().preventDefault).not.toHaveBeenCalled();
    });

    test('opens the launcher from the tray and when it is started again', () => {
        const { app, background, trays, win } = setup({ settings: '{"runInBackground":true}' });
        background.start();
        trays[0].emit('click');
        expect(win.show).toHaveBeenCalledTimes(1);
        win.isMinimized.mockReturnValue(true);
        app.emit('second-instance');
        expect(win.restore).toHaveBeenCalled();
        expect(win.show).toHaveBeenCalledTimes(2);
        expect(win.focus).toHaveBeenCalledTimes(2);
    });

    test('a second launcher hands over to the one already running in the background', () => {
        const { background, log } = setup({ settings: '{"runInBackground":true}', lockAvailable: false });
        expect(background.claimInstance()).toBe(false);
        expect(log.info).toHaveBeenCalled();
    });

    test('switching off removes the tray, frees the lock and keeps other settings', async () => {
        const { app, handlers, trays, background, readSettings } = setup({
            settings: '{"runInBackground":true,"other":1}'
        });
        expect(background.claimInstance()).toBe(true);
        background.start();
        await expect(handlers['background:set-enabled']({}, false)).resolves.toEqual({ enabled: false });
        expect(trays[0].destroy).toHaveBeenCalled();
        expect(app.releaseSingleInstanceLock).toHaveBeenCalled();
        expect(readSettings()).toEqual({ runInBackground: false, other: 1 });
        background.close();
        expect(app.quit).toHaveBeenCalled();
    });

    test('will not switch on while another launcher already runs in the background', async () => {
        const { handlers, trays, background, closeWindow } = setup({ lockAvailable: false });
        const result = await handlers['background:set-enabled']({}, true);
        expect(result.enabled).toBe(false);
        expect(result.error).toMatch(/already running in the background/);
        expect(trays).toHaveLength(0);
        expect(background.isEnabled()).toBe(false);
        expect(closeWindow().preventDefault).not.toHaveBeenCalled();
    });

    test('treats an unreadable settings file as off', () => {
        const { background, log } = setup({ settings: 'not json' });
        expect(background.isEnabled()).toBe(false);
        expect(log.warn).toHaveBeenCalled();
    });

    test('still hides when the desktop has no tray, since starting again brings it back', () => {
        const { background, log, win, trays } = setup({ settings: '{"runInBackground":true}', trayFails: true });
        background.start();
        expect(trays).toHaveLength(0);
        expect(log.warn).toHaveBeenCalled();
        background.close();
        expect(win.hide).toHaveBeenCalled();
    });
});
