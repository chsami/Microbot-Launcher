const http = require('http');
const createBrowserCaptcha = require('../libs/captcha-browser');

const get = (url) =>
    new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });

describe('captcha-browser', () => {
    const log = { warn: jest.fn() };
    let shell;
    let opened;

    beforeEach(() => {
        opened = new Promise((resolve) => {
            shell = { openExternal: jest.fn((url) => { resolve(url); return Promise.resolve(); }) };
        });
    });

    test('opens the page with a loopback return address and resolves with the token sent back', async () => {
        const check = createBrowserCaptcha({ http, shell, log })('https://microbot.cloud/api/captcha');

        const target = new URL(await opened);
        const returnUrl = target.searchParams.get('return');
        expect(target.origin + target.pathname).toBe('https://microbot.cloud/api/captcha');
        expect(returnUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/captcha$/);

        const ignored = await get(`${returnUrl.replace('/captcha', '/other')}?token=x`);
        const response = await get(`${returnUrl}?token=abc%2B1`);

        expect(ignored.status).toBe(404);
        expect(response.status).toBe(200);
        expect(response.body).toContain("You're verified");
        await expect(check.promise).resolves.toBe('abc+1');
    });

    test('cancel resolves with null and stops listening', async () => {
        const check = createBrowserCaptcha({ http, shell, log })('https://microbot.cloud/api/captcha');
        const returnUrl = new URL(await opened).searchParams.get('return');

        check.cancel();

        await expect(check.promise).resolves.toBeNull();
        await expect(get(`${returnUrl}?token=late`)).rejects.toThrow();
    });

    test('gives up after the timeout', async () => {
        const check = createBrowserCaptcha({ http, shell, log, timeoutMs: 50 })('https://microbot.cloud/api/captcha');

        await expect(check.promise).resolves.toBeNull();
    });
});
