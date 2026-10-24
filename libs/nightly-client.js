const path = require('path');
const { isSafeClientVersion, markClientDownloaded } = require('./client-jars.js');

const NIGHTLY_VERSION = 'nightly';
const NIGHTLY_JAR = `microbot-${NIGHTLY_VERSION}.jar`;
const NIGHTLY_AGENT_JAR = `hwid-agent-${NIGHTLY_VERSION}.jar`;
const NIGHTLY_INFO_FILE = 'nightly.json';
const NIGHTLY_PATH = '/releases/microbot/nightly/libs/';
const LISTING_ENTRY = /<a href="microbot-([^"/]+)\.jar">[^<]*<\/a>\s+(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2})/g;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseNightlyListing(html) {
    const entries = [];
    for (const match of String(html || '').matchAll(LISTING_ENTRY)) {
        const [, version, day, month, year, hour, minute] = match;
        const monthIndex = MONTHS.indexOf(month);
        if (!isSafeClientVersion(version) || monthIndex < 0) continue;
        entries.push({
            version,
            modified: Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute))
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
    return [...entries].sort((a, b) => b.modified - a.modified || compareVersions(b.version, a.version))[0] || null;
}

function readNightlyInfo(fs, microbotDir) {
    if (!fs.existsSync(path.join(microbotDir, NIGHTLY_JAR))) return null;
    try {
        const info = JSON.parse(fs.readFileSync(path.join(microbotDir, NIGHTLY_INFO_FILE), 'utf8'));
        return info && typeof info.version === 'string' ? info : null;
    } catch (_) {
        return null;
    }
}

function writeNightlyInfo(fs, microbotDir, info) {
    const target = path.join(microbotDir, NIGHTLY_INFO_FILE);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(info, null, 2), 'utf8');
    fs.renameSync(temp, target);
}

function isNewerNightly(installed, remote) {
    if (!installed) return true;
    if (installed.version !== remote.version) return true;
    if (remote.etag && installed.etag) return remote.etag !== installed.etag;
    return remote.builtAt !== installed.builtAt;
}

async function fetchLatestNightly({ axios, filestorage }) {
    const baseUrl = `${filestorage}${NIGHTLY_PATH}`;
    const listing = await axios.get(baseUrl, { responseType: 'text', timeout: 15000 });
    const latest = pickLatestNightly(parseNightlyListing(listing.data));
    if (!latest) throw new Error('No nightly build is available right now.');
    const url = `${baseUrl}microbot-${latest.version}.jar`;
    const head = await axios.head(url, { timeout: 15000 });
    const lastModified = Date.parse(head.headers?.['last-modified']);
    return {
        version: latest.version,
        url,
        agentUrl: `${baseUrl}hwid-agent-${latest.version}.jar`,
        etag: head.headers?.etag || null,
        size: Number(head.headers?.['content-length']) || null,
        builtAt: new Date(Number.isNaN(lastModified) ? latest.modified : lastModified).toISOString()
    };
}

