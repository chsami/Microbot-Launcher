const path = require('path');
const crypto = require('crypto');
const { makeFinder, launch, describeSpec } = require('./runelite-launch.js');
const setupRuneliteCharacters = require('./runelite-characters.js');

const ACCESS_PATH = '/api/loader/access';
const AGENT_PATH = '/api/loader/agent';
const ACCESS_TIMEOUT_MS = 10000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const PROBE_TIMEOUT_MS = 10000;
const JAVA_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 30000;
const INSTALL_TIMEOUT_MS = 90000;
const STATUS_TIMEOUT_MS = 20000;
const REMOVE_TIMEOUT_MS = 60000;
const MAX_AGENT_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 64 * 1024;
const MAX_SENTENCE_CHARS = 300;
const AGENT_JAVA_MAJOR = 17;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const AGENT_FILE_PATTERN = /^agent-.+\.jar(?:\..+\.part)?$/;
const TOKEN_TEXT = /mbc_[A-Za-z0-9_-]+/g;
const INSTALLED_JAR_PATTERN = /^agent(?:-[0-9a-f]{8})?\.jar$/;
const DOWNLOADED_JAR_PATTERN = /^agent-.+\.jar$/;
const AGENT_PREFIX = '-javaagent:';
const MODE_KEY = 'launcherMode';
const RUNELITE_PATH_KEY = 'runelitePath';
const MODES = ['client', 'runelite'];

const MESSAGES = {
    unavailable: 'Microbot in RuneLite is not available for your account.',
    signedOut: 'Sign in to your Microbot account first.',
    offline: "Can't reach Microbot servers. Check your connection and try again.",
    download: 'Microbot could not be downloaded. Try again in a minute.',
    damaged: 'The Microbot download was damaged. Try again in a minute.',
    java: 'Java 17 could not be set up on this PC. Try again in a minute.',
    link: 'Your Microbot account could not be linked to RuneLite. Try again in a minute.',
    install: 'Microbot could not be added to RuneLite. Try again in a minute.',
    remove: 'Microbot could not be removed from RuneLite. Try again in a minute.',
    timeout: 'This took too long. Try again in a minute.',
    busy: 'Microbot is still busy with RuneLite. Wait a moment and try again.',
    added: 'Microbot was added to RuneLite.',
    removed: 'Microbot was removed from RuneLite.',
    starting: 'RuneLite is starting. Microbot will be in the sidebar.',
    notFound: "RuneLite wasn't found on this PC. Press Find RuneLite… to choose it.",
    launchFailed: 'RuneLite could not be started. Try opening it the usual way.',
    notRuneLite: "That file can't be started. Choose RuneLite itself."
};

