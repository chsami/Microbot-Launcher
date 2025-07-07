const { app, BrowserWindow, dialog, shell, autoUpdater } = require('electron');
const { microbotDir } = require("./libs/dir-module");
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const https = require('https');


const filestorage = 'https://files.microbot.cloud'

let splash;
let mainWindow;

// Ensure the .microbot directory exists
if (!fs.existsSync(microbotDir)) {
    fs.mkdirSync(microbotDir);
}


async function downloadFileFromBlobStorage(blobPath, dir, filename) {
    try {
        if (process.env.DEBUG === 'true') {
            return dir + "/" + filename
        }
        // Construct the URL, including the dir only if it's provided
        const url = dir ? `${blobPath}/${dir}/${filename}` : `${blobPath}/${filename}`;

        const response = await axios.get(url,
            { responseType: 'arraybuffer' })
        // Step 2: Determine the path to save the file

        // Ensure the directory exists
        if (dir) {
            const dirPath = path.join(microbotDir, dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            const filePath = path.join(dirPath, filename);
            fs.writeFileSync(filePath, response.data);
            return filePath
        }

        // Step 3: Save the file
        const filePath = path.join(microbotDir, filename);
        fs.writeFileSync(filePath, response.data);

        return filePath
    } catch (err) {
        logError(err)
    }

    return ""
}

async function loadLibraries() {
    // Load remote ipc-handlers.js from filestorage
    const ipcHandlersPath = path.join(__dirname, 'libs/ipc-handlers.js');
    const remoteIpcHandlersUrl = filestorage + '/assets/microbot-launcher/libs/ipc-handlers.js';
    if (process.env.DEBUG !== 'true') {
        await downloadAndSaveFile(remoteIpcHandlersUrl, ipcHandlersPath);
    }
    await require(ipcHandlersPath)();
}

async function createWindow() {

    await loadLibraries();

    // Create the splash screen window
    splash = new BrowserWindow({
        width: 400,
        height: 300,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        icon: path.join(__dirname, 'images/microbot_transparent.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: true,
        },
    });


    const splashPath = await downloadFileFromBlobStorage(filestorage + '/assets/microbot-launcher', './', 'splash.html')

    await splash.loadFile(splashPath);

   

    // Create the main window, but don't show it yet
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false, // Don't show the main window immediately
        title: 'Microbot Launcher',
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'images/microbot_transparent.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: true,
        },
    });

    await downloadFileFromBlobStorage(filestorage + '/assets/microbot-launcher', './css', 'styles.css')
    const indexHtmlPath = await downloadFileFromBlobStorage(filestorage + '/assets/microbot-launcher', './', 'index.html')

    await mainWindow.loadFile(indexHtmlPath);
}

app.whenReady().then(async () => {
    await createWindow();

    if (process.env.DEBUG !== 'true') {
        const updateUrl = filestorage + '/releases/microbot-launcher'; // Folder containing RELEASES and *.nupkg
        autoUpdater.setFeedURL({ url: updateUrl });
        autoUpdater.checkForUpdates();

        autoUpdater.on('update-not-available', async (info) => {
            dialog.showMessageBox({
                type: 'info',
                message: 'Update not available...'
            });
            setTimeout(async () => {
                splash.destroy();
                mainWindow.show();
            }, 1000);
        });

        autoUpdater.on('download-progress', (progressObj) => {
            dialog.showMessageBox({
                type: 'info',
                message: 'Downloading update...'
            });
            let log_message = "Download speed: " + progressObj.bytesPerSecond;
            log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
            log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
            splash.webContents.send('update-progress', {
                percent: progressObj.percent,
                total: progressObj.total
            });
        });

        autoUpdater.on('update-available', () => {
            dialog.showMessageBox({
                type: 'info',
                message: 'Update available! Downloading...'
            });
            // generate me a fake progress bar so the user feels like something is happening
            let progress = 0;

            // since squirrel doesn't support progress, we will use a fake progress bar
            function sendFakeProgress() {
                if (progress >= 100) {
                    splash.webContents.send('update-progress', { percent: 100, total: 154800000 });
                    setTimeout(() => {
                        splash.destroy();
                        mainWindow.show();
                    }, 500);
                    return;
                }
                // Random increment between 5 and 15 percent
                const increment = Math.floor(Math.random() * 11) + 5;
                progress = Math.min(progress + increment, 100);

                splash.webContents.send('update-progress', { percent: progress, total: 154800000 });

                // Random interval between 500ms and 1200ms
                const interval = Math.floor(Math.random() * 700) + 500;
                setTimeout(sendFakeProgress, interval);
            }

           // sendFakeProgress();
        });


        autoUpdater.on('update-downloaded', () => {
            dialog.showMessageBox({
                type: 'info',
                message: 'Done!'
            });
            autoUpdater.quitAndInstall();
        });
    } else {
        setTimeout(() => {
            splash.destroy();
            mainWindow.show();
        }, 1000);
    }
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

async function downloadAndSaveFile(remoteUrl, localPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(localPath);
        https.get(remoteUrl, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(resolve);
                });
            } else {
                dialog.showErrorBox('Failed to load js files!', 'Failed to load ' + localPath)
                reject(new Error(`Failed to download file: ${response.statusCode}`));
            }
        }).on('error', (err) => {
            fs.unlink(localPath, () => reject(err));
        });
    });
}