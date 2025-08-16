module.exports = async function (deps) {
    const { fs, path, ipcMain, log } = deps;

    ipcMain.handle(
        'overwrite-credential-properties',
        async (event, character) => {
            try {
                // Path to the credentials.properties file in your home directory
                const homeDirectory = require('os').homedir();
                const filePath = path.join(
                    homeDirectory,
                    '.runelite',
                    'credentials.properties'
                );
                // Generate the file content in the same format
                const fileContent = `#Do not share this file with anyone
#${new Date().toString()}
JX_CHARACTER_ID=${character.accountId}
JX_SESSION_ID=${character.sessionId}
JX_REFRESH_TOKEN=
JX_DISPLAY_NAME=${character.displayName}
JX_ACCESS_TOKEN=
`;
                // Write the content to the file, overwriting the existing file
                fs.writeFile(filePath, fileContent, 'utf8', (err) => {
                    if (err) {
                        log.error(
                            'An error occurred while writing to the file:',
                            err
                        );
                    } else {
                        log.info(
                            'credentials.properties file updated successfully.'
                        );
                    }
                });
                return { success: 'Succesfull' };
            } catch (error) {
                log.error(error.message);
                return { error: error.message };
            }
        }
    );
};
