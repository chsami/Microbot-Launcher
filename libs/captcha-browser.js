const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const DONE_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Microbot</title>
<style>html,body{margin:0;height:100%;background:#0f1115;color:#c9ced8;font:15px system-ui,sans-serif}body{display:flex;align-items:center;justify-content:center;text-align:center;padding:0 16px}</style>
</head>
<body><p>You're verified. You can close this tab and go back to the Microbot Launcher.</p></body>
</html>`;

module.exports = function createBrowserCaptcha({ http, shell, log, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    return (pageUrl) => {
        let finish = () => {};
        const promise = new Promise((resolve) => {
            let done = false;
            let timer = null;
            const server = http.createServer((req, res) => {
                const url = new URL(req.url, 'http://127.0.0.1');
                const token = url.pathname === '/captcha' ? url.searchParams.get('token') : null;
                if (!token) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(DONE_PAGE);
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
                const returnUrl = `http://127.0.0.1:${server.address().port}/captcha`;
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
