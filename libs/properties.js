module.exports = async function (deps) {
    const { fs, path, microbotDir, ipcMain, log } = deps;

    const filePath = path.resolve(microbotDir, 'resource_versions.json');

    // Define your default values here
    const defaultProperties = {
        client: '0.0.0',
        version_pref: '0.0.0'
    };

    ipcMain.handle('write-properties', async (event, data) => {
        try {
            try {
                fs.writeFileSync(
                    filePath,
                    JSON.stringify(data, null, 2),
                    'utf8'
                );
            } catch (err) {
                console.error('Error writing to properties file:', err);
            }
        } catch (error) {
            logMessage(error.message);
            return { error: error.message };
        }
    });

    ipcMain.handle('read-properties', async () => {
        try {
            try {
                if (fs.existsSync(filePath)) {
                    const data = fs.readFileSync(filePath, 'utf8');
                    return JSON.parse(data);
                }
                fs.writeFileSync(
                    filePath,
                    JSON.stringify(defaultProperties, null, 2),
                    'utf8'
                );
                log.info('Properties file created with default values.');
                return defaultProperties;
            } catch (err) {
                console.error('Error reading properties file:', err);
                return {};
            }
        } catch (error) {
            log.error(error.message);
            return { error: error.message };
        }
    });
};
