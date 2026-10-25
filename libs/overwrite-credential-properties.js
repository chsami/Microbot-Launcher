function writeCredentialProperties({ fs, path, homeDir }, character) {
    const filePath = path.join(homeDir, '.runelite', 'credentials.properties');
    const fileContent = `#Do not share this file with anyone
#${new Date().toString()}
JX_CHARACTER_ID=${character.accountId}
JX_SESSION_ID=${character.sessionId}
JX_REFRESH_TOKEN=
JX_DISPLAY_NAME=${character.displayName}
JX_ACCESS_TOKEN=
`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileContent, 'utf8');
}

module.exports = async function (deps) {
    const { fs, path, ipcMain, log } = deps;

    ipcMain.handle(
        'overwrite-credential-properties',
        async (event, character) => {
            try {
                writeCredentialProperties({ fs, path, homeDir: require('os').homedir() }, character);
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
