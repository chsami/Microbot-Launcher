const { EventEmitter } = require('events');

const { registerLauncherUpdater } = require('../libs/launcher-updater.js');

function setup(beforeInstall) {
    const autoUpdater = Object.assign(new EventEmitter(), {
        currentVersion: { version: '3.2.16' },
        downloadUpdate: jest.fn(),
        quitAndInstall: jest.fn()
    });
    const handlers = {};
    const ipcMain = { handle: (channel, fn) => (handlers[channel] = fn) };
    const send = jest.fn();
    const log = { error: jest.fn() };
    registerLauncherUpdater({ autoUpdater, ipcMain, log, send, beforeInstall });
    return { autoUpdater, handlers, send, log };
}

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
        const { autoUpdater, send, log } = setup();
        autoUpdater.emit('update-available', { version: '3.2.17' });
        autoUpdater.emit('download-progress', { percent: 41.6 });
        autoUpdater.emit('update-downloaded', { version: '3.2.17' });
        autoUpdater.emit('error', new Error('offline'));
        expect(send.mock.calls.map(([status]) => status)).toEqual([
            { state: 'available', version: '3.2.17', current: '3.2.16' },
            { state: 'downloading', percent: 42 },
            { state: 'ready', version: '3.2.17' },
            { state: 'error' }
        ]);
        expect(log.error).toHaveBeenCalled();
    });
});