function isZip(data) {
    return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

async function downloadJar({ axios, url, onProgress }) {
    const response = await axios({
        method: 'get',
        url,
        responseType: 'arraybuffer',
        onDownloadProgress: onProgress
    });
    const data = Buffer.from(response.data);
    if (!isZip(data)) throw new Error('The downloaded file is not a valid client.');
    return data;
}

function replaceFile(fs, target, data) {
    const partial = `${target}.part`;
    try {
        fs.writeFileSync(partial, data);
        fs.renameSync(partial, target);
    } catch (error) {
        fs.rmSync(partial, { force: true });
        throw error;
    }
}

async function ensureNightlyAgent({ axios, fs, log, microbotDir, agentUrl, replace }) {
    const target = path.join(microbotDir, NIGHTLY_AGENT_JAR);
    if (!replace && fs.existsSync(target)) return;
    try {
        replaceFile(fs, target, await downloadJar({ axios, url: agentUrl }));
    } catch (error) {
        log.warn(`Nightly HWID agent not updated: ${error.message}`);
    }
}

async function prepareNightly({ axios, fs, log, microbotDir, filestorage, progress = () => {} }) {
    const installed = readNightlyInfo(fs, microbotDir);
    let remote;
    try {
        progress(5, 'Checking for the newest nightly build...');
        remote = await fetchLatestNightly({ axios, filestorage });
    } catch (error) {
        log.warn(`Nightly check failed: ${error.message}`);
        if (installed) {
            return {
                success: true,
                updated: false,
                info: installed,
                warning: 'Could not check for a newer nightly build, so the one you have was started.'
            };
        }
        return { error: `Could not download the nightly build (${error.message}).` };
    }

    if (!isNewerNightly(installed, remote)) {
        await ensureNightlyAgent({ axios, fs, log, microbotDir, agentUrl: remote.agentUrl, replace: false });
        return { success: true, updated: false, info: installed };
    }

    let jar;
    try {
        jar = await downloadJar({
            axios,
            url: remote.url,
            onProgress: (event) => {
                const total = event.total || remote.size;
                if (total) {
                    const percent = Math.min(100, (event.loaded * 100) / total);
                    progress(Number((10 + percent * 0.8).toFixed(2)), `Downloading nightly ${remote.version}... (${percent.toFixed(0)}%)`);
                } else {
                    progress(50, `Downloading nightly ${remote.version}... (${(event.loaded / (1024 * 1024)).toFixed(1)}MB)`);
                }
            }
        });
    } catch (error) {
        log.error(`Nightly download failed from ${remote.url}: ${error.message}`);
        if (installed) {
            return {
                success: true,
                updated: false,
                info: installed,
                warning: 'The newest nightly build could not be downloaded, so the one you have was started.'
            };
        }
        return { error: `Could not download the nightly build (${error.message}).` };
    }

    try {
        replaceFile(fs, path.join(microbotDir, NIGHTLY_JAR), jar);
    } catch (error) {
        log.warn(`Could not replace the nightly jar: ${error.message}`);
        if (installed) {
            return {
                success: true,
                updated: false,
                info: installed,
                warning: 'A newer nightly build is ready. Close your open nightly clients to install it.'
            };
        }
        return { error: `Could not save the nightly build (${error.message}).` };
    }

    await ensureNightlyAgent({ axios, fs, log, microbotDir, agentUrl: remote.agentUrl, replace: true });
    const info = {
        version: remote.version,
        etag: remote.etag,
        builtAt: remote.builtAt,
        downloadedAt: new Date().toISOString()
    };
    try {
        writeNightlyInfo(fs, microbotDir, info);
        markClientDownloaded(fs, microbotDir, NIGHTLY_VERSION);
    } catch (error) {
        log.error(`Failed to record the nightly download: ${error.message}`);
    }
    progress(100, 'Completed!');
    log.info(`Installed nightly ${remote.version} built ${remote.builtAt}`);
    return { success: true, updated: true, info };
}

async function nightlyStatus({ axios, fs, log, microbotDir, filestorage, checkRemote }) {
    const installed = readNightlyInfo(fs, microbotDir);
    if (!checkRemote) return { installed };
    try {
        const latest = await fetchLatestNightly({ axios, filestorage });
        return { installed, latest, updateAvailable: isNewerNightly(installed, latest) };
    } catch (error) {
        log.warn(`Nightly check failed: ${error.message}`);
        return { installed, error: error.message };
    }
}

module.exports = {
    NIGHTLY_VERSION,
    NIGHTLY_JAR,
    NIGHTLY_AGENT_JAR,
    NIGHTLY_INFO_FILE,
    parseNightlyListing,
    pickLatestNightly,
    readNightlyInfo,
    isNewerNightly,
    fetchLatestNightly,
    prepareNightly,
    nightlyStatus
};
