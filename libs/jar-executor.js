
module.exports = async function (deps) {

    const {
        spawn,
        path,
        dialog,
        shell,
        log,
        microbotDir,
        ipcMain
    } = deps

    ipcMain.handle('open-client', async (event, version, proxy) => {
        try {
            const jarPath = path.join(microbotDir, 'microbot-' + version + ".jar");
            const commandArgs = [
                '-jar',
                jarPath,
                '-proxy=' + proxy.proxyIp,
                '-proxy-type=' + proxy.proxyType
            ];
            checkJavaAndRunJar(
                commandArgs,
                dialog,
                shell
            );
        } catch (error) {
            log.error(error.message)
            return { error: error.message };
        }
    });

    ipcMain.handle('play-no-jagex-account', async (event, version, proxy) => {
        const jarPath = path.join(microbotDir, 'microbot-' + version + ".jar");
        const commandArgs = [
            '-jar',
            jarPath,
            '-clean-jagex-launcher',
            '-proxy=' + proxy.proxyIp,
            '-proxy-type=' + proxy.proxyType
            
        ];
        checkJavaAndRunJar(
            commandArgs,
            dialog,
            shell
        );
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

        const jarProcess = spawn('java', commandArgs);

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
                dialog.showMessageBox({
                    type: 'error',
                    title: 'Java Not Found',
                    message: 'Java Development Kit (JDK) is required to run this application. Would you like to download it now?',
                    buttons: ['Yes, Download JDK', 'Cancel']
                }).then((result) => {
                    if (result.response === 0) {
                        shell.openExternal('https://www.oracle.com/java/technologies/downloads/');
                    } else {
                        log.info('User chose not to download Java.');
                    }
                });
            }
        });
    }
}



