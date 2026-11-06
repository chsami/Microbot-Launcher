const path = require('path');
const { isSafeClientVersion } = require('./client-jars.js');

const hwidAgentFile = 'hwid-agent-<version>.jar';
const HWID_SPOOF_PROPERTY = 'hwid_spoof';
const LAUNCHER_DISABLED_ARG = '-Dmicrobot.hwid.launcherDisabled=true';
const SPOOF_ENABLED_ARG = '-Dmicrobot.hwid.spoof=true';
const PROPERTIES_FILE = 'resource_versions.json';
const EARLIER_RUN_FILES = [PROPERTIES_FILE, 'accounts.json'];
const CLIENT_JAR = /^microbot-.+\.jar$/;

async function ensureHwidAgentJar({ axios, fs, log, microbotDir, filestorage, version }) {
    if (!isSafeClientVersion(version)) return null;
    const candidate = hwidAgentFile.replace('<version>', version);
    const jarPath = path.join(microbotDir, candidate);
    if (fs.existsSync(jarPath)) return jarPath;
    const url = `${filestorage}/releases/microbot/stable/${candidate}`;
    const partialPath = `${jarPath}.part`;
    try {
        const response = await axios({ method: 'get', url, responseType: 'arraybuffer' });
        const data = Buffer.from(response.data);
        if (!isZip(data)) throw new Error('downloaded file is not a jar');
        fs.writeFileSync(partialPath, data);
        fs.renameSync(partialPath, jarPath);
        log.info(`Downloaded HWID agent ${candidate}`);
        return jarPath;
    } catch (error) {
        try {
            fs.rmSync(partialPath, { force: true });
        } catch (_) {}
        log.warn(`HWID agent not available (${version}): ${error.message}`);
        return null;
    }
}

function isZip(data) {
    return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

function hwidAgentJarPath({ fs, microbotDir, version }) {
    if (!isSafeClientVersion(version)) return null;
    const candidate = hwidAgentFile.replace('<version>', version);
    const jarPath = path.join(microbotDir, candidate);
    return fs.existsSync(jarPath) ? jarPath : null;
}

// Opt-in: only an explicit on turns spoofing on.
function isHwidSpoofEnabled(value) {
    return value === true || value === 'true';
}

function hwidAgentArgs({ fs, microbotDir, version, enabled }) {
    if (!isHwidSpoofEnabled(enabled)) return [LAUNCHER_DISABLED_ARG];
    const agentJar = hwidAgentJarPath({ fs, microbotDir, version });
    return agentJar ? [`-javaagent:${agentJar}`, SPOOF_ENABLED_ARG] : [];
}

function isExistingInstall({ fs, microbotDir }) {
    if (EARLIER_RUN_FILES.some((name) => fs.existsSync(path.join(microbotDir, name)))) return true;
    try {
        return fs.readdirSync(microbotDir).some((name) => CLIENT_JAR.test(name));
    } catch (_) {
        return false;
    }
}

function settleHwidSpoofChoice({ fs, log, microbotDir, defaults = {} }) {
    const file = path.join(microbotDir, PROPERTIES_FILE);
    let properties = null;
    if (fs.existsSync(file)) {
        let problem = null;
        try {
            properties = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
                problem = 'it is not a settings object';
            }
        } catch (error) {
            problem = error.message;
        }
        if (problem) return replaceUnreadableSettings({ fs, log, file, defaults, problem });
        if (properties[HWID_SPOOF_PROPERTY] !== undefined) return properties[HWID_SPOOF_PROPERTY];
    }
    const value = isExistingInstall({ fs, microbotDir }) ? 'true' : 'false';
    try {
        fs.writeFileSync(file, JSON.stringify({ ...(properties || defaults), [HWID_SPOOF_PROPERTY]: value }, null, 2), 'utf8');
    } catch (error) {
        log.warn(value === 'true'
            ? `Could not save Spoof hardware IDs as on for this existing install, so this launch starts without spoofing and the launcher tries again next start: ${error.message}`
            : `Could not save Spoof hardware IDs as off for this new install: ${error.message}`);
        return null;
    }
    log.info(value === 'true'
        ? 'Spoof hardware IDs kept on for an existing install.'
        : 'Spoof hardware IDs starts off for a new install.');
    return value;
}

function replaceUnreadableSettings({ fs, log, file, defaults, problem }) {
    const backup = `${file}.unreadable`;
    try {
        fs.copyFileSync(file, backup);
        fs.writeFileSync(file, JSON.stringify({ ...defaults, [HWID_SPOOF_PROPERTY]: 'true' }, null, 2), 'utf8');
    } catch (error) {
        log.warn(`Could not read ${PROPERTIES_FILE} (${problem}) or replace it, so Spoof hardware IDs was left unset: ${error.message}`);
        return null;
    }
    log.warn(`Could not read ${PROPERTIES_FILE} (${problem}). Saved a copy as ${path.basename(backup)} and reset launcher settings, with Spoof hardware IDs kept on for this existing install.`);
    return 'true';
}

module.exports = {
    HWID_SPOOF_PROPERTY,
    LAUNCHER_DISABLED_ARG,
    SPOOF_ENABLED_ARG,
    ensureHwidAgentJar,
    hwidAgentJarPath,
    isHwidSpoofEnabled,
    hwidAgentArgs,
    isExistingInstall,
    settleHwidSpoofChoice
};
