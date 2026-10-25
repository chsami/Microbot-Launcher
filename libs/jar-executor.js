module.exports = async function (deps) {
    const { spawn, path, dialog, shell, log, fs, microbotDir, ipcMain, clipboard, packageJson } = deps;
    const os = require('os');
    const javaRuntime = require(path.join(__dirname, 'java-runtime.js'));
    const managedJdk = require(path.join(__dirname, 'managed-jdk.js'));
    const progressFor = (event) => (percent, status) => {
        if (event && event.sender) event.sender.send('progress', { percent, status });
    };
    let managedJavaReady = null;
    const { toProxyUri } = require(path.join(__dirname, 'login-proxy.js'));
    const { hwidAgentArgs } = require(path.join(__dirname, 'hwid-agent.js'));
    const STARTUP_WINDOW_MS = deps.startupWindowMs || 20000;
    const CLIENT_TOKEN_ENV = 'MICROBOT_CLIENT_TOKEN';
    const MAX_CAPTURED_STDERR = 64 * 1024;

    const cliRamValue = extractRamValue(process.argv);
    const cliMemory = buildMemoryArgsFromRam(cliRamValue, log, '--ram');
    const defaultMemoryConfig =
        cliMemory ?? {
            args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
            normalized: DEFAULT_CLIENT_RAM
        };
    const defaultMemorySource = cliMemory
        ? `CLI --ram (${cliMemory.normalized})`
        : `launcher default (${DEFAULT_CLIENT_RAM})`;

    log.info(
        `Configured default client memory (${defaultMemorySource}): ${defaultMemoryConfig.args.join(' ')}`
    );

    function selectMemoryArgs(requestedRam) {
        const rawValue =
            typeof requestedRam === 'string'
                ? requestedRam.trim().toLowerCase()
                : '';
        const override = buildMemoryArgsFromRam(
            rawValue,
            log,
            'client RAM preference'
        );

        if (override) {
            return {
                args: override.args,
                source: `client preference (${override.normalized})`
            };
        }

        return {
            args: [...defaultMemoryConfig.args],
            source: defaultMemorySource
        };
    }

    function buildCommandArgs({ version, proxy, ramPreference, hwidSpoof, profile, cleanJagex, label }) {
        const jarPath = path.join(microbotDir, `microbot-${version}.jar`);
        const memoryConfig = selectMemoryArgs(ramPreference);
        log.info(
            `Launching ${label} with ${memoryConfig.source} memory settings: ${memoryConfig.args.join(' ')}`
        );
        const commandArgs = [...memoryConfig.args, ...GC_FLAGS, '-jar', jarPath];
        if (cleanJagex) commandArgs.push('-clean-jagex-launcher');
        commandArgs.unshift(...hwidAgentArgs({ fs, microbotDir, version, enabled: hwidSpoof }));

        const err = addProxyArgs(commandArgs, proxy);
        if (err) return { error: err.message };

        if (profile) commandArgs.push(`-profile=${profile}`);

        if (process.platform === 'darwin') {
            commandArgs.unshift('--add-opens=java.desktop/com.apple.eawt=ALL-UNNAMED');
            commandArgs.unshift('--add-opens=java.desktop/sun.awt=ALL-UNNAMED');
        }
        return { commandArgs };
    }

    async function prepareLaunch({ version, proxy, account, ramPreference, hwidSpoof, noJagexProfile }) {
        const noJagex = noJagexProfile !== undefined;
        const profile = noJagex
            ? noJagexProfile && noJagexProfile !== 'default'
                ? noJagexProfile
                : null
            : account && account.profile;
        const built = buildCommandArgs({
            version,
            proxy,
            ramPreference,
            hwidSpoof,
            profile,
            cleanJagex: noJagex,
            label: noJagex ? 'non-Jagex client' : 'client'
        });
        if (built.error) return built;
        const token = await alertToken(noJagex ? profile : account && account.profile);
        return {
            commandArgs: built.commandArgs,
            secrets: withToken(noJagex ? [] : accountSecrets(account), token),
            env: clientEnv(token)
        };
    }

    async function launch(options) {
        const prepared = await prepareLaunch(options);
        if (prepared.error) {
            log.error(prepared.error);
            return { problem: { kind: 'invalid-proxy', title: 'Invalid Proxy', message: prepared.error } };
        }
        return checkJavaAndRunJar(prepared.commandArgs, prepared.secrets, options.progress, prepared.env, {
            interactive: false
        });
    }

    ipcMain.handle(
        'open-client',
        async (event, version, proxy, account, ramPreference, hwidSpoof) => {
            try {
                const prepared = await prepareLaunch({ version, proxy, account, ramPreference, hwidSpoof });
                if (prepared.error) {
                    log.error(prepared.error);
                    return { error: prepared.error };
                }
                const credentials = account && account.accountId && account.sessionId ? account : null;
                startInTurn(event, () => {
                    if (credentials) {
                        try {
                            deps.writeCredentials?.(credentials);
                        } catch (error) {
                            showLaunchProblem(
                                {
                                    kind: 'credentials-failed',
                                    title: 'Could Not Save The Login',
                                    message: `The launcher could not write credentials.properties: ${error.message}`,
                                    recovery: 'Check that the .runelite folder in your home folder is writable, then try again.'
                                },
                                { secrets: prepared.secrets }
                            );
                            return { problem: { kind: 'credentials-failed' } };
                        }
                    }
                    return checkJavaAndRunJar(prepared.commandArgs, prepared.secrets, progressFor(event), prepared.env);
                });
                return { success: true };
            } catch (error) {
                log.error(error.message);
                return { error: error.message };
            }
        }
    );

    ipcMain.handle(
        'play-no-jagex-account',
        async (event, version, proxy, ramPreference, hwidSpoof) => {
            const prepared = await prepareLaunch({
                version,
                proxy,
                ramPreference,
                hwidSpoof,
                noJagexProfile: readPreferredProfile()
            });
            if (prepared.error) {
                log.error(prepared.error);
                return { error: prepared.error };
            }
            startInTurn(event, () =>
                checkJavaAndRunJar(prepared.commandArgs, prepared.secrets, progressFor(event), prepared.env)
            );
            return { success: true };
        }
    );

    function startInTurn(event, start) {
        const queue = deps.launchQueue;
        if (!queue) {
            start();
            return;
        }
        if (queue.busy()) progressFor(event)(5, 'Waiting for the previous client to finish starting...');
        queue.run(start).catch((error) => log.error(`Launch failed: ${error?.message || error}`));
    }

    function readPreferredProfile() {
        const file = path.join(microbotDir, 'non-jagex-preferred-profile.json');
        if (!fs.existsSync(file)) return null;
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'))?.profile || null;
        } catch (error) {
            log.error('Invalid non-jagex-preferred-profile.json:', error.message);
            return null;
        }
    }

    async function alertToken(profile) {
        if (!deps.alerts) return null;
        try {
            return await deps.alerts.tokenForProfile(profile);
        } catch (error) {
            log.warn(`Could not prepare bot alerts: ${error.message}`);
            return null;
        }
    }

    function clientEnv(token) {
        return token ? { ...process.env, [CLIENT_TOKEN_ENV]: token } : null;
    }

    function withToken(secrets, token) {
        return token ? [...secrets, token] : secrets;
    }

    function probeJava(callback, command = 'java') {
        let called = false;
        let timeoutHandle = null;
        const finish = (result) => {
            if (called) return;
            called = true;
            clearTimeout(timeoutHandle);
            callback(result);
        };

        try {
            const javaProcess = spawn(command, javaRuntime.PROBE_ARGS);
            let output = '';
            const TIMEOUT_MS = 5000;

            timeoutHandle = setTimeout(() => {
                log.info(
                    `Java version check timed out after ${TIMEOUT_MS}ms – killing process`
                );
                try {
                    javaProcess.kill();
                } catch (_) {
                    /* ignore */
                }
                finish({ problem: javaRuntime.classifyProbeFailure({ timedOut: true }) });
            }, TIMEOUT_MS);

            const collect = (data) => {
                if (output.length < MAX_CAPTURED_STDERR) output += data.toString();
            };
            for (const stream of [javaProcess.stdout, javaProcess.stderr]) {
                if (!stream) continue;
                if (stream.setEncoding) stream.setEncoding('utf8');
                stream.on('data', collect);
            }

            javaProcess.on('error', (err) => {
                finish({ problem: javaRuntime.classifyProbeFailure({ error: err }) });
            });

            javaProcess.on('close', (code) => {
                if (code === 0) {
                    finish({ runtime: javaRuntime.parseJavaSettings(output) });
                } else {
                    finish({
                        problem: javaRuntime.classifyProbeFailure({ code, stderr: output })
                    });
                }
            });
        } catch (error) {
            finish({ problem: javaRuntime.classifyProbeFailure({ error }) });
        }
    }

    /**
     * Adds proxy arguments to the commandArgs array.
     * Since version >= 1.9.9.2 we only support SOCKS proxies in the following form: scheme://[user:pass@]host:port
     * Accepted legacy input formats (proxy.proxyIp):
     *   ip:port
     *   ip:port:user:pass (password may contain colons; extra segments are joined back for password)
     *   scheme://user:pass@host:port (already formatted; passed through unchanged)
     * We do not push -proxy-type for new versions.
     *
     * @param {string[]} commandArgs - The command arguments array.
     * @param {Object} proxy - The proxy configuration object.
     * @returns {Error|null} - Returns an error if the proxy configuration is invalid, otherwise null.
     */
    function addProxyArgs(commandArgs, proxy) {
        if (!proxy || !proxy.proxyIp) return null;
        if (typeof proxy.proxyIp !== 'string') return null;
        if (proxy.proxyIp.trim() === '') return null;

        try {
            commandArgs.push(`-proxy=${toProxyUri(proxy.proxyIp)}`);
        } catch (err) {
            return new Error(
                'Failed to construct new proxy URI: ' + err.message
            );
        }
        return null;
    }

    function homeDirectories() {
        const homes = [os.homedir()];
        try {
            homes.push(os.userInfo().homedir);
        } catch (_) {}
        return homes;
    }

    function accountSecrets(account) {
        if (!account) return [];
        return [account.displayName, account.accountId, account.profile].filter(
            (value) => typeof value === 'string' && value !== 'Not set' && value !== 'default'
        );
    }

    function reportProblem(launch, problem, context = {}) {
        if (launch.interactive) {
            showLaunchProblem(problem, { ...context, secrets: launch.secrets });
        } else {
            logLaunchProblem(problem, { ...context, secrets: launch.secrets });
        }
        launch.finish({ problem });
    }

    function logLaunchProblem(problem, { runtime, executable, stderr, secrets } = {}) {
        const details = javaRuntime.formatProblemDetails({
            problem,
            runtime,
            executable,
            stderr,
            launcherVersion: packageJson && packageJson.version,
            platform: process.platform,
            arch: process.arch,
            homeDir: homeDirectories(),
            secrets
        });
        log.error(`[launch problem]\n${details}`);
        return details;
    }

    function showLaunchProblem(problem, context = {}) {
        const details = logLaunchProblem(problem, context);
        if (!dialog) return;

        const buttons = [];
        if (problem.offerDownload) buttons.push('Yes, Download JDK');
        if (clipboard) buttons.push('Copy details');
        buttons.push('Cancel');

        dialog
            .showMessageBox({
                type: 'error',
                title: problem.title,
                message: problem.message,
                detail: details,
                buttons,
                defaultId: 0,
                cancelId: buttons.length - 1
            })
            .then((result) => {
                const choice = buttons[result.response];
                if (choice === 'Yes, Download JDK') {
                    shell.openExternal(
                        javaRuntime.javaDownloadUrl(process.platform, process.arch)
                    );
                } else if (choice === 'Copy details') {
                    clipboard.writeText(details);
                } else {
                    log.info('User dismissed the launch problem dialog.');
                }
            })
            .catch((err) => log.error(`Failed to show launch problem: ${err.message}`));
    }

    function executeJar(executable, commandArgs, runtime, launch) {
        const { env } = launch;
        const loggedArgs = commandArgs.map((arg) => arg.replace(/^(-(?:profile|proxy)=).*/s, '$1***'));
        log.info(`${executable} ${javaRuntime.redactText(loggedArgs.join(' '), { homeDir: homeDirectories() })}`);

        /**
         * Additional arguments for spawn library.
         * With those arguments, we detach clients from the launcher,
         * guaranteeing that they will continue to run when the launcher is closed.
         * If not in debug mode, we use windowsHide to attempt suppressing the console window,
         * ignore stdout, and only read stderr during startup to explain launch failures.
         */
        let extraArgs = {};
        if (!process.env.DEBUG)
            extraArgs = { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true };

        const startedAt = Date.now();
        let stderrData = '';
        let reported = false;
        let jarProcess = null;

        const report = (problem) => {
            if (reported) return;
            reported = true;
            reportProblem(launch, problem, { runtime, executable, stderr: stderrData });
        };

        try {
            jarProcess = spawn(executable, commandArgs, {
                detached: true,
                ...extraArgs,
                ...(env ? { env } : {})
            });

            /**
             * We only pipe stdout when debugging, to avoid flooding the
             * launcher log with client output as the client manages its own
             * logging.
             */
            if (process.env.DEBUG && jarProcess.stdout) {
                jarProcess.stdout.on('data', (data) => {
                    log.info(`[stdout] ${data}`);
                });
            }
            if (jarProcess.stderr) {
                if (jarProcess.stderr.setEncoding) jarProcess.stderr.setEncoding('utf8');
                jarProcess.stderr.on('data', (data) => {
                    if (process.env.DEBUG) log.info(`[stderr] ${data}`);
                    stderrData += data.toString();
                    if (stderrData.length > MAX_CAPTURED_STDERR) {
                        stderrData = stderrData.slice(-MAX_CAPTURED_STDERR);
                    }
                });
                jarProcess.stderr.on('error', () => {});
            }

            const startupTimer = setTimeout(() => {
                if (!process.env.DEBUG && jarProcess.stderr) {
                    jarProcess.stderr.destroy();
                }
                launch.finish({ started: true });
            }, STARTUP_WINDOW_MS);
            if (startupTimer.unref) startupTimer.unref();

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
                clearTimeout(startupTimer);
                report(javaRuntime.classifyLaunchFailure({ error: err }));
            });

            jarProcess.on('close', (code, signal) => {
                clearTimeout(startupTimer);
                const elapsed = Date.now() - startedAt;
                log.info(`JAR exited with code ${code} after ${elapsed}ms`);
                if (elapsed <= STARTUP_WINDOW_MS && code !== 0) {
                    report(javaRuntime.classifyLaunchFailure({ code, signal, stderr: stderrData }));
                } else if (elapsed <= STARTUP_WINDOW_MS) {
                    launch.finish({ problem: CLOSED_DURING_STARTUP });
                } else {
                    launch.finish({ started: true });
                }
            });
        } catch (error) {
            log.error(`[error] ${error.message}`);
            report(javaRuntime.classifyLaunchFailure({ error }));
        }
    }

    function checkJavaAndRunJar(commandArgs, secrets = [], progress = () => {}, env = null, { interactive = true } = {}) {
        return new Promise((resolve) => {
            let finished = false;
            const launch = {
                secrets,
                env,
                interactive,
                finish: (outcome) => {
                    if (finished) return;
                    finished = true;
                    resolve(outcome);
                }
            };
            probeJava((result) => {
                if (!needsManagedJava(result)) {
                    launchWithRuntime(result, commandArgs, launch);
                    return;
                }
                probeManagedJava((managed) => {
                    if (!needsManagedJava(managed)) {
                        launchWithRuntime(managed, commandArgs, launch);
                        return;
                    }
                    if (!interactive) {
                        reportProblem(launch, JAVA_NEEDS_INSTALL);
                        return;
                    }
                    offerManagedInstall(commandArgs, progress || (() => {}), launch);
                });
            });
        });
    }

    function needsManagedJava(result) {
        if (!result) return true;
        if (result.problem) return result.problem.kind === 'missing-java';
        return Boolean(result.runtime.major) && result.runtime.major < javaRuntime.MIN_JAVA_MAJOR;
    }

    function probeManagedJava(callback) {
        const candidate = managedJdk.javaPath(microbotDir, process.platform);
        if (!fs.existsSync(candidate)) {
            callback(null);
            return;
        }
        probeJava(callback, candidate);
    }

    function probeJavaAsync(command) {
        return new Promise((resolve) => probeJava(resolve, command));
    }

    function launchWithRuntime({ runtime, problem }, commandArgs, launch) {
        if (problem) {
            reportProblem(launch, problem, { stderr: problem.stderr });
            return;
        }

        log.info(`Selected Java runtime: ${javaRuntime.describeRuntime(runtime)} at ${runtime.home || 'unknown home'}`);
        const evaluation = javaRuntime.evaluateRuntime(runtime, {
            heapMb: javaRuntime.heapMbFromArgs(commandArgs)
        });
        evaluation.warnings.forEach((warning) => log.warn(warning.message));
        if (!evaluation.compatible) {
            reportProblem(
                launch,
                {
                    kind: 'incompatible-java',
                    title: 'Incompatible Java',
                    message: evaluation.problems.map((p) => p.message).join(' '),
                    recovery: evaluation.problems.map((p) => p.recovery).join(' '),
                    offerDownload: true
                },
                { runtime }
            );
            return;
        }

        const launchArgs = javaRuntime.supportedVmArgs(runtime, commandArgs);
        if (!javaRuntime.supportsZgc(runtime)) {
            log.info(`${javaRuntime.describeRuntime(runtime)} cannot use ZGC; launching without ZGC flags.`);
        }
        const executable = javaRuntime.launcherExecutable(runtime, process.platform, fs.existsSync);
        log.info('Java runtime is compatible, running the JAR...');
        executeJar(executable, launchArgs, runtime, launch);
    }

    function obtainManagedJava(progress) {
        if (!managedJavaReady) {
            managedJavaReady = promptAndInstallManagedJava(progress).finally(() => {
                managedJavaReady = null;
            });
        }
        return managedJavaReady;
    }

    function offerManagedInstall(commandArgs, progress, launch) {
        obtainManagedJava(progress).then((result) => {
            if (result) launchWithRuntime(result, commandArgs, launch);
            else launch.finish({ problem: JAVA_NEEDS_INSTALL });
        });
    }

    async function promptAndInstallManagedJava(progress) {
        const major = javaRuntime.RECOMMENDED_JAVA_MAJOR;
        if (!dialog) {
            log.error(`Java ${major} is required, but no dialog is available to offer the install.`);
            return null;
        }
        const choice = await dialog.showMessageBox({
            type: 'question',
            title: `Install Java ${major}`,
            message: `Microbot needs 64-bit Java ${major}, and no usable Java was found.`,
            detail: `Microbot can download Eclipse Temurin Java ${major} (about 190 MB) into its own .microbot folder. Your system Java is not changed.`,
            buttons: [`Install Java ${major}`, 'Open download page', 'Cancel'],
            defaultId: 0,
            cancelId: 2
        });
        if (choice.response === 1) {
            shell.openExternal(javaRuntime.javaDownloadUrl(process.platform, process.arch));
            return null;
        }
        if (choice.response !== 0) {
            log.info('User declined installing Java.');
            return null;
        }
        try {
            const install = deps.installManagedJdk || managedJdk.install;
            const javaCommand = await install({
                axios: deps.axios,
                microbotDir,
                platform: process.platform,
                arch: process.arch,
                onProgress: progress
            });
            const result = await probeJavaAsync(javaCommand);
            if (needsManagedJava(result)) {
                throw new Error(result.problem ? result.problem.message : 'The installed Java is too old.');
            }
            progress(100, 'Starting Microbot...');
            return result;
        } catch (error) {
            log.error(`Java install failed: ${error.message}`);
            showLaunchProblem({
                kind: 'java-install-failed',
                title: 'Java Could Not Be Installed',
                message: error.message,
                recovery: `Install Java ${major} (64-bit) yourself from the download page, then try again.`,
                offerDownload: true
            });
            return null;
        }
    }

    return { launch };
};

