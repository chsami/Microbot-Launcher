const BROWSER_FALLBACK_MESSAGE = 'Finish the check in the browser tab that just opened, then come back here.';

module.exports = function createCaptchaWindow({ BrowserWindow, shell, getParent, log, openInBrowser }) {
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
            let browserCheck = null;
            const finish = (token) => {
                if (settled) return;
                settled = true;
                browserCheck?.cancel();
                resolve(token);
                if (!win.isDestroyed()) win.close();
                if (token && parent && !parent.isDestroyed()) parent.focus();
            };

            const fallBackToBrowser = (code) => {
                if (browserCheck || !openInBrowser) return;
                log.warn(`Human check failed in the launcher (${code}); continuing in the browser.`);
                browserCheck = openInBrowser(url);
                browserCheck.promise.then(finish);
                win.webContents
                    .executeJavaScript(
                        `document.getElementById('widget').remove(); document.getElementById('status').textContent = ${JSON.stringify(BROWSER_FALLBACK_MESSAGE)};`
                    )
                    .catch(() => {});
            };

            win.webContents.on('console-message', (_event, _level, message) => {
                if (/turnstile|cloudflare|error \d{6}/i.test(message)) log.warn(`Captcha page: ${message}`);
            });
            win.webContents.on('did-navigate-in-page', (_event, pageUrl) => {
                const params = new URLSearchParams(new URL(pageUrl).hash.slice(1));
                if (params.get('token') && !browserCheck) finish(params.get('token'));
                else if (params.has('error')) fallBackToBrowser(params.get('error'));
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
