const path = require('path');
const crypto = require('crypto');

const INFO_PATH = '/api/loader/recorder/info';
const SETTING_KEY = 'sessionRecorder';
const STATUS_PREFIX = '@session-recorder ';
const INFO_TIMEOUT_MS = 10000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_JAR_BYTES = 512 * 1024 * 1024;
const MAX_TEXT = 300;
const VERSION_PATTERN = /^[0-9]{1,6}(\.[0-9]{1,6}){1,3}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;

const MESSAGES = {
    starting: 'Starting the Session Recorder...',
    download: 'The Session Recorder could not be downloaded. Try again in a minute.',
    damaged: 'The Session Recorder download was damaged. Try again in a minute.',
    java: 'Java 17 could not be set up on this PC. Try again in a minute.',
    start: 'The Session Recorder could not start. Try again in a minute.',
    stopped: 'The Session Recorder stopped. Turn it off and on to start it again.',
    notRunning: 'Turn the Session Recorder on first.',
    opening: 'RuneLite is starting through the Session Recorder.'
};

module.exports = function setupSessionRecorder(deps) {
    const { ipcMain, log, fs, spawn, auth, runelite, directory } = deps;
    const getWindow = deps.getWindow || (() => null);

    let child = null;
    let status = null;
    let error = '';
    let starting = null;

    const isOn = () => runelite.readSetting(SETTING_KEY) === true;

    const push = () => {
        try {
            const win = getWindow();
            if (win && !win.isDestroyed()) win.webContents.send('session-recorder:status', view(true));
        } catch (e) {
            log.warn(`Could not show the Session Recorder status: ${e?.message || e}`);
        }
    };

    const view = (visible) => {
        if (!visible) return { visible: false };
        return {
            visible: true,
            on: isOn(),
            running: Boolean(child) && status?.state === 'ready',
            message: error || status?.error || status?.message || (isOn() ? MESSAGES.starting : '')
        };
    };

    const fetchInfo = async () => {
        try {
            if (!auth?.email?.()) return null;
            const { data } = await auth.request({ method: 'get', path: INFO_PATH, timeout: INFO_TIMEOUT_MS });
            return parseInfo(data);
        } catch (e) {
            const code = e?.response?.status;
            if (code !== 401 && code !== 403 && code !== 404) log.warn(`Could not check the Session Recorder: ${e?.message || e}`);
            return null;
        }
    };

    const jarPath = (info) => path.join(directory, `session-recorder-${info.version}.jar`);

    const matches = (file, info) => {
        try {
            return fs.existsSync(file) && fs.statSync(file).size === info.size && sha256(fs.readFileSync(file)) === info.sha256;
        } catch (e) {
            return false;
        }
    };

    const download = async (info) => {
        const target = jarPath(info);
        if (matches(target, info)) return target;
        fs.mkdirSync(directory, { recursive: true });
        let response;
        try {
            response = await auth.request({
                method: 'get',
                path: info.url,
                responseType: 'arraybuffer',
                timeout: DOWNLOAD_TIMEOUT_MS,
                maxContentLength: info.size + 1
            });
        } catch (e) {
            log.warn(`Could not download the Session Recorder ${info.version}: ${e?.message || e}`);
            throw failure(MESSAGES.download);
        }
        const data = Buffer.from(response.data || []);
        if (data.length !== info.size || sha256(data) !== info.sha256) {
            log.warn(`The Session Recorder ${info.version} download did not match (size ${data.length}, expected ${info.size}).`);
            throw failure(MESSAGES.damaged);
        }
        const temp = `${target}.${process.pid}.part`;
        fs.writeFileSync(temp, data);
        fs.renameSync(temp, target);
        fs.readdirSync(directory)
            .filter((name) => /^session-recorder-.+\.jar$/.test(name) && name !== path.basename(target))
            .forEach((name) => fs.rmSync(path.join(directory, name), { force: true }));
        log.info(`Downloaded the Session Recorder ${info.version}.`);
        return target;
    };

    const onLine = (line) => {
        if (!line.startsWith(STATUS_PREFIX)) return;
        const next = parseStatus(line.slice(STATUS_PREFIX.length));
        if (!next) return;
        status = next;
        error = '';
        push();
    };

    const startNow = async () => {
        const info = await fetchInfo();
        if (!info) return;
        error = '';
        status = null;
        push();
        try {
            const jar = await download(info);
            let java;
            try {
                java = await runelite.javaForTools();
            } catch (e) {
                throw failure(MESSAGES.java);
            }
            const agent = await runelite.installedAgentJar().catch(() => null);
            if (!isOn() || child) return;
            const args = ['-jar', jar, ...(agent ? ['--agent', agent] : [])];
            const proc = spawn(java, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
            child = proc;
            let buffered = '';
            proc.stdout?.on('data', (chunk) => {
                buffered += chunk.toString();
                const lines = buffered.split(/\r?\n/);
                buffered = lines.pop();
                lines.forEach(onLine);
            });
            proc.stderr?.on('data', () => {});
            proc.stdin?.on('error', () => {});
            proc.on('error', (e) => {
                log.warn(`The Session Recorder could not start: ${e?.message || e}`);
            });
            proc.on('close', (code) => {
                if (child !== proc) return;
                child = null;
                if (status?.state !== 'stopped') {
                    log.warn(`The Session Recorder exited with code ${code}.`);
                    if (isOn()) error = MESSAGES.stopped;
                }
                push();
            });
            log.info(`Started the Session Recorder ${info.version}${agent ? ' with Microbot' : ''}.`);
        } catch (e) {
            error = e?.memberMessage || MESSAGES.start;
            if (!e?.memberMessage) log.warn(`The Session Recorder could not start: ${e?.message || e}`);
        }
        push();
    };

    const start = () => {
        if (child || starting) return starting;
        starting = startNow().finally(() => {
            starting = null;
        });
        return starting;
    };

    const stop = () => {
        error = '';
        if (child?.stdin?.writable) child.stdin.write('stop\n');
        push();
    };

    const state = async () => {
        const info = await fetchInfo();
        if (!info) return view(false);
        if (isOn() && !child && !error) start();
        return view(true);
    };

    const setOn = async (on) => {
        if (!(await fetchInfo())) return view(false);
        runelite.writeSetting(SETTING_KEY, on === true);
        if (on === true) start();
        else stop();
        return view(true);
    };

    const open = () => {
        if (!child || status?.state !== 'ready' || !child.stdin?.writable) return { ok: false, error: MESSAGES.notRunning };
        child.stdin.write('open\n');
        return { ok: true, message: MESSAGES.opening };
    };

    ipcMain.handle('session-recorder:state', () => state());
    ipcMain.handle('session-recorder:set-on', (_event, on) => setOn(on));
    ipcMain.handle('session-recorder:open', () => open());

    return { state, setOn, open };
};

function parseInfo(data) {
    if (!data || typeof data !== 'object') return null;
    const version = String(data.version ?? '');
    const sha = String(data.sha256 ?? '').toLowerCase();
    const size = Number(data.size);
    const url = String(data.url ?? '');
    if (!VERSION_PATTERN.test(version) || !SHA_PATTERN.test(sha)) return null;
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_JAR_BYTES) return null;
    if (!/^\/api\/loader\/[a-z/]+$/.test(url)) return null;
    return { version, sha256: sha, size, url };
}

function parseStatus(text) {
    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || typeof value.state !== 'string') return null;
        return {
            state: value.state,
            message: short(value.message),
            error: short(value.error),
            recording: Number.isSafeInteger(value.recording) ? value.recording : 0,
            unrecorded: Number.isSafeInteger(value.unrecorded) ? value.unrecorded : 0
        };
    } catch (_) {
        return null;
    }
}

function short(text) {
    if (typeof text !== 'string') return '';
    const line = text.trim();
    return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1)}…` : line;
}

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function failure(memberMessage) {
    return Object.assign(new Error(memberMessage), { memberMessage });
}

module.exports.parseInfo = parseInfo;
module.exports.parseStatus = parseStatus;
module.exports.STATUS_PREFIX = STATUS_PREFIX;