module.exports = function setupRuneliteLoader(deps) {
    const { ipcMain, log, fs, spawn, auth, alerts, axios, microbotDir, downloadsDir, agentJar, settingsFile } = deps;
    const javaRuntime = deps.javaRuntime || require('./java-runtime.js');
    const managedJdk = deps.managedJdk || require('./managed-jdk.js');
    const platform = deps.platform || process.platform;
    const arch = deps.arch || process.arch;
    const getWindow = deps.getWindow || (() => null);
    const env = deps.env || process.env;
    const home = deps.home || require('os').homedir();
    const dialog = deps.dialog || null;
    const finder = deps.finder || makeFinder({ fs, platform, env, home });

    let operation = null;
    let progressText = '';

    const sendProgress = (text) => {
        progressText = text;
        try {
            const win = getWindow();
            if (win && !win.isDestroyed()) win.webContents.send('runelite-loader:progress', { text });
        } catch (error) {
            log.warn(`Could not show RuneLite progress: ${error?.message || error}`);
        }
    };

    const readSettings = () => {
        try {
            if (!settingsFile || !fs.existsSync(settingsFile)) return {};
            const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
        } catch (error) {
            log.warn(`Could not read launcher settings: ${error?.message || error}`);
            return null;
        }
    };

    const readMode = () => (readSettings()?.[MODE_KEY] === 'runelite' ? 'runelite' : 'client');

    const writeSetting = (key, value) => {
        if (!settingsFile) return false;
        const current = readSettings();
        if (!current) {
            log.warn(`Launcher settings could not be read, so ${key} was not saved.`);
            return false;
        }
        fs.writeFileSync(settingsFile, JSON.stringify({ ...current, [key]: value }, null, 2));
        return true;
    };

    const writeMode = (mode) => writeSetting(MODE_KEY, mode);

    const characters = setupRuneliteCharacters({
        fs,
        log,
        microbotDir,
        home,
        readSetting: (key) => readSettings()?.[key],
        writeSetting,
        checkSession: deps.checkSession,
        sessionTimeoutMs: deps.sessionTimeoutMs
    });

    const rememberedRuneLite = () => {
        const value = readSettings()?.[RUNELITE_PATH_KEY];
        return typeof value === 'string' ? value : null;
    };

    const runeliteInfo = () => {
        const spec = findRuneLite();
        return spec ? { opener: 'open', starts: describeSpec(spec, home) } : { opener: 'find' };
    };

    const findRuneLite = () => {
        try {
            return finder.find(rememberedRuneLite());
        } catch (error) {
            log.warn(`Could not look for RuneLite: ${error?.message || error}`);
            return null;
        }
    };

    const fallBackToClient = (access) => {
        if (access.reason === 'unreachable' || readMode() !== 'runelite') return;
        try {
            if (writeMode('client')) log.info('Microbot in RuneLite is not available for this account; showing the Microbot client.');
        } catch (error) {
            log.warn(`Could not save the launcher view: ${error?.message || error}`);
        }
    };

    const signedIn = () => {
        try {
            return Boolean(auth?.email());
        } catch (error) {
            return false;
        }
    };

    const checkAccess = async () => {
        if (!auth || !signedIn()) return { available: false, reason: 'signed-out' };
        try {
            const { data } = await auth.request({ method: 'get', path: ACCESS_PATH, timeout: ACCESS_TIMEOUT_MS });
            if (data?.available !== true) {
                return { available: false, reason: typeof data?.reason === 'string' ? data.reason : 'unavailable' };
            }
            const agent = parseAgent(data.agent);
            if (!agent) {
                log.warn('The Microbot API sent an agent release the launcher cannot use.');
                return { available: false, reason: 'invalid-release' };
            }
            return { available: true, agent };
        } catch (error) {
            const status = error?.response?.status;
            if (status === 401) return { available: false, reason: 'signed-out' };
            if (status === 403 || status === 404) return { available: false, reason: 'unavailable' };
            log.warn(`Could not check Microbot in RuneLite access: ${error?.message || error}`);
            return { available: false, reason: 'unreachable' };
        }
    };

    const agentPath = (agent) => path.join(downloadsDir, `agent-${agent.version}.jar`);

    const fileMatches = (file, agent) => {
        try {
            if (!fs.existsSync(file) || fs.statSync(file).size !== agent.size) return false;
            return sha256(fs.readFileSync(file)) === agent.sha256;
        } catch (error) {
            return false;
        }
    };

    const removeFile = (file) => {
        try {
            fs.rmSync(file, { force: true });
        } catch (error) {
            log.warn(`Could not delete ${path.basename(file)}: ${error?.message || error}`);
        }
    };

    const downloadAgent = async (agent) => {
        const target = agentPath(agent);
        if (fileMatches(target, agent)) return target;
        removeFile(target);
        fs.mkdirSync(downloadsDir, { recursive: true });
        let response;
        try {
            response = await auth.request({
                method: 'get',
                path: agent.path,
                responseType: 'arraybuffer',
                timeout: DOWNLOAD_TIMEOUT_MS,
                maxContentLength: agent.size + 1
            });
        } catch (error) {
            const status = error?.response?.status;
            if (status === 401) throw failure(MESSAGES.signedOut);
            if (status === 403 || status === 404) throw failure(MESSAGES.unavailable);
            if (/maxContentLength/i.test(String(error?.message))) {
                log.warn(`The Microbot agent ${agent.version} download was larger than its release (${agent.size} bytes); stopped it.`);
                throw failure(MESSAGES.damaged);
            }
            log.warn(`Could not download the Microbot agent ${agent.version}: ${error?.message || error}`);
            throw failure(error?.response ? MESSAGES.download : MESSAGES.offline);
        }
        const data = Buffer.from(response.data || []);
        const header = response.headers?.['x-content-sha256'];
        const temp = `${target}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.part`;
        try {
            fs.writeFileSync(temp, data);
            const sizeOk = fs.statSync(temp).size === agent.size;
            const digest = sha256(fs.readFileSync(temp));
            const headerOk = !header || String(header).trim().toLowerCase() === agent.sha256;
            if (!sizeOk || digest !== agent.sha256 || !headerOk) {
                log.warn(`The Microbot agent ${agent.version} download did not match its release (size ${data.length}, expected ${agent.size}); deleted it.`);
                throw failure(MESSAGES.damaged);
            }
            fs.renameSync(temp, target);
        } finally {
            removeFile(temp);
        }
        log.info(`Downloaded the Microbot agent ${agent.version}.`);
        return target;
    };

    const cleanDownloads = (keep) => {
        try {
            if (!fs.existsSync(downloadsDir)) return;
            fs.readdirSync(downloadsDir)
                .filter((name) => AGENT_FILE_PATTERN.test(name) && name !== path.basename(keep))
                .forEach((name) => removeFile(path.join(downloadsDir, name)));
        } catch (error) {
            log.warn(`Could not clean old Microbot agent downloads: ${error?.message || error}`);
        }
    };

    const probeJava = (command) =>
        new Promise((resolve) => {
            let output = '';
            let done = false;
            let child;
            const finish = (major) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(major);
            };
            const timer = setTimeout(() => {
                try {
                    child?.kill();
                } catch (_) {}
                finish(null);
            }, PROBE_TIMEOUT_MS);
            try {
                child = spawn(command, javaRuntime.PROBE_ARGS, { windowsHide: true });
            } catch (error) {
                finish(null);
                return;
            }
            const collect = (chunk) => {
                if (output.length < MAX_OUTPUT_CHARS) output += chunk.toString();
            };
            child.stdout?.on('data', collect);
            child.stderr?.on('data', collect);
            child.on('error', () => finish(null));
            child.on('close', (code) => finish(code === 0 ? javaRuntime.parseJavaSettings(output).major : null));
        });

    const findJava = async ({ install }) => {
        const managed = managedJdk.javaPath(microbotDir, platform);
        if (fs.existsSync(managed) && (await probeJava(managed)) >= AGENT_JAVA_MAJOR) return managed;
        if ((await probeJava('java')) >= AGENT_JAVA_MAJOR) return 'java';
        if (!install) return null;
        sendProgress('Downloading Java 17 (about 190 MB)...');
        let installed;
        try {
            installed = await withTimeout(
                managedJdk.install({
                    axios,
                    microbotDir,
                    platform,
                    arch,
                    onProgress: (percent, text) => sendProgress(percent > 0 ? `${text} ${percent}%` : text)
                }),
                JAVA_INSTALL_TIMEOUT_MS
            );
        } catch (error) {
            log.warn(`Could not install Java 17 for Microbot in RuneLite: ${error?.message || error}`);
            throw failure(error?.timedOut ? MESSAGES.timeout : MESSAGES.java);
        }
        if ((await probeJava(installed)) >= AGENT_JAVA_MAJOR) return installed;
        throw failure(MESSAGES.java);
    };

    const runAgent = (java, jar, args, { timeoutMs, input = null, secrets = [] }) =>
        new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let done = false;
            let child;
            const finish = (result) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve({ stdout: clean(stdout, secrets), stderr: clean(stderr, secrets), ...result });
            };
            const timer = setTimeout(() => {
                try {
                    child?.kill();
                } catch (_) {}
                finish({ code: null, timedOut: true });
            }, timeoutMs);
            try {
                child = spawn(java, ['-jar', jar, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
            } catch (error) {
                finish({ code: null, error });
                return;
            }
            child.stdout?.on('data', (chunk) => {
                if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString();
            });
            child.stderr?.on('data', (chunk) => {
                if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString();
            });
            child.on('error', (error) => finish({ code: null, error }));
            child.on('close', (code) => finish({ code }));
            child.stdin?.on('error', () => {});
            child.stdin?.end(input === null ? '' : `${input}\n`);
        });

    const describeRun = (result, action) => {
        if (result.timedOut) return `${action} timed out`;
        if (result.error) return `${action} could not start: ${result.error.message}`;
        return `${action} exited with code ${result.code}`;
    };

    const readStatus = async (java, jar) => {
        const result = await runAgent(java, jar, ['--status', '--json'], { timeoutMs: STATUS_TIMEOUT_MS });
        const status = result.code === 0 ? parseStatus(result.stdout) : null;
        if (!status) log.warn(`Could not read whether Microbot is in RuneLite: ${describeRun(result, 'the status check')}`);
        return status;
    };

    const loaderHome = agentJar ? path.dirname(agentJar) : null;

    const listJars = (directory, pattern) => {
        try {
            if (!directory || !fs.existsSync(directory)) return [];
            return fs
                .readdirSync(directory)
                .filter((name) => pattern.test(name))
                .map((name) => path.join(directory, name))
                .filter((file) => fs.statSync(file).isFile())
                .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        } catch (error) {
            return [];
        }
    };

    const localJars = () => {
        const installed = agentJar && fs.existsSync(agentJar) ? [agentJar] : [];
        const sideBySide = listJars(loaderHome, INSTALLED_JAR_PATTERN).filter((file) => file !== agentJar);
        return [...installed, ...sideBySide, ...listJars(downloadsDir, DOWNLOADED_JAR_PATTERN)];
    };

    const statusJar = (agent) => {
        if (agent && fileMatches(agentPath(agent), agent)) return agentPath(agent);
        return localJars()[0] || null;
    };

    const isOurLine = (argument) => {
        if (typeof argument !== 'string' || !argument.startsWith(AGENT_PREFIX)) return false;
        const normalized = lineJarPath(argument).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
        const slash = normalized.lastIndexOf('/');
        const name = normalized.slice(slash + 1);
        if (name.startsWith('microbot-agent')) return true;
        if (!INSTALLED_JAR_PATTERN.test(name)) return false;
        const directory = slash < 0 ? '' : normalized.slice(0, slash);
        const home = loaderHome ? loaderHome.replace(/\\/g, '/').toLowerCase() : null;
        return directory.endsWith('/.microbot/loader') || directory === home;
    };

    const lineJar = (status) => {
        if (!status?.settingsPath) return null;
        try {
            const settings = JSON.parse(fs.readFileSync(status.settingsPath, 'utf8'));
            const lines = Array.isArray(settings?.jvmArguments) ? settings.jvmArguments : [];
            const jar = lines.filter(isOurLine).map(lineJarPath).find((file) => fs.existsSync(file));
            return jar || null;
        } catch (error) {
            log.warn(`Could not read RuneLite's settings to find the Microbot agent: ${error?.message || error}`);
            return null;
        }
    };

    const currentStatus = async (agent) => {
        const jar = statusJar(agent);
        if (!jar) return null;
        const java = await findJava({ install: false });
        return java ? readStatus(java, jar) : null;
    };

    const viewFor = (access, status) => {
        if (operation) return { visible: true, state: 'working', progress: progressText, mode: readMode() };
        if (access.available) return { ...cardFor(access, status), mode: readMode() };
        if (status?.installed) return { visible: true, state: 'remove-only', mode: 'runelite' };
        fallBackToClient(access);
        return { visible: false };
    };

    const cardFor = (access, status) => {
        const version = access.agent.version;
        if (!status?.installed) return { visible: true, state: 'not-added', version };
        if (status.agentSha256 !== access.agent.sha256) return { visible: true, state: 'update', reason: 'new-version', version };
        if (status.enabled === false) return { visible: true, state: 'switched-off', ...runeliteInfo(), version };
        if (status.willLoad === false) return { visible: true, state: 'update', reason: 'not-loading', version };
        if (status.signedIn === false || status.lastStart?.code === 'signed-out') return { visible: true, state: 'update', reason: 'signed-out', version };
        if (status.lastStart?.code === 'not-ready') return { visible: true, state: 'added', note: 'not-ready', ...runeliteInfo(), version };
        return { visible: true, state: 'added', ...runeliteInfo(), version };
    };

    const state = async () => {
        const access = await checkAccess();
        if (operation || !(access.available || access.reason === 'unreachable')) return viewFor(access, null);
        return viewFor(access, await currentStatus(access.available ? access.agent : null));
    };

    const ensureUnchanged = (jar, agent) => {
        if (fileMatches(jar, agent)) return;
        log.warn(`The Microbot agent ${agent.version} changed on disk after it was checked; deleted it.`);
        removeFile(jar);
        throw failure(MESSAGES.damaged);
    };

    const obtainToken = async () => {
        if (!alerts?.tokenForLoader) throw failure(MESSAGES.link);
        try {
            return await withTimeout(alerts.tokenForLoader(), TOKEN_TIMEOUT_MS);
        } catch (error) {
            if (error?.response?.status === 401) throw failure(MESSAGES.signedOut);
            log.warn(`Could not link Microbot in RuneLite to the Microbot account: ${error?.message || 'unknown error'}`);
            throw failure(error?.timedOut ? MESSAGES.timeout : error?.response ? MESSAGES.link : MESSAGES.offline);
        }
    };

    const installNow = async () => {
        sendProgress('Checking your Microbot account...');
        const access = await checkAccess();
        if (!access.available) {
            throw failure(access.reason === 'signed-out' ? MESSAGES.signedOut : access.reason === 'unreachable' ? MESSAGES.offline : MESSAGES.unavailable);
        }
        sendProgress('Downloading Microbot...');
        const jar = await downloadAgent(access.agent);
        sendProgress('Checking Java...');
        const java = await findJava({ install: true });
        sendProgress('Linking your Microbot account...');
        const token = await obtainToken();
        sendProgress('Adding Microbot to RuneLite...');
        ensureUnchanged(jar, access.agent);
        const result = await runAgent(java, jar, ['--install', '--token-stdin'], {
            timeoutMs: INSTALL_TIMEOUT_MS,
            input: token,
            secrets: [token]
        });
        if (result.code !== 0) {
            log.warn(`Adding Microbot to RuneLite failed: ${describeRun(result, 'the install')}`);
            throw failure(result.timedOut ? MESSAGES.timeout : sentence(result.stderr) || MESSAGES.install);
        }
        log.info(`Added Microbot ${access.agent.version} to RuneLite.`);
        cleanDownloads(jar);
        const message = sentence(result.stdout) || MESSAGES.added;
        const status = await readStatus(java, jar);
        return { access, status: status || { installed: true, agentSha256: access.agent.sha256, signedIn: true }, message };
    };

    const removeNow = async () => {
        sendProgress('Removing Microbot from RuneLite...');
        const access = await checkAccess();
        const agent = access.available ? access.agent : null;
        let jar = statusJar(agent);
        if (!jar && agent) jar = await downloadAgent(agent);
        if (!jar) throw failure(access.reason === 'unreachable' ? MESSAGES.offline : MESSAGES.remove);
        const java = await findJava({ install: true });
        if (agent && jar === agentPath(agent)) {
            ensureUnchanged(jar, agent);
        } else if (!agent) {
            const named = lineJar(await readStatus(java, jar));
            jar = named || (agentJar && fs.existsSync(agentJar) ? agentJar : jar);
        }
        sendProgress('Removing Microbot from RuneLite...');
        const result = await runAgent(java, jar, ['--remove'], { timeoutMs: REMOVE_TIMEOUT_MS });
        if (result.code !== 0) {
            log.warn(`Removing Microbot from RuneLite failed: ${describeRun(result, 'the removal')}`);
            throw failure(result.timedOut ? MESSAGES.timeout : sentence(result.stderr) || MESSAGES.remove);
        }
        log.info('Removed Microbot from RuneLite.');
        try {
            await alerts?.forgetLoaderToken?.();
        } catch (error) {
            log.warn(`Could not unlink Microbot in RuneLite from the dashboard: ${error?.message || error}`);
        }
        const message = sentence(result.stdout) || MESSAGES.removed;
        if (!access.available) return { access, status: null, message };
        return { access, status: (await readStatus(java, jar)) || { installed: false }, message };
    };

    const run = (kind, work) => {
        if (operation) {
            if (operation.kind === kind) return operation.promise;
            return Promise.resolve({ visible: true, state: 'working', progress: progressText, mode: readMode(), error: MESSAGES.busy });
        }
        const promise = (async () => {
            try {
                const { access, status, message } = await work();
                operation = null;
                return { ...viewFor(access, status), message };
            } catch (error) {
                operation = null;
                if (!error?.memberMessage) log.warn(`Microbot in RuneLite failed: ${error?.message || error}`);
                const view = await state().catch(() => ({ visible: false }));
                return { ...view, error: error?.memberMessage || MESSAGES[kind] };
            } finally {
                operation = null;
                progressText = '';
            }
        })();
        operation = { kind, promise };
        return promise;
    };

    const startRuneLite = async (spec) => {
        const result = await launch({
            spawn,
            spec,
            env,
            platform,
            home,
            onEarlyExit: ({ code, signal, seconds }) =>
                log.warn(`RuneLite (${spec.source}) closed ${seconds.toFixed(1)} s after starting, exit code ${code === null ? 'none' : code}${signal ? `, signal ${signal}` : ''}.`)
        });
        if (result.ok) {
            log.info(`Started RuneLite (${spec.source}).`);
            return { ok: true, message: MESSAGES.starting };
        }
        const code = typeof result.error?.code === 'string' && /^[A-Z0-9_]{2,32}$/.test(result.error.code) ? result.error.code : 'unknown';
        log.warn(`Could not start RuneLite (${spec.source}): error code ${code}.`);
        return { ok: false, error: MESSAGES.launchFailed };
    };

    let opening = null;

    const once = (work) => {
        if (!opening) {
            opening = work().finally(() => {
                opening = null;
            });
        }
        return opening;
    };

    const openRuneLite = () =>
        once(async () => {
            const spec = findRuneLite();
            if (!spec) return { ok: false, opener: 'find', error: MESSAGES.notFound };
            const login = await characters.prepare();
            if (!login.ok) return login;
            return startRuneLite(spec);
        });

    const pickerOptions = () => {
        const options = { title: 'Find RuneLite', buttonLabel: 'Open RuneLite', properties: ['openFile'] };
        if (platform === 'win32') options.filters = [{ name: 'RuneLite', extensions: ['exe'] }];
        if (platform === 'darwin') options.filters = [{ name: 'RuneLite', extensions: ['app'] }];
        return options;
    };

    const findAndOpen = () =>
        once(async () => {
            if (!dialog) return { ok: false, opener: 'find', error: MESSAGES.notFound };
            const win = getWindow();
            const parent = win && !win.isDestroyed() ? win : undefined;
            const { canceled, filePaths } = parent ? await dialog.showOpenDialog(parent, pickerOptions()) : await dialog.showOpenDialog(pickerOptions());
            if (canceled || !Array.isArray(filePaths) || !filePaths.length) return { cancelled: true };
            const spec = finder.fromPath(filePaths[0]);
            if (!spec) return { ok: false, opener: 'find', error: MESSAGES.notRuneLite };
            try {
                writeSetting(RUNELITE_PATH_KEY, filePaths[0]);
            } catch (error) {
                log.warn(`Could not remember where RuneLite is: ${error?.message || error}`);
            }
            const login = await characters.prepare();
            const started = login.ok ? await startRuneLite(spec) : login;
            return { ...started, opener: 'open', starts: describeSpec(spec, home) };
        });

    const install = () => run('install', installNow);
    const remove = () => run('remove', removeNow);

    ipcMain.handle('runelite-loader:state', async () => {
        try {
            return await state();
        } catch (error) {
            log.warn(`Could not check Microbot in RuneLite: ${error?.message || error}`);
            return { visible: false };
        }
    });
    ipcMain.handle('runelite-loader:install', () => install());
    ipcMain.handle('runelite-loader:open', () => openRuneLite());
    ipcMain.handle('runelite-loader:find', () => findAndOpen());
    ipcMain.handle('runelite-loader:set-mode', async (_event, mode) => {
        if (!MODES.includes(mode)) return { error: 'Unknown view.', mode: readMode() };
        try {
            if (!writeMode(mode)) return { error: 'Could not save the setting.', mode };
        } catch (error) {
            log.warn(`Could not save the launcher view: ${error?.message || error}`);
            return { error: 'Could not save the setting.', mode: readMode() };
        }
        return { mode: readMode() };
    });
    ipcMain.handle('runelite-loader:remove', () => remove());
    ipcMain.handle('runelite-loader:characters', () => characters.list());
    ipcMain.handle('runelite-loader:set-character', (_event, accountId) => characters.choose(accountId));

    const javaForTools = () => findJava({ install: true });

    const installedAgentJar = async () => {
        const status = await currentStatus(null);
        return status?.enabled === false ? null : lineJar(status);
    };

    return {
        state,
        install,
        remove,
        checkAccess,
        mode: readMode,
        openRuneLite,
        findAndOpen,
        javaForTools,
        installedAgentJar,
        prepareCharacter: characters.prepare,
        readSetting: (key) => readSettings()?.[key],
        writeSetting
    };
};

