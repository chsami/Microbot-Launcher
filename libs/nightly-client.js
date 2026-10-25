const path = require('path');
const { pipeline } = require('stream/promises');
const { isSafeClientVersion } = require('./client-jars.js');

const NIGHTLY_INFO_FILE = 'nightly.json';
const NIGHTLY_PATH = '/releases/microbot/nightly/libs/';
const NIGHTLY_FILE = /^(?:microbot|hwid-agent)-nightly-.+\.(?:jar|part)$/;
const JAR_PART = 'microbot-nightly-download.part';
const AGENT_PART = 'hwid-agent-nightly-download.part';
const LISTING_ENTRY = /<a href="microbot-([^"/]+)\.jar">[^<]*<\/a>\s+(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2})/g;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_TIMEOUTS = { request: 15000, idle: 30000, total: 15 * 60 * 1000 };
const EOCD_SEARCH_BYTES = 65557;

const MESSAGES = {
    unreachable: "Couldn't reach the nightly download server.",
    none: 'No nightly build is available right now.',
    failed: 'The nightly download failed.',
    stalled: 'The nightly download stopped responding.',
    disk: "Couldn't save the nightly build. Check that you have free disk space.",
    checkFallback: "Couldn't check for a newer nightly build. Using the one you have.",
    downloadFallback: "Couldn't download the newer nightly build. Using the one you have."
};

function nightlyError(userMessage, cause) {
    const error = new Error(cause?.message || userMessage);
    error.userMessage = userMessage;
    return error;
}

function userMessageOf(error, fallback) {
    return error?.userMessage || fallback;
}

function parseNightlyListing(html) {
    const entries = [];
    for (const match of String(html || '').matchAll(LISTING_ENTRY)) {
        const [, version, day, month, year, hour, minute] = match;
        const monthIndex = MONTHS.indexOf(month);
        if (!isSafeClientVersion(version) || monthIndex < 0) continue;
        entries.push({
            version,
            listed: Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute))
        });
    }
    return entries;
}

