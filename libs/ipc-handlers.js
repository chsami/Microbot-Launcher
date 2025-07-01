module.exports = function () {
    const path = require('path');
    const fs = require('fs');
    const { ipcMain } = require('electron');
    const AdmZip = require('adm-zip');
    const axios = require('axios');
    const https = require('https');
    const { BrowserWindow, dialog, shell } = require('electron');
    const { microbotDir } = require(path.join(__dirname, 'dir-module.js'));
    const { readPropertiesFile, writePropertiesFile } = require(path.join(__dirname, 'properties.js'));
    const { overwrite } = require(path.join(__dirname, 'overwrite-credential-properties.js'));
    const { logMessage, logError } = require(path.join(__dirname, 'logger.js'));
    const { readAccountsJson, removeAccountsJson, checkFileModification } = require(path.join(__dirname, 'accounts-loader.js'));
    const jarExecutor = require(path.join(__dirname, 'jar-executor.js'));
    const packageJson = require(path.join(__dirname, '..', 'package.json'));
    const packageVersion = packageJson.version;
    const url = 'https:/microbot.cloud';
    const filestorage = 'https://files.microbot.cloud';

    ipcMain.handle('download-jcef', async (event) => {
        try {
            event.sender.send('progress', { percent: 10, status: 'Downloading...' });

            const response = await axios({
                method: 'get',
                url: url + '/assets/microbot-launcher/jcef-bundle.zip',
                responseType: 'arraybuffer',
                onDownloadProgress: (progressEvent) => {
                    const totalLength = 126009591;
                    const progress = ((progressEvent.loaded * 100) / totalLength).toFixed(2);
                    let currentPercent = (10 + (progress * 0.4)).toFixed(2);
                    event.sender.send('progress', { percent: currentPercent, status: `Downloading... (${progress}%)` });
                }
            });

            event.sender.send('progress', { percent: 50, status: 'Saving file...' });
            event.sender.send('progress', { percent: 55, status: 'Unpacking file...' });
            const zipFilePath = path.join(microbotDir, 'jcef-bundle.zip');
            fs.writeFileSync(zipFilePath, response.data);
            const zip = new AdmZip(zipFilePath);
            const extractPath = microbotDir;
            zip.extractAllTo(extractPath, true);
            event.sender.send('progress', { percent: 60, status: 'Cleaning up...' });
            fs.unlinkSync(zipFilePath);
            return { success: true, path: extractPath };
        } catch (error) {
            logMessage(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('download-microbot-launcher', async (event) => {
        try {
            event.sender.send('progress', { percent: 70, status: 'Downloading Microbot Jagex Launcher...' });
            const response = await axios.get(url + '/assets/microbot-launcher/microbot-launcher.jar', { responseType: 'arraybuffer' });
            event.sender.send('progress', { percent: 80, status: 'Finishing...' });
            const filePath = path.join(microbotDir, 'microbot-launcher.jar');
            fs.writeFileSync(filePath, response.data);
            event.sender.send('progress', { percent: 80, status: 'Completed!' });
            return { success: true, path: filePath };
        } catch (error) {
            logMessage(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('download-client', async (event, version) => {
        try {
            event.sender.send('progress', { percent: 90, status: 'Downloading Microbot-' + version + '' });
            if (fs.existsSync('microbot-' + version + '.jar'))
                return { success: true, path: 'microbot-' + version + '.jar' }
            const response = await axios({
                method: 'get',
                url: url + '/releases/microbot/stable/microbot-' + version + '.jar',
                responseType: 'arraybuffer',
                onDownloadProgress: (progressEvent) => {
                    const totalLength = 126009591;
                    const progress = ((progressEvent.loaded * 100) / totalLength).toFixed(2);
                    let currentPercent = (10 + (progress * 0.4)).toFixed(2);
                    event.sender.send('progress', {
                        percent: currentPercent,
                        status: `Downloading client ${version}... (${progress}%)`
                    });
                }
            });
            const filePath = path.join(microbotDir, 'microbot-' + version + '.jar');
            fs.writeFileSync(filePath, response.data);
            event.sender.send('progress', { percent: 100, status: 'Completed!' });
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
            return readPropertiesFile();
        } catch (error) {
            logMessage(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('open-launcher', async () => {
        try {
            const filePath = path.join(microbotDir, 'jcef-bundle');
            const launcherPath = path.join(microbotDir, 'microbot-launcher.jar');
            jarExecutor.executeJar(
                [
                    `-Djava.library.path=${filePath}`,
                    '-jar',
                    launcherPath
                ],
                dialog
            );
        } catch (error) {
            logMessage(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('open-client', async (event, version, proxy) => {
        try {
            const jarPath = path.join(microbotDir, 'microbot-' + version + ".jar");
            const commandArgs = [
                '-jar',
                jarPath,
                '-proxy=' + proxy.proxyIp,
                '-proxy-type=' + proxy.proxyType
            ];
            jarExecutor.checkJavaAndRunJar(
                commandArgs,
                dialog,
                shell
            );
        } catch (error) {
            logMessage(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('jcef-exists', async () => {
        try {
            const filePath = path.join(microbotDir, 'jcef-bundle');
            return fs.existsSync(filePath)
        } catch (error) {
            logMessage(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('client-exists', async (event, version) => {
        try {
            const filePath = path.join(microbotDir, version);
            return fs.existsSync(filePath)
        } catch (error) {
            logMessage(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('launcher-exists', async () => {
        try {
            const filePath = path.join(microbotDir, 'microbot-launcher.jar');
            return fs.existsSync(filePath)
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
            return { success: 'Succesfull' }
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
            const jarPath = path.join(microbotDir, 'microbot-' + version + ".jar");
            jarExecutor.checkJavaAndRunJar(
                [
                    '-jar',
                    jarPath,
                    '-clean-jagex-launcher',
                    '-proxy=' + proxy.proxyIp,
                    '-proxy-type=' + proxy.proxyType
                ],
                dialog,
                shell
            );
        } catch (error) {
            logMessage(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('list-jars', async () => {
        const files = fs.readdirSync(microbotDir, (err) => {
            if (err) {
                return console.log('Unable to scan directory: ' + err);
            }
        });
        const regex = /\d/;
        return files.filter(file => file.startsWith('microbot-') && file.endsWith('.jar') && regex.test(file))
    });

    ipcMain.handle('launcher-version', async () => {
        return packageVersion
    });

    ipcMain.handle('log-error', async (event, message) => {
        logError(message)
    });
};
