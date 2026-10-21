module.exports = function createCaptchaWindow({ BrowserWindow, shell, getParent, log }) {
    return (url) =>
        new Promise((resolve) => {
            const parent = getParent();
            const pageOrigin = new URL(url).origin;
            const win = new BrowserWindow({
                width: 360,
                height: 280,
                parent: parent || undefined,
                modal: Boolean(parent),
                resizable: false,
                minimizable: false,
                maximizable: false,
                fullscreenable: false,
                autoHideMenuBar: true,
                title: 'Microbot',
                backgroundColor: '#0f1115',
                webPreferences: {
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false
                }
            });

            let settled = false;
            const finish = (token) => {
                if (settled) return;
                settled = true;
                resolve(token);
                if (!win.isDestroyed()) win.close();
            };

            win.webContents.on('did-navigate-in-page', (_event, pageUrl) => {
                const params = new URLSearchParams(new URL(pageUrl).hash.slice(1));
                if (params.get('token')) finish(params.get('token'));
            });
            win.webContents.on('will-navigate', (event, target) => {
                if (new URL(target).origin !== pageOrigin) event.preventDefault();
            });
            win.webContents.setWindowOpenHandler(({ url: target }) => {
                if (target.startsWith('https://')) shell.openExternal(target);
                return { action: 'deny' };
            });
            win.on('closed', () => finish(null));
            win.loadURL(url).catch((error) => {
                log.warn(`Could not load the captcha page: ${error?.message || error}`);
                finish(null);
            });
        });
};
