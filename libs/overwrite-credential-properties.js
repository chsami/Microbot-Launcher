const crypto = require('crypto');

function credentialEnv(character) {
    return {
        JX_CHARACTER_ID: `${character.accountId}`,
        JX_SESSION_ID: `${character.sessionId}`,
        JX_REFRESH_TOKEN: '',
        JX_DISPLAY_NAME: `${character.displayName ?? ''}`,
        JX_ACCESS_TOKEN: ''
    };
}

const CREDENTIAL_KEYS = Object.keys(credentialEnv({}));

const WRITTEN_KEY = 'credentialsWritten';

function credentialFile(path, homeDir) {
    return path.join(homeDir, '.runelite', 'credentials.properties');
}

function contentHash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

function readJson(fs, file) {
    if (!fs.existsSync(file)) return {};
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
}

function rememberWrite({ fs, settingsFile, log }, hash) {
    if (!settingsFile) return;
    try {
        const settings = readJson(fs, settingsFile);
        fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, [WRITTEN_KEY]: hash }, null, 2));
    } catch (error) {
        log?.warn?.(`Could not note which login the launcher wrote: ${error?.code || error?.message || error}`);
    }
}

function ownerOnly(fs, filePath, log) {
    try {
        fs.chmodSync(filePath, 0o600);
    } catch (error) {
        if (error?.code !== 'EPERM') throw error;
        log?.warn?.(`Could not make credentials.properties owner-only: ${error.code}`);
    }
}

function writeCredentialProperties({ fs, path, homeDir, settingsFile, log }, character) {
    const filePath = credentialFile(path, homeDir);
    const lines = Object.entries(credentialEnv(character)).map(([key, value]) => `${key}=${value}\n`);
    const fileContent = `#Do not share this file with anyone
#${new Date().toString()}
${lines.join('')}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileContent, { encoding: 'utf8', mode: 0o600 });
    ownerOnly(fs, filePath, log);
    rememberWrite({ fs, settingsFile, log }, contentHash(fileContent));
}

function credentialCharacterId({ fs, path, homeDir }) {
    const filePath = credentialFile(path, homeDir);
    if (!fs.existsSync(filePath)) return null;
    const line = fs
        .readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .find((entry) => entry.trim().startsWith('JX_CHARACTER_ID='));
    const id = line ? line.slice(line.indexOf('=') + 1).trim() : '';
    return id || null;
}

function launcherWroteCurrent({ fs, path, homeDir }, settings) {
    const recorded = settings?.[WRITTEN_KEY];
    const filePath = credentialFile(path, homeDir);
    if (typeof recorded !== 'string' || !fs.existsSync(filePath)) return false;
    return contentHash(fs.readFileSync(filePath, 'utf8')) === recorded;
}

function removeCredentialProperties({ fs, path, homeDir }) {
    fs.rmSync(credentialFile(path, homeDir), { force: true });
}

module.exports = async function (deps) {
    const { fs, path, ipcMain, log, launchQueue, microbotDir } = deps;
    const settingsFile = microbotDir ? path.join(microbotDir, 'launcher-settings.json') : null;

    ipcMain.handle(
        'overwrite-credential-properties',
        async (event, character) => {
            try {
                const write = () => writeCredentialProperties({ fs, path, homeDir: require('os').homedir(), settingsFile, log }, character);
                await (launchQueue ? launchQueue.run(write) : write());
                log.info('credentials.properties file updated successfully.');
                return { success: 'Succesfull' };
            } catch (error) {
                log.error(error.message);
                return { error: error.message };
            }
        }
    );
};

module.exports.writeCredentialProperties = writeCredentialProperties;
module.exports.credentialCharacterId = credentialCharacterId;
module.exports.removeCredentialProperties = removeCredentialProperties;
module.exports.launcherWroteCurrent = launcherWroteCurrent;
module.exports.WRITTEN_KEY = WRITTEN_KEY;
module.exports.credentialEnv = credentialEnv;
module.exports.CREDENTIAL_KEYS = CREDENTIAL_KEYS;
