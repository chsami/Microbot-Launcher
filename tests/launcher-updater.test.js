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
    const log = { error: jest.fn() };
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
        beforeInstall,
        now: () => clock.now,
        every
    });
    return { autoUpdater, handlers, send, log, updater, clock, timers };
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
});
