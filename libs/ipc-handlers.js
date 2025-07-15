module.exports = async function (deps) {

    const {
        ipcMain,
        AdmZip,
        axios,
        microbotDir,
        packageJson,
        downloadAndSaveFile,
        path,
        log,
        fs,
        projectDir
    } = deps

    const url = 'https:/microbot.cloud';
    const filestorage = 'https://files.microbot.cloud';

    await downloadAndSaveFile(filestorage + '/assets/microbot-launcher/libs/properties.js', path.join(microbotDir, 'libs/properties.js'), path.join(projectDir, 'libs/properties.js'))
    await downloadAndSaveFile(filestorage + '/assets/microbot-launcher/libs/overwrite-credential-properties.js', path.join(microbotDir, 'libs/overwrite-credential-properties.js'), path.join(projectDir, 'libs/overwrite-credential-properties.js'))
    await downloadAndSaveFile(filestorage + '/assets/microbot-launcher/libs/accounts-loader.js', path.join(microbotDir, 'libs/accounts-loader.js'), path.join(projectDir, 'libs/accounts-loader.js'))
    await downloadAndSaveFile(filestorage + '/assets/microbot-launcher/libs/jar-executor.js', path.join(microbotDir, 'libs/jar-executor.js'), path.join(projectDir, 'libs/jar-executor.js'))
    
   
    const propertiesHandler = require(path.join(microbotDir, 'libs/properties.js'));
    await propertiesHandler(deps)
    const overwriteCredentialsHandler = require(path.join(microbotDir, 'libs/overwrite-credential-properties.js'));
    await overwriteCredentialsHandler(deps)
    const accountLoaderHandler = require(path.join(microbotDir, 'libs/accounts-loader.js'));
    await accountLoaderHandler(deps)
    const jarExecutorHandler = require(path.join(microbotDir, 'libs/jar-executor.js'));
    await jarExecutorHandler(deps)
    const packageVersion = packageJson.version;

    ipcMain.handle('download-jcef', async (event) => {
        try {
            event.sender.send('progress', { percent: 10, status: 'Downloading...' });

            const response = await axios({
                method: 'get',
                url: filestorage + '/assets/microbot-launcher/jcef-bundle.zip',
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
            log.error(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('download-microbot-launcher', async (event) => {
        try {
            event.sender.send('progress', { percent: 70, status: 'Downloading Microbot Jagex Launcher...' });
            const response = await axios.get(filestorage + '/assets/microbot-launcher/microbot-launcher.jar', { responseType: 'arraybuffer' });
            event.sender.send('progress', { percent: 80, status: 'Finishing...' });
            const filePath = path.join(microbotDir, 'microbot-launcher.jar');
            fs.writeFileSync(filePath, response.data);
            event.sender.send('progress', { percent: 80, status: 'Completed!' });
            return { success: true, path: filePath };
        } catch (error) {
            log.error(error.message)
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
                url: filestorage + '/releases/microbot/stable/microbot-' + version + '.jar',
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
            log.error(error.message)
            return { error: error.message };
        }
    });



    ipcMain.handle('fetch-launcher-version', async () => {
        try {
            const response = await axios.get(url + '/api/file/launcher');
            return response.data;
        } catch (error) {
            log.error(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('fetch-client-version', async () => {
        try {
            const response = await axios.get(url + '/api/file/client');
            return response.data;
        } catch (error) {
            log.error(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('fetch-launcher-html-version', async () => {
        try {
            const response = await axios.get(url + '/api/file/html');
            return response.data;
        } catch (error) {
            log.error(error.message)
            return { error: error.message };
        }
    });

  

    ipcMain.handle('jcef-exists', async () => {
        try {
            const filePath = path.join(microbotDir, 'jcef-bundle');
            return fs.existsSync(filePath)
        } catch (error) {
            log.error(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('client-exists', async (event, version) => {
        try {
            const filePath = path.join(microbotDir, version);
            log.info(filePath)
            return fs.existsSync(filePath)
        } catch (error) {
            log.error(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('launcher-exists', async () => {
        try {
            const filePath = path.join(microbotDir, 'microbot-launcher.jar');
            return fs.existsSync(filePath)
        } catch (error) {
            log.error(error.message)
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
        log.error(message)
    });
};