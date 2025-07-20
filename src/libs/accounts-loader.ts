// @ts-nocheck
module.exports = async function (deps) {

    const {
        fs,
        path,
        microbotDir,
        ipcMain,
        log
    } = deps

    const filePath = path.resolve(microbotDir, 'accounts.json');

    ipcMain.handle('read-accounts', async () => {
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                let accounts = JSON.parse(data);
                accounts.sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
                // Use a Set to track unique display names
                const uniqueDisplayNames = new Set();

                // Filter the accounts array
                return accounts.filter(account => {
                    if (uniqueDisplayNames.has(account.displayName)) {
                        // If the displayName is already in the set, skip this account
                        return false;
                    } else {
                        // Otherwise, add the displayName to the set and include this account
                        if (!account.displayName) {
                            account.displayName = 'Not set'
                            return true;
                        } else {
                            uniqueDisplayNames.add(account.displayName);
                            return true;
                        }
                    }
                })
            }
        } catch (error) {
            log.error(error.message)
            return { error: error.message };
        }
    });


    ipcMain.handle('remove-accounts', async () => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            log.error(error.message)
            return { error: error.message };
        }
    });

    let lastModifiedTime = null;

    ipcMain.handle('check-file-change', async () => {
        try {
            let val = false;
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                const modifiedTime = stats.mtime;

                // Check if the modification time has changed
                if (!lastModifiedTime || modifiedTime > lastModifiedTime) {
                    log.info('File has been modified!');
                    lastModifiedTime = modifiedTime; // Update the last modification time
                    val = true;
                }
            }
            return val;
        } catch (error) {
            log.error(error.message)
            return { error: error.message };
        }
    });
}