const JAVA_NEEDS_INSTALL = {
    kind: 'java-needs-install',
    title: 'Java Is Needed',
    message: 'Microbot needs Java 17 or newer, and no usable Java was found. Open the launcher and press Play once to install it.'
};

const CLOSED_DURING_STARTUP = {
    kind: 'closed-during-startup',
    title: 'Client Closed',
    message: 'The client closed while it was starting.'
};

const DEFAULT_XMS_VALUE = '512m';
const DEFAULT_XMX_VALUE = '600m';  // reduced from 1g — ZGC makes this safe to lower
const DEFAULT_CLIENT_RAM = DEFAULT_XMX_VALUE;

/**
 * GC flags injected into every client launch.
 *
 * -XX:+UseZGC
 *   Switch from G1GC to ZGC. G1GC holds committed heap pages indefinitely
 *   even when they contain only dead objects. ZGC is designed to return
 *   unused pages to the OS, so Task Manager reflects actual usage rather
 *   than the worst-case watermark.
 *
 * -XX:SoftMaxHeapSize=500m
 *   ZGC targets staying under 500 MB before expanding toward Xmx.
 *   Acts as a soft pressure valve — heap grows to 600m only under real load.
 *
 * -XX:+ZUncommit
 *   Enables ZGC's page uncommit feature. Without this flag ZGC still uses
 *   less memory than G1GC but won't actively shrink the committed footprint.
 *
 * -XX:ZUncommitDelay=30
 *   Pages idle for 30 seconds are returned to the OS. Lower values free
 *   memory faster; higher values reduce the cost of re-faulting pages back
 *   in after a brief spike.
 *
 * -XX:+UseStringDedup
 *   Deduplicates identical String objects across the heap. OSRS item names,
 *   NPC names, and chat messages frequently share the same content; this
 *   removes redundant copies automatically.
 *
 * -Xss512k
 *   Halves the per-thread stack from the default 1 MB. Microbot creates
 *   many script threads; 512 KB is ample for the call depths used.
 *
 * -XX:+IgnoreUnrecognizedVMOptions
 *   Prevents a crash if the bundled JRE is older than Java 15 and doesn't
 *   recognise ZGC flags — the client starts normally, just without the GC
 *   optimisations.
 */
