const { app, BrowserWindow, dialog, shell } = require('electron');
const { microbotDir } = require('./libs/dir-module');
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
const cheerio = require('cheerio');

process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error);
});

const filestorage = 'https://files.microbot.cloud';
let mainWindow = null;
const isDebugging = process.env.DEBUG === 'true';

// Ensure the .microbot directory exists
if (!fs.existsSync(microbotDir)) {
    fs.mkdirSync(microbotDir);
}

async function downloadFileFromBlobStorage(blobPath, dir, filename) {
    try {
        if (isDebugging) {
            return dir + '/' + filename;
        }
        // Construct the URL, including the dir only if it's provided
        const url = dir
            ? `${blobPath}/${dir}/${filename}`
            : `${blobPath}/${filename}`;

        const response = await axios.get(url, { responseType: 'arraybuffer' });
        // Step 2: Determine the path to save the file

        // Ensure the directory exists
        if (dir) {
            const dirPath = path.join(microbotDir, dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            const filePath = path.join(dirPath, filename);
            fs.writeFileSync(filePath, response.data);
            return filePath;
        }

        // Step 3: Save the file
        const filePath = path.join(microbotDir, filename);
        fs.writeFileSync(filePath, response.data);

        return filePath;
    } catch (err) {
        log.error(err);
    }

    return '';
}

async function loadLibraries() {
    // Load remote ipc-handlers.js from filestorage
    log.info('load libraries...');

    let ipcHandlersPath = path.join(microbotDir, 'libs', 'ipc-handlers.js');

    await downloadAndSaveFile(
        filestorage + '/assets/microbot-launcher/libs/ipc-handlers.js',
        ipcHandlersPath,
        path.join(__dirname, 'libs', 'ipc-handlers.js')
    );

    await downloadAndSaveFile(
        filestorage + '/assets/microbot-launcher/libs/extra-ipc-handlers.js',
        path.join(microbotDir, 'libs', 'extra-ipc-handlers.js'),
        path.join(__dirname, 'libs', 'extra-ipc-handlers.js')
    );

    try {
        log.info('require ipchandler...');
        const handler = require(ipcHandlersPath);
        const deps = {
            AdmZip: AdmZip,
            axios: axios,
            ipcMain: ipcMain,
            microbotDir: microbotDir,
            packageJson: packageJson,
            path: path,
            downloadAndSaveFile: downloadAndSaveFile,
            log: log,
            spawn: spawn,
            dialog: dialog,
            shell: shell,
            projectDir: __dirname,
            fs: fs,
            app: app,
            mainWindow: mainWindow
        };
        if (typeof handler === 'function') {
            await handler(deps);
        } else {
            log.error('ipcHandlers does not export a function');
        }
        log.info('done require ipchandler...');
    } catch (error) {
        log.error('Error requiring ipcHandlers:', error);
    }
}

async function createWindow() {
    // Create the main window, but don't show it yet
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
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
        titleBarStyle: 'hidden',
        frame: false
    });

    if (process.platform === 'darwin') {
        mainWindow.setWindowButtonVisibility(false);
    }

    const extraHandlers = require(path.join(
        microbotDir,
        'libs',
        'extra-ipc-handlers.js'
    ));
    extraHandlers(app, ipcMain, mainWindow, log);

    if (isDebugging) {
        const htmlPath = path.join(__dirname, 'index.html');

        // Get the last script tag inside <body> and replace its src with the renderer.js file
        const scriptTag = `<script>
            const script = document.createElement('script');
            script.src = \`renderer.js?cache-bust=\${Date.now()}\`;
            document.head.appendChild(script);
        </script>`;

        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const $ = cheerio.load(htmlContent);

        $('body').children('script').last().replaceWith(scriptTag);
        $('head')
            .children('link[rel="stylesheet"]')
            .last()
            .replaceWith(`<link rel="stylesheet" href="css/styles.css">`);

        fs.writeFileSync(htmlPath, $.html());

        await mainWindow.loadFile(htmlPath);
    } else {
        const indexHtmlPath = await downloadFileFromBlobStorage(
            filestorage + '/assets/microbot-launcher',
            './',
            'index.html'
        );

        const htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
        const $ = cheerio.load(htmlContent);

        $('body')
            .children('script')
            .last()
            .replaceWith(
                '<script src="https://files.microbot.cloud/assets/microbot-launcher/renderer.js?version=3.0.0"></script>'
            );
        $('head')
            .children('link[rel="stylesheet"]')
            .last()
            .replaceWith(
                `<link rel="stylesheet" href="https://files.microbot.cloud/assets/microbot-launcher/css/styles.css">`
            );

        fs.writeFileSync(indexHtmlPath, $.html());

        await mainWindow.loadFile(indexHtmlPath);
    }
}

autoUpdater.autoDownload = false;
autoUpdater.disableWebInstaller = true;

autoUpdater.on('update-available', (info) => {
    dialog
        .showMessageBox({
            type: 'info',
            title: 'Update available',
            message: `Version ${info.version} of the launcher is available. Do you want to download it now?`,
            buttons: ['Yes', 'Later']
        })
        .then((result) => {
            dialog.showMessageBox({
                type: 'info',
                title: 'Downloading',
                message: `Downloading version ${info.version} of the launcher...`
            });
            if (result.response === 0) {
                autoUpdater.downloadUpdate();
            }
        });
});

autoUpdater.on('update-downloaded', () => {
    dialog
        .showMessageBox({
            title: 'Install Updates',
            message:
                'Updates downloaded. The application will now quit and install the updates.'
        })
        .then(() => {
            autoUpdater.quitAndInstall();
        });
});

app.whenReady().then(async () => {
    log.info('App starting...');

    await checkLinuxVersion();
    await loadLibraries();
    await createWindow();

    if (process.env.DEBUG !== 'true') {
        mainWindow.show();
        autoUpdater.checkForUpdates();
    } else {
        mainWindow.show();
    }
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

async function downloadAndSaveFile(remoteUrl, localPath, srcPath) {
    if (process.env.DEBUG === 'true') {
        const destDir = path.join(microbotDir, 'libs');
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(srcPath, localPath);
        log.info('successfully copied ' + localPath);
        return new Promise((resolve, reject) => {
            resolve();
        });
    }
    return new Promise((resolve, reject) => {
        // Ensure parent directory exists
        const dir = path.dirname(localPath);
        fs.mkdirSync(dir, { recursive: true });

        const file = fs.createWriteStream(localPath);
        https
            .get(remoteUrl, (response) => {
                if (response.statusCode === 200) {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close(resolve);
                    });
                } else {
                    dialog.showErrorBox(
                        'Failed to load js files!',
                        'Failed to load ' + localPath
                    );
                    reject(
                        new Error(
                            `Failed to download file: ${response.statusCode} - ${localPath}`
                        )
                    );
                }
            })
            .on('error', (err) => {
                fs.unlink(localPath, () => reject(err));
            });
    });
}

async function checkLinuxVersion() {
    if (process.platform === 'linux') {
        // Check for new version on Linux
        try {
            const response = await axios.get(
                'https://microbot.cloud/api/file/launcher'
            );
            const remoteVersion = response.data;
            const currentVersion = packageJson.version;

            if (remoteVersion !== currentVersion) {
                dialog.showMessageBox({
                    type: 'info',
                    title: 'New Version Available',
                    message: `A new version (${remoteVersion}) of Microbot Launcher is available. Your current version is ${currentVersion}. Please download the latest version from https://themicrobot.com`,
                    buttons: ['OK']
                });
            }
        } catch (error) {
            log.error('Failed to check for new version:', error);
        }
    }
}
