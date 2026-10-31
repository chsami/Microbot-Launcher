const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    registerLauncherUpdater,
    RECHECK_EVERY_MS,
    SHOWN_RECHECK_AFTER_MS
} = require('../libs/launcher-updater.js');

function setup(beforeInstall, { env = {}, platform = 'linux' } = {}) {
    const autoUpdater = Object.assign(new EventEmitter(), {
        currentVersion: { version: '3.2.16' },
        downloadUpdate: jest.fn(),
        quitAndInstall: jest.fn(),
        checkForUpdates: jest.fn(() => Promise.resolve())
    });
    const handlers = {};
    const ipcMain = { handle: (channel, fn) => (handlers[channel] = fn) };
    const send = jest.fn();
    const log = { error: jest.fn(), warn: jest.fn() };
    const notices = [];
    const Notification = jest.fn(function (options) {
        const notice = Object.assign(new EventEmitter(), { options, show: jest.fn() });
        notices.push(notice);
        return notice;
    });
    Notification.isSupported = jest.fn(() => true);
    const showWindow = jest.fn();
    const clock = { now: 1_000_000 };
    const timers = [];
    const every = jest.fn((fn, ms) => {
        timers.push({ fn, ms });
        return { unref: jest.fn() };
    });
    const updater = registerLauncherUpdater({
        autoUpdater,
        ipcMain,
        log,
        send,
        Notification,
        showWindow,
        beforeInstall,
        now: () => clock.now,
        every,
        env,
        platform
    });
    return { autoUpdater, handlers, send, log, updater, clock, timers, Notification, notices, showWindow };
}

