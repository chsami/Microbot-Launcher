const { EventEmitter } = require('events');

const {
    registerLauncherUpdater,
    RECHECK_EVERY_MS,
    SHOWN_RECHECK_AFTER_MS
} = require('../libs/launcher-updater.js');

function setup(beforeInstall) {
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
        every
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
            { state: 'error' },
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
