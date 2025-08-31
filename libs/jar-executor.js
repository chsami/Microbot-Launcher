module.exports = async function (deps) {
    const { spawn, path, dialog, shell, log, fs, microbotDir, ipcMain } = deps;

    ipcMain.handle('open-client', async (event, version, proxy, account) => {
        try {
            const jarPath = path.join(microbotDir, `microbot-${version}.jar`);
            const commandArgs = ['-jar', jarPath];

            // apply proxy args (done differently depending on client version)
            addProxyArgs(commandArgs, version, proxy);

            if (account && account.profile) {
                commandArgs.push(`-profile=${account.profile}`);
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
            return { success: true };
        } catch (error) {
            log.error(error.message);
            return { error: error.message };
        }
    });

    ipcMain.handle('play-no-jagex-account', async (event, version, proxy) => {
        const jarPath = path.join(microbotDir, `microbot-${version}.jar`);
        const commandArgs = ['-jar', jarPath, '-clean-jagex-launcher'];

        // apply proxy args (done differently depending on client version)
        addProxyArgs(commandArgs, version, proxy);

        if (
            fs.existsSync(
                path.join(microbotDir, 'non-jagex-preferred-profile.json')
            )
        ) {
            try {
                const profileData = JSON.parse(
                    fs.readFileSync(
                        path.join(
                            microbotDir,
                            'non-jagex-preferred-profile.json'
                        ),
                        'utf8'
                    )
                );
                if (profileData?.profile && profileData.profile !== 'default') {
                    commandArgs.push(`-profile=${profileData.profile}`);
                }
            } catch (error) {
                log.error(
                    'Invalid non-jagex-preferred-profile.json:',
                    error.message
                );
            }
        }
        if (process.platform === 'darwin') {
            commandArgs.unshift(
                '--add-opens=java.desktop/com.apple.eawt=ALL-UNNAMED'
            );
            commandArgs.unshift('--add-opens=java.desktop/sun.awt=ALL-UNNAMED');
        }
        checkJavaAndRunJar(commandArgs, dialog, shell);
        return { success: true };
    });

    function isJavaInstalled(callback) {
        try {
            const javaProcess = spawn('java', ['-version']);
            let stderrData = '';
            let called = false;
            const TIMEOUT_MS = 5000;

            const finish = (success, message) => {
                if (called) return;
                called = true;
                clearTimeout(timeoutHandle);
                callback(success, message);
            };

            const timeoutHandle = setTimeout(() => {
                log.info(
                    `Java version check timed out after ${TIMEOUT_MS}ms – killing process`
                );
                try {
                    // attempt to kill the process; signal ignored on Windows
                    javaProcess.kill();
                } catch (_) {
                    /* ignore */
                }
                finish(false, `Java check timed out after ${TIMEOUT_MS}ms`);
            }, TIMEOUT_MS);

            javaProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            javaProcess.on('error', (err) => {
                finish(false, err.message);
            });

            javaProcess.on('close', (code) => {
                finish(code === 0, stderrData);
            });
        } catch (error) {
            callback(false, error.message);
        }
    }

    /**
     * Adds proxy arguments to the commandArgs array.
     * For versions < 1.9.9.2 we keep the old behavior: -proxy=<ip[:port]> -proxy-type=<type>
     * For versions >= 1.9.9.2 we only support SOCKS proxies in the following form: scheme://[user:pass@]host:port
     * Accepted legacy input formats (proxy.proxyIp):
     *   ip:port
     *   ip:port:user:pass (password may contain colons; extra segments are joined back for password)
     *   scheme://user:pass@host:port (already formatted; passed through unchanged)
     * We do not push -proxy-type for new versions.
     *
     * @param {string[]} commandArgs - The command arguments array.
     * @param {string} version - The client version (e.g. "1.9.9.1").
     * @param {Object} proxy - The proxy configuration object.
     */
    function addProxyArgs(commandArgs, version, proxy) {
        if (!proxy || !proxy.proxyIp) return;
        if (typeof proxy.proxyIp !== 'string') return;
        if (proxy.proxyIp.trim() === '') return;

        const isNewFormat =
            version.localeCompare('1.9.9.2', undefined, { numeric: true }) >= 0;

        if (!isNewFormat) {
            // Backwards compatibility: keep existing arguments exactly as before
            if (proxy.proxyType) {
                commandArgs.push(`-proxy=${proxy.proxyIp}`);
                commandArgs.push(`-proxy-type=${proxy.proxyType}`);
            }
            return;
        }

        // New format (>= 1.9.9.2) – only SOCKS proxies supported.
        // As the UI may be changed in the future, we need to be flexible with input formats.
        try {
            let raw = proxy.proxyIp.trim();
            // if user already supplied in URI format, just use it.
            if (raw.includes('://')) {
                commandArgs.push(`-proxy=${raw}`);
                return;
            }

            const DEFAULT_SCHEME = 'socks5';
            const parts = raw.split(':');

            if (parts.length === 2) {
                const [host, port] = parts;
                commandArgs.push(`-proxy=${DEFAULT_SCHEME}://${host}:${port}`);
            } else if (parts.length >= 4) {
                const host = parts[0];
                const port = parts[1];
                const user = parts[2];
                const pass = parts.slice(3).join(':'); // allow colons in password
                // encode user and pass (without encoding things may break)
                const encUser = encodeURIComponent(user);
                const encPass = encodeURIComponent(pass);
                commandArgs.push(
                    `-proxy=${DEFAULT_SCHEME}://${encUser}:${encPass}@${host}:${port}`
                );
            } else {
                // fallback: just attach whatever (may be just host)
                commandArgs.push(`-proxy=${DEFAULT_SCHEME}://${raw}`);
            }
        } catch (err) {
            log.error(`Failed to construct new proxy URI: ${err.message}`);
        }
    }

    /**
     * Redacts sensitive information from command line arguments.
     * @param {string[]} args - The command line arguments.
     * @returns {string[]} - The redacted command line arguments.
     */
    function redactCommandArgs(args) {
        return args.map((a) => {
            if (!a.startsWith('-proxy=')) return a;
            const value = a.slice('-proxy='.length);
            try {
                const u = new URL(value);
                if (u.username || u.password) {
                    if (u.username) u.username = '***';
                    if (u.password) u.password = '***';
                    return `-proxy=${u.toString()}`;
                }
            } catch (_) {
                // fallback: strip credentials if present
                return `-proxy=${value.replace(/\/\/[^@]*@/, '//***@')}`;
            }
            return a;
        });
    }

    function executeJar(commandArgs, dialog) {
        log.info(`java ${redactCommandArgs(commandArgs).join(' ')}`);

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

        let jarProcess = null;

        try {
            jarProcess = spawn(javaCommand, commandArgs, {
                detached: true,
                ...extraArgs
            });

            /**
             * We only pipe the output when debugging, to avoid flooding the
             * launcher log with client output as the client manages its own
             * logging.
             */
            if (process.env.DEBUG) {
                if (jarProcess.stdout) {
                    jarProcess.stdout.on('data', (data) => {
                        log.info(`[stdout] ${data}`);
                    });
                }
                if (jarProcess.stderr) {
                    jarProcess.stderr.on('data', (data) => {
                        log.info(`[stderr] ${data}`);
                    });
                }
            }

            /**
             * Allow the parent (launcher) to exit independently of the spawned client.
             * Found in the Node.js documentation: https://nodejs.org/api/child_process.html#optionsdetached
             */
            try {
                jarProcess.unref();
            } catch (_) {
                /* ignore */
            }

            jarProcess.on('error', (err) => {
                log.error(`[error] ${err.message}`);
                if (dialog) {
                    dialog.showErrorBox('Error running jar!', err.message);
                }
            });

            jarProcess.on('close', (code) => {
                log.info(`JAR exited with code ${code}`);
            });
        } catch (error) {
            log.error(`[error] ${error.message}`);
            if (dialog) {
                dialog.showErrorBox('Error running jar!', error.message);
            }
        }
    }

    function checkJavaAndRunJar(commandArgs, dialog, shell) {
        log.info(`java ${redactCommandArgs(commandArgs).join(' ')}`);

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
                            const arch =
                                process.arch === 'arm64' ? 'aarch64' : 'x64';
                            const platform = process.platform;
                            const urls = {
                                win32: `https://adoptium.net/temurin/releases/?os=windows&arch=${arch}&package=jdk&version=17&mode=filter`,
                                darwin: `https://adoptium.net/temurin/releases/?os=mac&arch=${arch}&package=jdk&version=17&mode=filter`,
                                linux: `https://adoptium.net/temurin/releases/?os=linux&arch=${arch}&package=jdk&version=17&mode=filter`
                            };
                            shell.openExternal(
                                urls[platform] ||
                                    'https://adoptium.net/temurin/'
                            );
                        } else {
                            log.info('User chose not to download Java.');
                        }
                    });
            }
        });
    }
};