function windowThatIs({ visible = true, minimized = false } = {}) {
    return Object.assign(new EventEmitter(), {
        isVisible: () => visible,
        isMinimized: () => minimized,
        isDestroyed: () => false
    });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('launcher updater', () => {
    test('installs silently and relaunches, so the NSIS wizard never shows on update', () => {
        const { autoUpdater, handlers } = setup();
        handlers['launcher-update:install']();
        expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
    });

    test('lets the window close before installing, even when it normally hides to the tray', () => {
        const order = [];
        const { autoUpdater, handlers } = setup(() => order.push('allow quit'));
        autoUpdater.quitAndInstall.mockImplementation(() => order.push('install'));
        autoUpdater.emit('update-downloaded', { version: '3.2.17' });
        handlers['launcher-update:install']();
        expect(order).toEqual(['allow quit', 'install']);
    });

    test('shows the failure when Restart now cannot install, instead of leaving the button dead', () => {
        const { autoUpdater, handlers, send } = setup();
        autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        autoUpdater.quitAndInstall.mockImplementation(() => autoUpdater.emit('error', new Error('ENOENT')));
        handlers['launcher-update:install']();
        expect(send.mock.calls.map(([status]) => status)).toEqual([
            { state: 'ready', version: '3.2.27' },
            { state: 'error', stage: 'install' }
        ]);
    });

    test('still shows the failure when the stand-in AppImage cannot be written', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-updater-'));
        const appImage = path.join(dir, 'removed-folder', 'Microbot Launcher-3.2.24.AppImage');
        const { autoUpdater, handlers, send, log } = setup(undefined, { env: { APPIMAGE: appImage } });
        autoUpdater.quitAndInstall.mockImplementation(() => {
            try {
                fs.unlinkSync(appImage);
            } catch (error) {
                autoUpdater.emit('error', error);
            }
        });
        autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        handlers['launcher-update:install']();
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not prepare'));
        expect(send).toHaveBeenLastCalledWith({ state: 'error', stage: 'install' });
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('a second Restart now click while the install is quitting leaves no empty file behind', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-updater-'));
        const appImage = path.join(dir, 'Microbot Launcher-3.2.24.AppImage');
        fs.writeFileSync(appImage, 'launcher');
        const { autoUpdater, handlers } = setup(undefined, { env: { APPIMAGE: appImage } });
        autoUpdater.quitAndInstall.mockImplementation(() => {
            fs.unlinkSync(appImage);
            fs.writeFileSync(path.join(dir, 'Microbot Launcher-3.2.27.AppImage'), 'new launcher');
        });
        autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        handlers['launcher-update:install']();
        handlers['launcher-update:install']();
        expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
        expect(fs.readdirSync(dir)).toEqual(['Microbot Launcher-3.2.27.AppImage']);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('can try again after a failed install', () => {
        const { autoUpdater, handlers } = setup();
        autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        autoUpdater.quitAndInstall.mockImplementationOnce(() => autoUpdater.emit('error', new Error('ENOENT')));
        handlers['launcher-update:install']();
        handlers['launcher-update:install']();
        expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(2);
    });

    test('never follows a dangling link at the old AppImage path', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-updater-'));
        const target = path.join(dir, 'elsewhere.AppImage');
        const appImage = path.join(dir, 'Microbot Launcher-3.2.24.AppImage');
        fs.symlinkSync(target, appImage);
        const { autoUpdater, handlers } = setup(undefined, { env: { APPIMAGE: appImage } });
        autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        handlers['launcher-update:install']();
        expect(fs.existsSync(target)).toBe(false);
        expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('does not install into the Trash when the launcher ran from there', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-updater-'));
        const trash = path.join(dir, '.local', 'share', 'Trash', 'files');
        fs.mkdirSync(trash, { recursive: true });
        const appImage = path.join(trash, 'Microbot Launcher-3.2.24.AppImage');
        const { autoUpdater, handlers } = setup(undefined, { env: { APPIMAGE: appImage } });
        autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        handlers['launcher-update:install']();
        expect(fs.existsSync(appImage)).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('keeps hiding to the tray after a restart that did not happen', () => {
        const undo = jest.fn();
        const { autoUpdater, handlers } = setup(() => undo);
        autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        autoUpdater.quitAndInstall.mockImplementationOnce(() => autoUpdater.emit('error', new Error('ENOENT')));
        handlers['launcher-update:install']();
        expect(undo).toHaveBeenCalledTimes(1);
        handlers['launcher-update:install']();
        expect(undo).toHaveBeenCalledTimes(1);
    });

    test('installs next to the AppImage the player deleted while it was running', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-updater-'));
        const appImage = path.join(dir, 'Microbot Launcher-3.2.24.AppImage');
        const { autoUpdater, handlers } = setup(undefined, { env: { APPIMAGE: appImage } });
        autoUpdater.quitAndInstall.mockImplementation(() => fs.unlinkSync(appImage));
        autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        handlers['launcher-update:install']();
        expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('never touches an AppImage that is still in place, or other platforms', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-updater-'));
        const appImage = path.join(dir, 'Microbot Launcher-3.2.24.AppImage');
        fs.writeFileSync(appImage, 'launcher');
        const linux = setup(undefined, { env: { APPIMAGE: appImage } });
        linux.autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        linux.handlers['launcher-update:install']();
        expect(fs.readFileSync(appImage, 'utf8')).toBe('launcher');
        const missing = path.join(dir, 'gone.AppImage');
        const windows = setup(undefined, { env: { APPIMAGE: missing }, platform: 'win32' });
        windows.autoUpdater.emit('update-downloaded', { version: '3.2.27' });
        windows.handlers['launcher-update:install']();
        expect(fs.existsSync(missing)).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('keeps hiding to the tray when there is no update to install yet', () => {
        const beforeInstall = jest.fn();
        const { handlers } = setup(beforeInstall);
        handlers['launcher-update:install']();
        expect(beforeInstall).not.toHaveBeenCalled();
    });

    test('only downloads when the user asks', () => {
        const { autoUpdater, handlers } = setup();
        expect(autoUpdater.autoDownload).toBe(false);
        handlers['launcher-update:download']();
        expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
    });

    test('forwards updater events to the banner', () => {
        const { autoUpdater, handlers, send, log } = setup();
        autoUpdater.emit('update-available', { version: '3.2.17' });
        handlers['launcher-update:download']();
        autoUpdater.emit('download-progress', { percent: 41.6 });
        autoUpdater.emit('error', new Error('offline'));
        handlers['launcher-update:download']();
        autoUpdater.emit('update-downloaded', { version: '3.2.17' });
        expect(send.mock.calls.map(([status]) => status)).toEqual([
            { state: 'available', version: '3.2.17', current: '3.2.16' },
            { state: 'downloading', percent: 42 },
            { state: 'error', stage: 'download' },
            { state: 'ready', version: '3.2.17' }
        ]);
        expect(log.error).toHaveBeenCalled();
    });

    test('a failed check stays off the banner, so going offline never hides an available update', () => {
        const { autoUpdater, send, log } = setup();
        autoUpdater.emit('update-available', { version: '3.2.17' });
        autoUpdater.emit('error', new Error('offline'));
        expect(send.mock.calls.map(([status]) => status.state)).toEqual(['available']);
        expect(log.error).toHaveBeenCalled();
    });

    test('checks at startup and again every few hours while running in the tray', async () => {
        const { autoUpdater, updater, timers } = setup();
        updater.watch(new EventEmitter());
        await settle();
        expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
        expect(timers.map((timer) => timer.ms)).toEqual([RECHECK_EVERY_MS]);
        timers[0].fn();
        await settle();
        expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    });

    test('checks again when the window comes back, at most every half hour', async () => {
        const { autoUpdater, updater, clock } = setup();
        const win = new EventEmitter();
        updater.watch(win);
        await settle();
        win.emit('show');
        win.emit('focus');
        await settle();
        expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
        clock.now += SHOWN_RECHECK_AFTER_MS;
        win.emit('focus');
        await settle();
        expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    });

    test('stops checking once the player is downloading or the update is ready', async () => {
        const { autoUpdater, handlers, updater } = setup();
        handlers['launcher-update:download']();
        updater.check();
        autoUpdater.emit('update-downloaded', { version: '3.2.17' });
        updater.check();
        await settle();
        expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });

    test('runs one check at a time', async () => {
        const { autoUpdater, updater } = setup();
        let finish;
        autoUpdater.checkForUpdates.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
        updater.check();
        await settle();
        updater.check();
        expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
        finish();
        await settle();
        updater.check();
        await settle();
        expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    });

    test('tells a player running in the tray about a new version with a desktop notification', () => {
        const { autoUpdater, updater, notices } = setup();
        updater.watch(windowThatIs({ visible: false }));
        autoUpdater.emit('update-available', { version: '3.2.17' });
        expect(notices).toHaveLength(1);
        expect(notices[0].options).toEqual({
            title: 'Microbot Launcher 3.2.17 is available',
            body: 'Open the launcher to update.'
        });
        expect(notices[0].show).toHaveBeenCalled();
    });

    test('also notifies when the window is minimised', () => {
        const { autoUpdater, updater, notices } = setup();
        updater.watch(windowThatIs({ minimized: true }));
        autoUpdater.emit('update-available', { version: '3.2.17' });
        expect(notices).toHaveLength(1);
    });

    test('leaves it to the banner when the window is open', () => {
        const { autoUpdater, updater, send, Notification } = setup();
        updater.watch(windowThatIs());
        autoUpdater.emit('update-available', { version: '3.2.17' });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ state: 'available', version: '3.2.17' }));
        expect(Notification).not.toHaveBeenCalled();
    });

    test('notifies once per version, however often the tray rechecks', () => {
        const { autoUpdater, updater, notices } = setup();
        updater.watch(windowThatIs({ visible: false }));
        autoUpdater.emit('update-available', { version: '3.2.17' });
        autoUpdater.emit('update-available', { version: '3.2.17' });
        autoUpdater.emit('update-available', { version: '3.2.17' });
        expect(notices).toHaveLength(1);
        autoUpdater.emit('update-available', { version: '3.2.18' });
        expect(notices.map((notice) => notice.options.title)).toEqual([
            'Microbot Launcher 3.2.17 is available',
            'Microbot Launcher 3.2.18 is available'
        ]);
    });

    test('clicking the notification brings the launcher back, where the banner offers the update', () => {
        const { autoUpdater, updater, notices, showWindow } = setup();
        updater.watch(windowThatIs({ visible: false }));
        autoUpdater.emit('update-available', { version: '3.2.17' });
        expect(showWindow).not.toHaveBeenCalled();
        notices[0].emit('click');
        expect(showWindow).toHaveBeenCalledTimes(1);
    });

    test('stays quiet when the system has no notifications or the window is not being watched', () => {
        const { autoUpdater, updater, Notification } = setup();
        autoUpdater.emit('update-available', { version: '3.2.17' });
        Notification.isSupported.mockReturnValue(false);
        updater.watch(windowThatIs({ visible: false }));
        autoUpdater.emit('update-available', { version: '3.2.18' });
        expect(Notification).not.toHaveBeenCalled();
    });
});
