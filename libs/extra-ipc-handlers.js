const HELP_LINKS = {
    discord: 'https://discord.gg/zaGrfqFEWE'
};

module.exports = async function (app, ipcMain, window, log, openLocation, openExternal, close = () => app?.quit()) {
    if (typeof openLocation !== 'function') {
        throw new Error('missing required dependency: openLocation');
    }
    if (typeof openExternal !== 'function') {
        throw new Error('missing required dependency: openExternal');
    }
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
            close();
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

    ipcMain.handle('open-help-link', async (_event, linkKey) => {
        if (typeof linkKey !== 'string' || !Object.hasOwn(HELP_LINKS, linkKey)) {
            return { error: 'Unknown help link' };
        }
        try {
            await openExternal(HELP_LINKS[linkKey]);
            return { success: true };
        } catch (err) {
            log?.error('open-help-link failed', err);
            return { error: err?.message || String(err) };
        }
    });
};

module.exports.HELP_LINKS = HELP_LINKS;
