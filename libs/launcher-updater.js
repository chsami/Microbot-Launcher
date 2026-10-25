// Forwards electron-updater events to the renderer's update banner and handles its button clicks.
function registerLauncherUpdater({ autoUpdater, ipcMain, log, send, beforeInstall = () => {} }) {
    autoUpdater.autoDownload = false;
    autoUpdater.disableWebInstaller = true;

    autoUpdater.on('update-available', (info) =>
        send({ state: 'available', version: info.version, current: autoUpdater.currentVersion.version })
    );
    autoUpdater.on('download-progress', (progress) =>
        send({ state: 'downloading', percent: Math.round(progress.percent) })
    );
    autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }));
    autoUpdater.on('error', (error) => {
        log.error('Launcher update failed:', error);
        send({ state: 'error' });
    });

    ipcMain.handle('launcher-update:download', () => autoUpdater.downloadUpdate());
    // Silent (/S) install over the existing copy, then relaunch: skips the NSIS wizard.
    ipcMain.handle('launcher-update:install', () => {
        beforeInstall();
        return autoUpdater.quitAndInstall(true, true);
    });
}

module.exports = { registerLauncherUpdater };
