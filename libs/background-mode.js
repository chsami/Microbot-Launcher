const TRAY_TOOLTIP = 'Microbot Launcher';
const HINT_TITLE = 'Microbot Launcher is still running';
const HINT_BODY = 'Open it from the tray icon, or start the launcher again.';

module.exports = function setupBackgroundMode(deps) {
    const { app, ipcMain, Tray, Menu, nativeImage, Notification, log, fs, settingsFile, iconPath, getWindow } = deps;

    let tray = null;
    let quitting = false;
    let hintShown = false;
    let enabled = readSettings().runInBackground === true;

    function readSettings() {
        try {
            if (!fs.existsSync(settingsFile)) return {};
            const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (error) {
            log.warn(`Could not read launcher settings: ${error?.message || error}`);
            return {};
        }
    }

    const showWindow = () => {
        const win = getWindow();
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    };

    const quit = () => {
        quitting = true;
        app.quit();
    };

    const createTray = () => {
        if (tray) return;
        try {
            const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
            tray = new Tray(icon);
            tray.setToolTip(TRAY_TOOLTIP);
            tray.setContextMenu(
                Menu.buildFromTemplate([
                    { label: 'Open Microbot Launcher', click: showWindow },
                    { type: 'separator' },
                    { label: 'Quit', click: quit }
                ])
            );
            tray.on('click', showWindow);
        } catch (error) {
            tray = null;
            log.warn(`Could not create the tray icon: ${error?.message || error}`);
        }
    };

    const destroyTray = () => {
        if (!tray) return;
        tray.destroy();
        tray = null;
    };

    const showHint = () => {
        if (hintShown) return;
        hintShown = true;
        try {
            if (Notification?.isSupported?.()) new Notification({ title: HINT_TITLE, body: HINT_BODY }).show();
        } catch (error) {
            log.warn(`Could not show the background notice: ${error?.message || error}`);
        }
    };

    const hideWindow = () => {
        const win = getWindow();
        if (!win || win.isDestroyed()) return;
        win.hide();
        showHint();
    };

    const claimInstance = () => {
        if (!enabled) return true;
        if (app.requestSingleInstanceLock()) return true;
        log.info('Another launcher is already running in the background; showing it instead.');
        return false;
    };

    const start = () => {
        if (enabled) createTray();
    };

    const attachWindow = (win) => {
        win.on('close', (event) => {
            if (!enabled || quitting) return;
            event.preventDefault();
            hideWindow();
        });
    };

    const close = () => {
        if (enabled) {
            hideWindow();
            return;
        }
        quit();
    };

    const setEnabled = (value) => {
        const next = Boolean(value);
        if (next && !app.hasSingleInstanceLock() && !app.requestSingleInstanceLock()) {
            return { error: 'Another Microbot Launcher is already running in the background. Use that one, or quit it first.' };
        }
        fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), runInBackground: next }, null, 2));
        enabled = next;
        if (next) {
            createTray();
        } else {
            destroyTray();
            if (app.hasSingleInstanceLock()) app.releaseSingleInstanceLock();
        }
        return {};
    };

    app.on('second-instance', showWindow);
    app.on('activate', showWindow);
    app.on('before-quit', () => {
        quitting = true;
    });

    ipcMain.handle('background:status', async () => ({ enabled }));

    ipcMain.handle('background:set-enabled', async (_event, value) => {
        try {
            const result = setEnabled(value);
            if (result.error) return { error: result.error, enabled };
        } catch (error) {
            log.warn(`Could not save the background setting: ${error?.message || error}`);
            return { error: 'Could not save the setting.', enabled };
        }
        return { enabled };
    });

    return {
        claimInstance,
        start,
        attachWindow,
        close,
        allowQuit: () => {
            quitting = true;
        },
        isEnabled: () => enabled
    };
};
