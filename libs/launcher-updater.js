// Forwards electron-updater events to the renderer's update banner and handles its button clicks.
const RECHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const SHOWN_RECHECK_AFTER_MS = 30 * 60 * 1000;

function registerLauncherUpdater({
    autoUpdater,
    ipcMain,
    log,
    send,
    Notification,
    showWindow = () => {},
    beforeInstall = () => {},
    now = Date.now,
    every = setInterval,
    fs = require('fs'),
    env = process.env,
    platform = process.platform
}) {
    autoUpdater.autoDownload = false;
    autoUpdater.disableWebInstaller = true;

    let downloading = false;
    let downloaded = false;
    let checking = false;
    let installing = false;
    let installFailed = false;
    let lastCheck = 0;
    let watched = null;
    let notice = null;
    const notified = new Set();

    const notifyIfHidden = (version) => {
        if (!watched || watched.isDestroyed() || notified.has(version)) return;
        if (watched.isVisible() && !watched.isMinimized()) return;
        if (!Notification?.isSupported?.()) return;
        notified.add(version);
        try {
            notice = new Notification({
                title: `Microbot Launcher ${version} is available`,
                body: 'Open the launcher to update.'
            });
            notice.on('click', showWindow);
            notice.show();
        } catch (error) {
            log.warn(`Could not show the update notice: ${error?.message || error}`);
        }
    };

    const restoreMovedAppImage = () => {
        const appImage = env.APPIMAGE;
        if (platform !== 'linux' || !appImage || fs.existsSync(appImage)) return;
        log.warn(`The running launcher ${appImage} was moved or deleted; installing the update in its folder.`);
        try {
            fs.writeFileSync(appImage, '');
        } catch (error) {
            log.warn(`Could not prepare ${appImage} for the update: ${error?.message || error}`);
        }
    };

    autoUpdater.on('update-available', (info) => {
        send({ state: 'available', version: info.version, current: autoUpdater.currentVersion.version });
        notifyIfHidden(info.version);
    });
    autoUpdater.on('download-progress', (progress) =>
        send({ state: 'downloading', percent: Math.round(progress.percent) })
    );
    autoUpdater.on('update-downloaded', (info) => {
        downloading = false;
        downloaded = true;
        send({ state: 'ready', version: info.version });
    });
    autoUpdater.on('error', (error) => {
        log.error('Launcher update failed:', error);
        if (installing) installFailed = true;
        if (!downloading && !installing) return;
        downloading = false;
        send({ state: 'error' });
    });

    ipcMain.handle('launcher-update:download', () => {
        downloading = true;
        return autoUpdater.downloadUpdate();
    });
    // Silent (/S) install over the existing copy, then relaunch: skips the NSIS wizard.
    ipcMain.handle('launcher-update:install', () => {
        let undoAllowQuit = null;
        if (downloaded) {
            undoAllowQuit = beforeInstall();
            restoreMovedAppImage();
        }
        installing = true;
        installFailed = false;
        try {
            return autoUpdater.quitAndInstall(true, true);
        } finally {
            installing = false;
            if (installFailed && typeof undoAllowQuit === 'function') undoAllowQuit();
        }
    });

    const check = ({ unlessCheckedWithin = 0 } = {}) => {
        if (checking || downloading || downloaded) return;
        if (lastCheck && now() - lastCheck < unlessCheckedWithin) return;
        lastCheck = now();
        checking = true;
        Promise.resolve()
            .then(() => autoUpdater.checkForUpdates())
            .catch(() => {})
            .finally(() => {
                checking = false;
            });
    };

    const watch = (win) => {
        watched = win;
        check();
        const recheck = () => check({ unlessCheckedWithin: SHOWN_RECHECK_AFTER_MS });
        win.on('show', recheck);
        win.on('focus', recheck);
        every(() => check(), RECHECK_EVERY_MS)?.unref?.();
    };

    return { check, watch };
}

module.exports = { registerLauncherUpdater, RECHECK_EVERY_MS, SHOWN_RECHECK_AFTER_MS };
