module.exports = async function (app, ipcMain, window, log, openLocation) {
    ipcMain.handle('minimize-window', async () => {
        try {
            if (window) {
                window.minimize();
            }
            return { success: true };
        } catch (error) {
            log?.error('Error minimizing window:', error.message);
            return { error: error.message };
        }
    });

    ipcMain.handle('maximize-window', async () => {
        try {
            if (window) {
                if (window.isMaximized()) {
                    window.unmaximize();
                } else {
                    window.maximize();
                }
            }
            return { success: true };
        } catch (error) {
            log?.error('Error maximizing window:', error.message);
            return { error: error.message };
        }
    });

    ipcMain.handle('close-launcher', async () => {
        try {
            if (app) {
                app.quit();
            }
            return { success: true };
        } catch (error) {
            log?.error('Error closing launcher:', error.message);
            return { error: error.message };
        }
    });

    ipcMain.handle('open-location', async (_event, locationKey) => {
        try {
            if (typeof locationKey !== 'string' || !locationKey.trim()) {
                return { error: 'Invalid location key' };
            }
            const result = await openLocation(locationKey.trim());
            if (!result?.success) {
                log?.error('open-location failed', result?.error);
                return { error: result?.error || 'Unknown error' };
            }
            return { success: true, path: result.path };
        } catch (err) {
            log?.error('open-location exception', err);
            return { error: err?.message || String(err) };
        }
    });
};
