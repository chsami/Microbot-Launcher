const path = require('path');
const { isSafeClientVersion } = require('./client-jars.js');

const hwidAgentFile = 'hwid-agent-<version>.jar';
const HWID_SPOOF_PROPERTY = 'hwid_spoof';
const LAUNCHER_DISABLED_ARG = '-Dmicrobot.hwid.launcherDisabled=true';
// The agent stays inert unless the client is started with this flag.
const SPOOF_ENABLED_ARG = '-Dmicrobot.hwid.spoof=true';

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

module.exports = {
    HWID_SPOOF_PROPERTY,
    LAUNCHER_DISABLED_ARG,
    SPOOF_ENABLED_ARG,
    ensureHwidAgentJar,
    hwidAgentJarPath,
    isHwidSpoofEnabled,
    hwidAgentArgs
};