const GC_FLAGS = [
    '-XX:+UseZGC',
    '-XX:SoftMaxHeapSize=500m',
    '-XX:+ZUncommit',
    '-XX:ZUncommitDelay=30',
    '-XX:+UseStringDedup',
    '-Xss512k',
    '-XX:+IgnoreUnrecognizedVMOptions',
];

function buildMemoryArgsFromRam(ramValue, log, contextLabel) {
    if (!ramValue || typeof ramValue !== 'string') {
        return null;
    }

    const parsed = normalizeRamValue(ramValue);
    if (!parsed) {
        if (contextLabel) {
            log.warn(
                `Invalid ${contextLabel} value "${ramValue}". Falling back to default memory settings.`
            );
        }
        return null;
    }

    return {
        args: [`-Xms${parsed.normalized}`, `-Xmx${parsed.normalized}`],
        normalized: parsed.normalized
    };
}

function extractRamValue(argv) {
    if (!Array.isArray(argv)) return null;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (typeof arg !== 'string') continue;

        if (arg === '--ram') {
            return argv[i + 1];
        }

        if (arg.startsWith('--ram=')) {
            return arg.slice('--ram='.length);
        }
    }

    return null;
}

function normalizeRamValue(value) {
    if (!value || typeof value !== 'string') return null;

    const trimmed = value.trim().toLowerCase();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)([mg])$/);
    if (!match) return null;

    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const unit = match[2];
    const mb = unit === 'g' ? amount * 1024 : amount;

    return { normalized: `${amount}${unit}`, mb };
}