const { app, BrowserWindow } = require('electron');
const path = require('path');
const { ipcMain } = require('electron');
const fs = require('fs');
const axios = require('axios');
const AdmZip = require('adm-zip');
const {executeJar} = require('./libs/jar-executor');
const {readPropertiesFile, writePropertiesFile} = require("./libs/properties");
const {readAccountsJson, removeAccountsJson, checkFileModification} = require("./libs/accounts-loader");
const {overwrite} = require("./libs/overwrite-credential-properties");
const {logMessage} = require("./libs/logger");

const url = 'https://microbot-api.azurewebsites.net'
// const url = 'http://localhost:5029'

let splash;
let mainWindow;

function createWindow () {

    // Create the splash screen window
    splash = new BrowserWindow({
        width: 400,
        height: 300,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        icon: path.join(__dirname, 'images/microbot_transparent.png'),
    });

    splash.loadFile(path.join(__dirname, 'splash.html'));

    // Create the main window, but don't show it yet
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false, // Don't show the main window immediately
        title: 'Microbot Launcher',
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'images/microbot_transparent.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: true
        },
    });
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // When the main window is ready to be shown, close the splash screen and show the main window
    mainWindow.once('ready-to-show', () => {
        setTimeout(() => {
            splash.destroy();
            mainWindow.show();
        }, 1500);
    });

   // win.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', async function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('download-jcef', async (event) => {
    try {
        event.sender.send('progress', { percent: 10, status: 'Downloading...' });

        const response = await axios({
            method: 'get',
            url: 'https://developmentb464.blob.core.windows.net/microbot/launcher/jcef-bundle.zip',
            responseType: 'arraybuffer',
            onDownloadProgress: (progressEvent) => {
                const totalLength = 126009591;

                const progress = ((progressEvent.loaded * 100) / totalLength).toFixed(2);  // Keep two decimal places
                let currentPercent = (10 + (progress * 0.4)).toFixed(2);  // Map the progress to 10%-50%
                event.sender.send('progress', { percent: currentPercent, status: `Downloading... (${progress}%)` });
            }
        });

        event.sender.send('progress', { percent: 50, status: 'Saving file...' });

        // Step 2: Determine the path to save the ZIP file
        const zipFilePath = path.join(__dirname, 'jcef-bundle.zip');

        event.sender.send('progress', { percent: 55, status: 'Unpacking file...' });

        // Step 3: Save the ZIP file
        fs.writeFileSync(zipFilePath, response.data);

        // Step 4: Unpack the ZIP file
        const zip = new AdmZip(zipFilePath);
        const extractPath = __dirname;  // Extract to the root folder of the Electron project

        zip.extractAllTo(extractPath, true);

        event.sender.send('progress', { percent: 60, status: 'Cleaning up...' });


        // Optionally, delete the ZIP file after extraction
        fs.unlinkSync(zipFilePath);

        // Return a success message or the path where the files were extracted
        return { success: true, path: extractPath };
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('download-microbot-launcher', async (event) => {
    try {
        event.sender.send('progress', { percent: 70, status: 'Downloading Microbot Jagex Launcher...' });

        const response = await axios.get('https://developmentb464.blob.core.windows.net/microbot/launcher/microbot-launcher.jar',
            { responseType: 'arraybuffer' })  // Ensure the response is treated as binary data);


        event.sender.send('progress', { percent: 80, status: 'Finishing...' });

        // Step 2: Determine the path to save the file
        const filePath = path.join(__dirname, 'microbot-launcher.jar');

        // Step 3: Save the file
        fs.writeFileSync(filePath, response.data);

        event.sender.send('progress', { percent: 80, status: 'Completed!' });

        // Return a success message or the path where the file was saved
        return { success: true, path: filePath };
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});


ipcMain.handle('download-client', async (event, version) => {
    try {
        event.sender.send('progress', { percent: 90, status: 'Downloading Microbot-' + version +'' });

        if (fs.existsSync('microbot-' + version + '.jar'))
            return {success: true, path: 'microbot-' + version + '.jar'}
        const response = await axios.get('https://developmentb464.blob.core.windows.net/microbot/release/microbot-' + version +'.jar',
            { responseType: 'arraybuffer' })  // Ensure the response is treated as binary data);
        // Step 2: Determine the path to save the file
        const filePath = path.join(__dirname, 'microbot-' + version + '.jar');

        // Step 3: Save the file
        fs.writeFileSync(filePath, response.data);

        event.sender.send('progress', { percent: 100, status: 'Completed!' });

        // Return a success message or the path where the file was saved
        return { success: true, path: filePath };
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('write-properties', async (event, data) => {
    try {
        writePropertiesFile(data)
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('fetch-launcher-version', async () => {
    try {
        const response = await axios.get(url + '/api/file/launcher');
        return response.data;
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('fetch-client-version', async () => {
    try {
        const response = await axios.get(url + '/api/file/client');
        return response.data;
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('fetch-launcher-html-version', async () => {
    try {
        const response = await axios.get(url + '/api/file/html');
        return response.data;
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('read-properties', async () => {
    try {
        const response = readPropertiesFile()
        return response;
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('open-launcher', async () => {
    try {
        const filePath = path.join(__dirname, 'jcef-bundle');
        const launcherPath = path.join( __dirname, 'microbot-launcher.jar');
        executeJar('java -Djava.library.path=' + filePath + ' -jar ' + launcherPath)
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('open-client', async (event, version, proxy) => {
    try {
        let filePath = path.join(__dirname, 'microbot-' + version +'.jar');
        filePath += ' -proxy=' + proxy.proxyIp + ' -proxy-type=' + proxy.proxyType
        executeJar('java -jar ' + filePath)
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('jcef-exists', async () => {
    try {
        const filePath = path.join(__dirname, 'jcef-bundle');
        return fs.existsSync(filePath)
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});


ipcMain.handle('client-exists', async (event, version) => {
    try {
        const filePath = path.join(__dirname, 'microbot-' + version + '.jar');
        return fs.existsSync(filePath)
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('launcher-exists', async () => {
    try {
        const filePath = path.join(__dirname, 'microbot-launcher.jar');
        const result = fs.existsSync(filePath)
        return result
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('accounts-exists', async () => {
    try {
       const result = fs.existsSync('accounts.json')
        console.log(result)
        return result
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});


ipcMain.handle('read-accounts', async () => {
    try {
        return readAccountsJson()
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('overwrite-credential-properties', async (event, character) => {
    try {
        overwrite(character)
        return { success: 'Succesfull'}
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('remove-accounts', async () => {
    try {
        removeAccountsJson()
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('check-file-change', async () => {
    try {
        return checkFileModification()
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});

ipcMain.handle('play-no-jagex-account', async (event, version, proxy) => {
    try {
        let filePath = path.join(__dirname, 'microbot-' + version +'.jar');
        filePath += ' -clean-jagex-launcher'
        filePath += ' -proxy=' + proxy.proxyIp + ' -proxy-type=' + proxy.proxyType
        executeJar('java -jar ' + filePath)
    } catch (error) {
        logMessage(error.message)
        return { error: error.message };
    }
});