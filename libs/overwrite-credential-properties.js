function credentialEnv(character) {
    return {
        JX_CHARACTER_ID: `${character.accountId}`,
        JX_SESSION_ID: `${character.sessionId}`,
        JX_REFRESH_TOKEN: '',
        JX_DISPLAY_NAME: `${character.displayName}`,
        JX_ACCESS_TOKEN: ''
    };
}

const CREDENTIAL_KEYS = Object.keys(credentialEnv({}));

function writeCredentialProperties({ fs, path, homeDir }, character) {
    const filePath = path.join(homeDir, '.runelite', 'credentials.properties');
    const lines = Object.entries(credentialEnv(character)).map(([key, value]) => `${key}=${value}\n`);
    const fileContent = `#Do not share this file with anyone
#${new Date().toString()}
${lines.join('')}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileContent, 'utf8');
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
module.exports.credentialEnv = credentialEnv;
module.exports.CREDENTIAL_KEYS = CREDENTIAL_KEYS;
