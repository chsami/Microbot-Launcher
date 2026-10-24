const { app, BrowserWindow, dialog, shell, nativeImage, clipboard, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { ipcMain } = require('electron');
const AdmZip = require('adm-zip');
const packageJson = require(path.join(__dirname, 'package.json'));
const { spawn } = require('child_process');
const { microbotDir, openLocation } = require(path.join(
    __dirname,
    'libs',
    'dir-module.js'
));

process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error);
});

let mainWindow = null;

// Ensure the .microbot directory exists
if (!fs.existsSync(microbotDir)) {
    fs.mkdirSync(microbotDir);
}

async function loadLibraries() {
    log.info('Loading libraries...');

    const ipcHandlersPath = path.join(__dirname, 'libs', 'ipc-handlers.js');

    try {
        log.info('Requiring ipc-handlers...');
        const handler = require(ipcHandlersPath);
        const deps = {
            AdmZip: AdmZip,
            axios: axios,
            ipcMain: ipcMain,
            microbotDir: microbotDir,
            packageJson: packageJson,
            path: path,
            log: log,
            spawn: spawn,
            dialog: dialog,
            shell: shell,
            clipboard: clipboard,
            projectDir: __dirname,
            fs: fs,
            app: app,
            mainWindow: mainWindow
        };
        let apiAuth = null;
        try {
            const useMockAuth = process.env.MOCK_AUTH === '1' || process.env.MOCK_AUTH === 'true';
            if (useMockAuth) {
                require(path.join(__dirname, 'libs', 'mock-auth.js'))({ ipcMain, log });
            } else {
                apiAuth = require(path.join(__dirname, 'libs', 'api-auth.js'))({
                    ipcMain,
                    log,
                    axios,
                    fs,
                    safeStorage,
                    sessionFile: path.join(microbotDir, 'session.dat'),
                    captcha: require(path.join(__dirname, 'libs', 'captcha-window.js'))({
                        BrowserWindow,
                        shell,
                        getParent: () => mainWindow,
                        log,
                        openInBrowser: require(path.join(__dirname, 'libs', 'captcha-browser.js'))({
                            http: require('http'),
                            shell,
                            log
                        })
                    })
                });
            }
        } catch (authError) {
            log.error('Error setting up auth:', authError);
        }
        if (apiAuth) {
            try {
                require(path.join(__dirname, 'libs', 'dashboard-session.js'))({
                    ipcMain,
                    log,
                    session,
                    auth: apiAuth,
                    getWindow: () => mainWindow
                });
            } catch (dashboardError) {
                log.error('Error setting up the dashboard session:', dashboardError);
            }
        }
        try {
            deps.alerts = require(path.join(__dirname, 'libs', 'client-alerts.js'))({
                ipcMain,
                log,
                fs,
                safeStorage,
                auth: apiAuth,
                linksFile: path.join(microbotDir, 'alert-links.dat'),
                settingsFile: path.join(microbotDir, 'alert-profiles.json')
            });
        } catch (alertsError) {
            log.error('Error setting up bot alerts:', alertsError);
        }
        if (typeof handler === 'function') {
            await handler(deps);
        } else {
            log.error('ipcHandlers does not export a function');
        }
        log.info('Done requiring ipcHandlers...');
    } catch (error) {
        log.error('Error requiring ipcHandlers:', error);
    }
}

async function createWindow() {
    // Create the main window, but don't show it yet
    mainWindow = new BrowserWindow({
        width: 1280,
        height: process.env.DEBUG !== 'true' ? 750 : 800,
        minWidth: 900,
        show: false, // Don't show the main window immediately
        title: 'Microbot Launcher',
        autoHideMenuBar: process.env.DEBUG !== 'true',
        icon: path.join(__dirname, 'images/microbot_transparent.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: true,
            webviewTag: true
        },
        titleBarStyle: process.env.DEBUG !== 'true' ? 'hidden' : '',
        frame: process.env.DEBUG === 'true'
    });

    if (process.platform === 'darwin') {
        mainWindow.setWindowButtonVisibility(false);
    }

    try {
        const extraHandlers = require(path.join(
            __dirname,
            'libs',
            'extra-ipc-handlers.js'
        ));
        if (typeof extraHandlers === 'function') {
            await extraHandlers(app, ipcMain, mainWindow, log, openLocation, (url) => shell.openExternal(url));
        } else {
            log.error('extra-ipc-handlers does not export a function');
        }
    } catch (e) {
        log.error('Failed to load extra-ipc-handlers:', e);
    }

    await mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

require(path.join(__dirname, 'libs', 'launcher-updater.js')).registerLauncherUpdater({
    autoUpdater,
    ipcMain,
    log,
    send: (status) => mainWindow?.webContents.send('launcher-update', status)
});

app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
});

app.whenReady().then(async () => {
    log.info('App starting...');

    await loadLibraries();
    await createWindow();

    if (process.env.DEBUG !== 'true') {
        mainWindow.show();
        // Failures are already logged by the 'error' handler.
        autoUpdater.checkForUpdates().catch(() => {});
    } else {
        mainWindow.show();
    }
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
