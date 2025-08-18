module.exports = async function (deps) {
    const {
        ipcMain,
        axios,
        microbotDir,
        packageJson,
        path,
        log,
        dialog,
        fs,
        projectDir,
        app
    } = deps;

    const url = 'https:/microbot.cloud';
    const filestorage = 'https://files.microbot.cloud';

    const { startAuthFlow } = require(path.join(
        projectDir,
        'libs/oauth-jagex.js'
    ));
    const { isBrowserDownloaded } = require(path.join(
        projectDir,
        'libs/browser-util.js'
    ));

    ipcMain.handle('start-auth-flow', async () => {
        try {
            return await startAuthFlow();
        } catch (error) {
            log.error(`Error during authentication flow: ${error.message}`);
            return { error: error.message };
        }
    });

    ipcMain.handle('is-browser-downloaded', async () => {
        try {
            return await isBrowserDownloaded();
        } catch (error) {
            log.error(`Error checking if browser is downloaded: ${error}`);
            return { error: error.message };
        }
    });

    const propertiesHandler = require(path.join(
        projectDir,
        'libs/properties.js'
    ));
    await propertiesHandler(deps);
    const overwriteCredentialsHandler = require(path.join(
        projectDir,
        'libs/overwrite-credential-properties.js'
    ));
    await overwriteCredentialsHandler(deps);
    const accountLoaderHandler = require(path.join(
        projectDir,
        'libs/accounts-loader.js'
    ));
    await accountLoaderHandler(deps);
    const jarExecutorHandler = require(path.join(
        projectDir,
        'libs/jar-executor.js'
    ));
    await jarExecutorHandler(deps);
    const packageVersion = packageJson.version;

    ipcMain.handle('download-microbot-launcher', async (event) => {
        try {
            event.sender.send('progress', {
                percent: 70,
                status: 'Downloading Microbot Jagex Launcher...'
            });
            const response = await axios.get(
                filestorage + '/assets/microbot-launcher/microbot-launcher.jar',
                { responseType: 'arraybuffer' }
            );
            event.sender.send('progress', {
                percent: 80,
                status: 'Finishing...'
            });
            const filePath = path.join(microbotDir, 'microbot-launcher.jar');
            fs.writeFileSync(filePath, response.data);
            event.sender.send('progress', {
                percent: 80,
                status: 'Completed!'
            });
            return { success: true, path: filePath };
        } catch (error) {
            log.error(`Error downloading Microbot launcher: ${error}`);
            return { error: error.message };
        }
    });

    ipcMain.handle('download-client', async (event, version) => {
        const url = `${filestorage}/releases/microbot/stable/microbot-${version}.jar`;
        try {
            event.sender.send('progress', {
                percent: 90,
                status: 'Downloading Microbot-' + version + ''
            });
            if (
                fs.existsSync(path.join(microbotDir, `microbot-${version}.jar`))
            ) {
                return {
                    success: true,
                    path: path.join(microbotDir, `microbot-${version}.jar`)
                };
            }
            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'arraybuffer',
                onDownloadProgress: (progressEvent) => {
                    const totalLength = 126009591;
                    const progress = (
                        (progressEvent.loaded * 100) /
                        totalLength
                    ).toFixed(2);
                    let currentPercent = (10 + progress * 0.4).toFixed(2);
                    event.sender.send('progress', {
                        percent: currentPercent,
                        status: `Downloading client ${version}... (${progress}%)`
                    });
                }
            });
            const filePath = path.join(microbotDir, `microbot-${version}.jar`);
            fs.writeFileSync(filePath, response.data);
            event.sender.send('progress', {
                percent: 100,
                status: 'Completed!'
            });
            return { success: true, path: filePath };
        } catch (error) {
            log.error(
                `Error downloading client ${version} from ${url}:`,
                error
            );
            return { error: error.message };
        }
    });

    ipcMain.handle('fetch-launcher-version', async () => {
        try {
            const response = await axios.get(url + '/api/version/launcher');
            return response.data;
        } catch (error) {
            log.error(`Error fetching launcher version: ${error}`);
            return { error: error.message };
        }
    });

    ipcMain.handle('fetch-client-version', async () => {
        try {
            const response = await axios.get(url + '/api/version/client');
            return response.data;
        } catch (error) {
            log.error(`Error fetching client version: ${error}`);
            return { error: error.message };
        }
    });

    ipcMain.handle('client-exists', async (event, version) => {
        try {
            const filePath = path.join(microbotDir, `microbot-${version}.jar`);
            log.info(filePath);
            return fs.existsSync(filePath);
        } catch (error) {
            log.error(`Error checking if client exists: ${error}`);
            return { error: error.message };
        }
    });

    ipcMain.handle('launcher-exists', async () => {
        try {
            const filePath = path.join(microbotDir, 'microbot-launcher.jar');
            return fs.existsSync(filePath);
        } catch (error) {
            log.error(`Error checking if launcher exists: ${error}`);
            return { error: error.message };
        }
    });

    ipcMain.handle('list-jars', async () => {
        const files = fs.readdirSync(microbotDir, (err) => {
            if (err) {
                return log.error(`Unable to scan directory: ${err}`);
            }
        });
        const regex = /\d/;
        return files.filter(
            (file) =>
                file.startsWith('microbot-') &&
                file.endsWith('.jar') &&
                regex.test(file)
        );
    });

    /*
     * Read the profiles from the %USERPROFILE%/.runelite/profiles.json
     * and filter out profiles with negative ID, returning the name strings
     * so that the frontend can populate the profile select element
     */
    ipcMain.handle('list-profiles', async () => {
        const user = process.env.USERPROFILE || process.env.HOME;
        const profilesPath = path.join(
            user,
            '.runelite',
            'microbot-profiles',
            'profiles.json'
        );
        if (fs.existsSync(profilesPath)) {
            try {
                const data = fs.readFileSync(profilesPath, 'utf8');
                const object = JSON.parse(data);
                return object.profiles
                    .filter(
                        (profile) =>
                            profile.id > 0 && profile.name !== 'default'
                    )
                    .map((profile) => profile.name);
            } catch (error) {
                log.error(`Error reading profiles file: ${error}`);
                return { error: error.message };
            }
        } else {
            log.error('Profiles file does not exist');
            return { error: 'Profiles file does not exist' };
        }
    });

    ipcMain.handle('read-non-jagex-profile', async () => {
        const profileFilePath = path.join(
            microbotDir,
            'non-jagex-preferred-profile.json'
        );
        if (fs.existsSync(profileFilePath)) {
            try {
                const data = fs.readFileSync(profileFilePath, 'utf8');
                const profile = JSON.parse(data);
                return profile?.profile;
            } catch (error) {
                log.error(`Error reading non-Jagex profile file: ${error}`);
                return { error: error.message };
            }
        } else {
            log.error('Non-Jagex profile file does not exist');
            return { error: 'Non-Jagex profile file does not exist' };
        }
    });

    ipcMain.handle('launcher-version', async () => {
        return packageVersion;
    });

    ipcMain.handle('log-error', async (event, message) => {
        log.error(message);
    });

    ipcMain.handle('error-alert', async (event, message) => {
        try {
            const result = await dialog.showMessageBox({
                type: 'error',
                title: 'Error',
                message: message
            });
            return result;
        } catch (error) {
            log.error(`Error showing error alert: ${error}`);
            return { error: error.message };
        }
    });
};