function parseAgent(agent) {
    if (!agent || typeof agent !== 'object') return null;
    const version = String(agent.version ?? '');
    const sha = String(agent.sha256 ?? '').trim().toLowerCase();
    const size = Number(agent.size);
    const url = agent.url === undefined || agent.url === null ? AGENT_PATH : String(agent.url);
    if (!VERSION_PATTERN.test(version) || !SHA_PATTERN.test(sha)) return null;
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_AGENT_BYTES) return null;
    if (!/^\/(?![/\\])[^\s\\]*$/.test(url)) return null;
    return { version, sha256: sha, size, path: url };
}

function parseStatus(stdout) {
    const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of [String(stdout || '').trim(), ...lines.reverse()]) {
        if (!line.startsWith('{')) continue;
        try {
            const value = JSON.parse(line);
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            return {
                installed: value.installed === true,
                settingsPath: typeof value.settingsPath === 'string' ? value.settingsPath : null,
                launchMode: typeof value.launchMode === 'string' ? value.launchMode : null,
                signedIn: typeof value.signedIn === 'boolean' ? value.signedIn : null,
                agentVersion: typeof value.agentVersion === 'string' ? value.agentVersion : null,
                agentSha256: typeof value.agentSha256 === 'string' ? value.agentSha256.trim().toLowerCase() : null,
                willLoad: typeof value.willLoad === 'boolean' ? value.willLoad : null,
                enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
                lastStart: parseLastStart(value.lastStart)
            };
        } catch (_) {}
    }
    return null;
}

function parseLastStart(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
        code: typeof value.code === 'string' ? value.code.trim().toLowerCase() : null,
        at: typeof value.at === 'string' ? value.at : null,
        message: typeof value.message === 'string' ? value.message : null
    };
}

function lineJarPath(argument) {
    const value = argument.slice(AGENT_PREFIX.length);
    const options = value.indexOf('=');
    return options >= 0 ? value.slice(0, options) : value;
}

function sentence(text) {
    const line = String(text || '')
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .pop();
    if (!line) return '';
    return line.length > MAX_SENTENCE_CHARS ? `${line.slice(0, MAX_SENTENCE_CHARS - 1)}…` : line;
}

function clean(text, secrets) {
    let result = String(text || '');
    secrets.filter(Boolean).forEach((secret) => {
        result = result.split(secret).join('***');
    });
    return result.replace(TOKEN_TEXT, '***');
}

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function failure(memberMessage) {
    return Object.assign(new Error(memberMessage), { memberMessage });
}

function withTimeout(promise, ms) {
    let timer = null;
    const deadline = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { timedOut: true })), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

module.exports.parseAgent = parseAgent;
module.exports.parseStatus = parseStatus;
module.exports.sentence = sentence;
module.exports.MESSAGES = MESSAGES;