function compareVersions(a, b) {
    const partsA = a.split(/[.-]/).map((p) => Number(p) || 0);
    const partsB = b.split(/[.-]/).map((p) => Number(p) || 0);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const diff = (partsA[i] || 0) - (partsB[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function pickLatestNightly(entries) {
    return [...entries].sort((a, b) => b.listed - a.listed || compareVersions(b.version, a.version))[0] || null;
}

function buildFromHeaders(version, headers) {
    const lastModified = Date.parse(headers?.['last-modified']);
    let stamp = '';
    if (!Number.isNaN(lastModified)) {
        stamp = new Date(lastModified).toISOString().replace(/\D/g, '').slice(0, 14);
    } else if (headers?.etag) {
        stamp = String(headers.etag).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
    }
    if (!stamp) return null;
    return {
        build: `nightly-${version}-${stamp}`,
        etag: headers?.etag || null,
        builtAt: Number.isNaN(lastModified) ? null : new Date(lastModified).toISOString()
    };
}

function clientJarName(build) {
    return `microbot-${build}.jar`;
}

function agentJarName(build) {
    return `hwid-agent-${build}.jar`;
}

function readNightlyInfo(fs, microbotDir) {
    let info;
    try {
        info = JSON.parse(fs.readFileSync(path.join(microbotDir, NIGHTLY_INFO_FILE), 'utf8'));
    } catch (_) {
        return null;
    }
    if (
        !info ||
        typeof info.build !== 'string' ||
        !info.build.startsWith('nightly-') ||
        !isSafeClientVersion(info.build) ||
        !fs.existsSync(path.join(microbotDir, clientJarName(info.build)))
    ) {
        return null;
    }
    return {
        ...info,
        hasAgent: Boolean(info.hasAgent) && fs.existsSync(path.join(microbotDir, agentJarName(info.build)))
    };
}

function writeNightlyInfo(fs, microbotDir, info) {
    const target = path.join(microbotDir, NIGHTLY_INFO_FILE);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(info, null, 2), 'utf8');
    fs.renameSync(temp, target);
}

function isUpToDate(installed, remote) {
    return Boolean(installed) && installed.build === remote.build && (installed.hasAgent || !remote.hasAgent);
}

async function headAgent({ axios, url, timeouts }) {
    try {
        await axios.head(url, { timeout: timeouts.request });
        return true;
    } catch (error) {
        if (error?.response?.status === 404) return false;
        throw nightlyError(MESSAGES.unreachable, error);
    }
}

async function fetchLatestNightly({ axios, filestorage, timeouts = DEFAULT_TIMEOUTS }) {
    const baseUrl = `${filestorage}${NIGHTLY_PATH}`;
    let listing;
    try {
        listing = await axios.get(baseUrl, { responseType: 'text', timeout: timeouts.request });
    } catch (error) {
        throw nightlyError(MESSAGES.unreachable, error);
    }
    const latest = pickLatestNightly(parseNightlyListing(listing.data));
    if (!latest) throw nightlyError(MESSAGES.none);
    const url = `${baseUrl}microbot-${latest.version}.jar`;
    const agentUrl = `${baseUrl}hwid-agent-${latest.version}.jar`;
    let head;
    try {
        head = await axios.head(url, { timeout: timeouts.request });
    } catch (error) {
        throw nightlyError(MESSAGES.unreachable, error);
    }
    const identity = buildFromHeaders(latest.version, head.headers);
    if (!identity) throw nightlyError(MESSAGES.none, new Error(`No build id in headers for ${url}`));
    return {
        version: latest.version,
        url,
        agentUrl,
        hasAgent: await headAgent({ axios, url: agentUrl, timeouts }),
        ...identity
    };
}

function isCompleteJar(fs, file) {
    const fd = fs.openSync(file, 'r');
    try {
        const { size } = fs.fstatSync(fd);
        if (size < 22) return false;
        const head = Buffer.alloc(4);
        fs.readSync(fd, head, 0, 4, 0);
        if (head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) return false;
        const tailLength = Math.min(size, EOCD_SEARCH_BYTES);
        const tail = Buffer.alloc(tailLength);
        fs.readSync(fd, tail, 0, tailLength, size - tailLength);
        return tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) !== -1;
    } finally {
        fs.closeSync(fd);
    }
}

async function downloadToFile({ axios, fs, url, partial, timeouts, onProgress = () => {} }) {
    const controller = new AbortController();
    let failure = null;
    let idleTimer = null;
    const abort = (message) => {
        failure = failure || nightlyError(message);
        controller.abort();
    };
    const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => abort(MESSAGES.stalled), timeouts.idle);
    };
    const totalTimer = setTimeout(() => abort(MESSAGES.stalled), timeouts.total);
    try {
        armIdle();
        const response = await axios({
            method: 'get',
            url,
            responseType: 'stream',
            signal: controller.signal,
            timeout: timeouts.idle
        });
        const total = Number(response.headers?.['content-length']) || null;
        let loaded = 0;
        const stopStream = () => response.data.destroy(failure || new Error('aborted'));
        if (controller.signal.aborted) stopStream();
        controller.signal.addEventListener('abort', stopStream);
        response.data.on('data', (chunk) => {
            loaded += chunk.length;
            armIdle();
            onProgress(loaded, total);
        });
        try {
            await pipeline(response.data, fs.createWriteStream(partial));
        } catch (error) {
            if (failure) throw failure;
            if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(error?.code)) throw nightlyError(MESSAGES.disk, error);
            throw nightlyError(MESSAGES.failed, error);
        }
        if (total && loaded !== total) {
            throw nightlyError(MESSAGES.failed, new Error(`Incomplete download: ${loaded} of ${total} bytes`));
        }
        if (!isCompleteJar(fs, partial)) {
            throw nightlyError(MESSAGES.failed, new Error(`${url} is not a complete jar`));
        }
        return response.headers || {};
    } catch (error) {
        fs.rmSync(partial, { force: true });
        if (failure) throw failure;
        throw error.userMessage ? error : nightlyError(MESSAGES.failed, error);
    } finally {
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
    }
}

function sweepOldBuilds(fs, log, microbotDir, keepBuild) {
    const keep = new Set([clientJarName(keepBuild), agentJarName(keepBuild)]);
    let files;
    try {
        files = fs.readdirSync(microbotDir);
    } catch (_) {
        return;
    }
    for (const file of files) {
        if (!NIGHTLY_FILE.test(file) || keep.has(file)) continue;
        try {
            fs.rmSync(path.join(microbotDir, file), { force: true });
        } catch (error) {
            log.info(`Old nightly file ${file} is still in use: ${error.message}`);
        }
    }
}

