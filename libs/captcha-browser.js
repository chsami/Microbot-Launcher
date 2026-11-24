const crypto = require('crypto');
const { launcherColors } = require('./theme-settings');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// what the page looked like before themes; kept for players who never picked one
const ORIGINAL_COLORS = { bg: '#0f1115', text: '#c9ced8' };

const donePage = (c) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Microbot</title>
<style>html,body{margin:0;height:100%;background:${c.bg};color:${c.text};font:15px system-ui,sans-serif}body{display:flex;align-items:center;justify-content:center;text-align:center;padding:0 16px}</style>
</head>
<body><p>You're verified. You can close this tab and go back to the Microbot Launcher.</p></body>
</html>`;

module.exports = function createBrowserCaptcha({ http, shell, log, timeoutMs = DEFAULT_TIMEOUT_MS, colors = launcherColors }) {
    return (pageUrl) => {
        let finish = () => {};
        const callbackPath = `/captcha/${crypto.randomBytes(24).toString('base64url')}`;
        const promise = new Promise((resolve) => {
            let done = false;
            let timer = null;
            const server = http.createServer((req, res) => {
                const url = new URL(req.url, 'http://127.0.0.1');
                const token = req.method === 'GET' && url.pathname === callbackPath ? url.searchParams.get('token') : null;
                if (!token) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(donePage(colors() || ORIGINAL_COLORS));
                finish(token);
            });

            finish = (token) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                server.close();
                resolve(token);
            };

            server.on('error', (error) => {
                log.warn(`Could not start the browser human check: ${error?.message || error}`);
                finish(null);
            });
            server.listen(0, '127.0.0.1', () => {
                if (done) return;
                const returnUrl = `http://127.0.0.1:${server.address().port}${callbackPath}`;
                const target = new URL(pageUrl);
                target.searchParams.set('return', returnUrl);
                timer = setTimeout(() => finish(null), timeoutMs);
                Promise.resolve(shell.openExternal(target.toString())).catch((error) => {
                    log.warn(`Could not open the browser for the human check: ${error?.message || error}`);
                    finish(null);
                });
            });
        });
        return { promise, cancel: () => finish(null) };
    };
};
