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

function credentialFile(path, homeDir) {
    return path.join(homeDir, '.runelite', 'credentials.properties');
}

function writeCredentialProperties({ fs, path, homeDir }, character) {
    const filePath = credentialFile(path, homeDir);
    const lines = Object.entries(credentialEnv(character)).map(([key, value]) => `${key}=${value}\n`);
    const fileContent = `#Do not share this file with anyone
#${new Date().toString()}
${lines.join('')}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileContent, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
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

function removeCredentialProperties({ fs, path, homeDir }) {
    fs.rmSync(credentialFile(path, homeDir), { force: true });
}

module.exports = async function (deps) {
    const { fs, path, ipcMain, log, launchQueue } = deps;

    ipcMain.handle(
        'overwrite-credential-properties',
        async (event, character) => {
            try {
                const write = () => writeCredentialProperties({ fs, path, homeDir: require('os').homedir() }, character);
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
module.exports.credentialEnv = credentialEnv;
module.exports.CREDENTIAL_KEYS = CREDENTIAL_KEYS;