function fallback(installed, warning, error) {
    if (installed) return { success: true, updated: false, info: installed, warning };
    return { error };
}

function installFile(fs, partial, target) {
    try {
        fs.renameSync(partial, target);
    } catch (error) {
        fs.rmSync(partial, { force: true });
        throw nightlyError(MESSAGES.disk, error);
    }
}

async function prepareNightly({ axios, fs, log, microbotDir, filestorage, progress = () => {}, timeouts = DEFAULT_TIMEOUTS }) {
    const installed = readNightlyInfo(fs, microbotDir);
    let remote;
    try {
        progress(5, 'Checking for the newest nightly build...');
        remote = await fetchLatestNightly({ axios, filestorage, timeouts });
    } catch (error) {
        log.warn(`Nightly check failed: ${error.message}`);
        return fallback(installed, MESSAGES.checkFallback, userMessageOf(error, MESSAGES.unreachable));
    }

    if (isUpToDate(installed, remote)) {
        sweepOldBuilds(fs, log, microbotDir, installed.build);
        return { success: true, updated: false, info: installed };
    }

    const sameBuild = installed?.build === remote.build;
    const jarPart = path.join(microbotDir, JAR_PART);
    const agentPart = path.join(microbotDir, AGENT_PART);
    let identity = { build: remote.build, etag: remote.etag, builtAt: remote.builtAt };
    try {
        if (!sameBuild) {
            const headers = await downloadToFile({
                axios,
                fs,
                url: remote.url,
                partial: jarPart,
                timeouts,
                onProgress: (loaded, total) => {
                    if (total) {
                        const percent = Math.min(100, (loaded * 100) / total);
                        progress(Number((10 + percent * 0.8).toFixed(2)), `Downloading the nightly build... (${percent.toFixed(0)}%)`);
                    } else {
                        progress(50, `Downloading the nightly build... (${(loaded / (1024 * 1024)).toFixed(1)} MB)`);
                    }
                }
            });
            identity = buildFromHeaders(remote.version, headers) || identity;
        }
        if (remote.hasAgent) {
            progress(92, 'Downloading the nightly build...');
            await downloadToFile({ axios, fs, url: remote.agentUrl, partial: agentPart, timeouts });
        }
        if (!sameBuild) installFile(fs, jarPart, path.join(microbotDir, clientJarName(identity.build)));
        if (remote.hasAgent) installFile(fs, agentPart, path.join(microbotDir, agentJarName(identity.build)));
    } catch (error) {
        fs.rmSync(jarPart, { force: true });
        fs.rmSync(agentPart, { force: true });
        log.error(`Nightly download failed (${remote.url}): ${error.message}`);
        return fallback(installed, MESSAGES.downloadFallback, userMessageOf(error, MESSAGES.failed));
    }

    const info = {
        ...identity,
        version: remote.version,
        hasAgent: remote.hasAgent,
        downloadedAt: new Date().toISOString()
    };
    try {
        writeNightlyInfo(fs, microbotDir, info);
    } catch (error) {
        log.error(`Failed to record the nightly download: ${error.message}`);
        return fallback(installed, MESSAGES.downloadFallback, MESSAGES.disk);
    }
    sweepOldBuilds(fs, log, microbotDir, info.build);
    progress(100, 'Completed!');
    log.info(`Installed nightly ${info.version} as ${info.build}`);
    return { success: true, updated: true, info };
}

async function nightlyStatus({ axios, fs, log, microbotDir, filestorage, checkRemote, timeouts = DEFAULT_TIMEOUTS }) {
    const installed = readNightlyInfo(fs, microbotDir);
    if (!checkRemote) return { installed };
    try {
        const latest = await fetchLatestNightly({ axios, filestorage, timeouts });
        return { installed, latest, updateAvailable: !isUpToDate(installed, latest) };
    } catch (error) {
        log.warn(`Nightly check failed: ${error.message}`);
        return { installed, error: userMessageOf(error, MESSAGES.unreachable) };
    }
}

module.exports = {
    NIGHTLY_INFO_FILE,
    MESSAGES,
    parseNightlyListing,
    pickLatestNightly,
    buildFromHeaders,
    clientJarName,
    agentJarName,
    readNightlyInfo,
    isCompleteJar,
    fetchLatestNightly,
    prepareNightly,
    nightlyStatus
};
