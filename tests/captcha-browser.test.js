const http = require('http');
const createBrowserCaptcha = require('../libs/captcha-browser');

const get = (url, method = 'GET') =>
    new Promise((resolve, reject) => {
        http.request(url, { method }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject).end();
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
        expect(returnUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/captcha\/[A-Za-z0-9_-]{32}$/);

        const origin = new URL(returnUrl).origin;
        const ignored = await Promise.all([
            get(`${origin}/other?token=x`),
            get(`${origin}/captcha?token=forged`),
            get(`${origin}/captcha/${'A'.repeat(32)}?token=forged`),
            get(`${returnUrl}?token=forged`, 'POST'),
        ]);
        const response = await get(`${returnUrl}?token=abc%2B1`);

        expect(ignored.map((r) => r.status)).toEqual([404, 404, 404, 404]);
        expect(response.status).toBe(200);
        expect(response.body).toContain("You're verified");
        await expect(check.promise).resolves.toBe('abc+1');
    });

    test('each check gets its own return path', async () => {
        const first = createBrowserCaptcha({ http, shell, log })('https://microbot.cloud/api/captcha');
        const firstPath = new URL(new URL(await opened).searchParams.get('return')).pathname;
        first.cancel();
        opened = new Promise((resolve) => {
            shell.openExternal = jest.fn((url) => { resolve(url); return Promise.resolve(); });
        });
        const second = createBrowserCaptcha({ http, shell, log })('https://microbot.cloud/api/captcha');
        const secondPath = new URL(new URL(await opened).searchParams.get('return')).pathname;
        second.cancel();

        expect(firstPath).not.toBe(secondPath);
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
