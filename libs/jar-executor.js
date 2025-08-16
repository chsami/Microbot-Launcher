module.exports = async function (deps) {
    const { spawn, path, dialog, shell, log, fs, microbotDir, ipcMain } = deps;

    ipcMain.handle('open-client', async (event, version, proxy, account) => {
        try {
            const jarPath = path.join(microbotDir, `microbot-${version}.jar`);
            const commandArgs = ['-jar', jarPath];

            if (proxy && proxy.proxyIp !== '') {
                commandArgs.push(`-proxy=${proxy.proxyIp}`);
                commandArgs.push(`-proxy-type=${proxy.proxyType}`);
            }

            if (account) {
                const accounts = await window.electron.readAccounts();
                const selectedAccount = accounts?.find(
                    (x) => x.accountId === account
                );
                if (selectedAccount) {
                    commandArgs.push(`-profile=${selectedAccount.profile}`);
                }
            }

            if (process.platform === 'darwin') {
                commandArgs.unshift(
                    '--add-opens=java.desktop/com.apple.eawt=ALL-UNNAMED'
                );
                commandArgs.unshift(
                    '--add-opens=java.desktop/sun.awt=ALL-UNNAMED'
                );
            }

            checkJavaAndRunJar(commandArgs, dialog, shell);
        } catch (error) {
            log.error(error.message);
            return { error: error.message };
        }
    });

    ipcMain.handle('play-no-jagex-account', async (event, version, proxy) => {
        const jarPath = path.join(microbotDir, `microbot-${version}.jar`);
        const commandArgs = ['-jar', jarPath, '-clean-jagex-launcher'];

        if (proxy) {
            commandArgs.push(`-proxy=${proxy.proxyIp}`);
            commandArgs.push(`-proxy-type=${proxy.proxyType}`);
        }

        if (
            fs.existsSync(
                path.join(microbotDir, 'non-jagex-preferred-profile.json')
            )
        ) {
            const profileData = JSON.parse(
                fs.readFileSync(
                    path.join(microbotDir, 'non-jagex-preferred-profile.json'),
                    'utf8'
                )
            );
            if (profileData.profile && profileData.profile !== 'default') {
                commandArgs.push(`-profile=${profileData.profile}`);
            }
        }
        if (process.platform === 'darwin') {
            commandArgs.unshift(
                '--add-opens=java.desktop/com.apple.eawt=ALL-UNNAMED'
            );
            commandArgs.unshift('--add-opens=java.desktop/sun.awt=ALL-UNNAMED');
        }
        checkJavaAndRunJar(commandArgs, dialog, shell);
    });

    function isJavaInstalled(callback) {
        const javaProcess = spawn('java', ['-version']);

        let stderrData = '';

        javaProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        javaProcess.on('error', (err) => {
            callback(false, err.message);
        });

        javaProcess.on('close', (code) => {
            callback(code === 0, stderrData);
        });
    }

    function executeJar(commandArgs, dialog) {
        log.info(`java ${commandArgs.join(' ')}`);

        /**
         * Additional arguments for spawn library.
         * With those arguments, we detach clients from the launcher,
         * guaranteeing that they will continue to run when the launcher is closed.
         * If not in debug mode, we use windowsHide to attempt suppressing the console window,
         * and we ignore the output streams as backup.
         */
        let extraArgs = {};
        if (!process.env.DEBUG)
            extraArgs = { stdio: 'ignore', windowsHide: true };

        // use javaw on windows to avoid console window popping up
        const javaCommand = process.platform === 'win32' ? 'javaw' : 'java';
        const jarProcess = spawn(javaCommand, commandArgs, {
            detached: true,
            ...extraArgs
        });

        jarProcess.stdout.on('data', (data) => {
            log.info(`[stdout] ${data}`);
        });

        jarProcess.stderr.on('data', (data) => {
            log.info(`[stddata] ${data}`);
        });

        jarProcess.on('error', (err) => {
            log.error(`[error] ${err.message}`);
            if (dialog) {
                dialog.showErrorBox('Error running jar!', err.message);
            }
        });

        jarProcess.on('close', (code) => {
            log.info(`JAR exited with code ${code}`);
        });
    }

    function checkJavaAndRunJar(commandArgs, dialog, shell) {
        log.info(`java ${commandArgs.join(' ')}`);
        isJavaInstalled((isInstalled, error) => {
            if (isInstalled) {
                log.info('Java is installed, running the JAR...');
                executeJar(commandArgs, dialog);
            } else {
                dialog
                    .showMessageBox({
                        type: 'error',
                        title: 'Java Not Found',
                        message:
                            'Java Development Kit (JDK) is required to run this application. Would you like to download it now?',
                        buttons: ['Yes, Download JDK', 'Cancel']
                    })
                    .then((result) => {
                        if (result.response === 0) {
                            shell.openExternal(
                                'https://www.oracle.com/java/technologies/downloads/'
                            );
                        } else {
                            log.info('User chose not to download Java.');
                        }
                    });
            }
        });
    }
};
