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
const HEADER = '#Do not share this file with anyone';
const JS_DATE_LINE = /^#\w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}/;

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
    const fileContent = `${HEADER}
#${new Date().toString()}
${lines.join('')}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileContent, { encoding: 'utf8', mode: 0o600 });
    ownerOnly(fs, filePath, log);
    rememberWrite({ fs, settingsFile, log }, contentHash(fileContent));
}

function readCredentialLogin({ fs, path, homeDir }) {
    const filePath = credentialFile(path, homeDir);
    if (!fs.existsSync(filePath)) return null;
    const values = {};
    fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .forEach((entry) => {
            const line = entry.trim();
            const equals = line.indexOf('=');
            if (line.startsWith('JX_') && equals > 0) values[line.slice(0, equals)] = line.slice(equals + 1).trim();
        });
    return { characterId: values.JX_CHARACTER_ID || null, sessionId: values.JX_SESSION_ID || null };
}

function credentialCharacterId(deps) {
    return readCredentialLogin(deps)?.characterId || null;
}

function inLauncherFormat(text) {
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (lines.length !== CREDENTIAL_KEYS.length + 2 || lines[0] !== HEADER || !JS_DATE_LINE.test(lines[1])) return false;
    return CREDENTIAL_KEYS.every((key, index) => {
        const line = lines[index + 2];
        if (!line.startsWith(`${key}=`)) return false;
        return key === 'JX_REFRESH_TOKEN' || key === 'JX_ACCESS_TOKEN' ? line === `${key}=` : true;
    });
}

function launcherWroteCurrent({ fs, path, homeDir }, settings) {
    const recorded = settings?.[WRITTEN_KEY];
    const filePath = credentialFile(path, homeDir);
    if (!fs.existsSync(filePath)) return false;
    const text = fs.readFileSync(filePath, 'utf8');
    return (typeof recorded === 'string' && contentHash(text) === recorded) || inLauncherFormat(text);
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
module.exports.readCredentialLogin = readCredentialLogin;
module.exports.inLauncherFormat = inLauncherFormat;
module.exports.removeCredentialProperties = removeCredentialProperties;
module.exports.launcherWroteCurrent = launcherWroteCurrent;
module.exports.WRITTEN_KEY = WRITTEN_KEY;
module.exports.credentialEnv = credentialEnv;
module.exports.CREDENTIAL_KEYS = CREDENTIAL_KEYS;
