const fs = require('fs');
const os = require('os');
const path = require('path');
const setupApiAuth = require('../libs/api-auth');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }

    invoke(channel, payload) {
        return this.handlers.get(channel)(null, payload);
    }
}

const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`),
    decryptString: (buffer) => buffer.toString().replace(/^enc:/, '')
};

const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const httpError = (status, message) =>
    Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { message } } });

describe('api-auth', () => {
    let dir;
    let sessionFile;
    let axios;

    const setup = () => {
        const ipcMain = new FakeIpcMain();
        setupApiAuth({ ipcMain, log, axios, fs, safeStorage, sessionFile, baseUrl: 'https://api.test/' });
        return ipcMain;
    };

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-auth-'));
        sessionFile = path.join(dir, 'session.dat');
        axios = { post: jest.fn() };
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('sign in stores an encrypted session and normalizes the email', async () => {
        axios.post.mockResolvedValue({ data: { token: 'access', refreshToken: 'refresh' } });
        const ipcMain = setup();

        const result = await ipcMain.invoke('auth:signin', { email: ' Player@Example.com ', password: 'secret123' });

        expect(result).toEqual({ success: true, user: { email: 'player@example.com' } });
        expect(axios.post).toHaveBeenCalledWith(
            'https://api.test/api/auth/login',
            { email: 'player@example.com', password: 'secret123' },
            expect.any(Object)
        );
        const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile)));
        expect(stored).toEqual({ email: 'player@example.com', accessToken: 'access', refreshToken: 'refresh' });
    });

    test('sign in maps wrong password, unverified email and rate limiting', async () => {
        const ipcMain = setup();

        axios.post.mockRejectedValueOnce(httpError(401, 'Wrong email or password.'));
        expect((await ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'x' })).error).toBe('Wrong email or password.');

        axios.post.mockRejectedValueOnce(httpError(403, 'Email not verified.'));
        expect((await ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'x' })).code).toBe('unverified');

        axios.post.mockRejectedValueOnce(httpError(429));
        expect((await ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'x' })).error).toMatch(/Too many attempts/);

        expect(fs.existsSync(sessionFile)).toBe(false);
    });

    test('sign in reports when the API is unreachable', async () => {
        axios.post.mockRejectedValue(new Error('ENOTFOUND'));
        const ipcMain = setup();

        const result = await ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'secret123' });

        expect(result.error).toMatch(/Can't reach Microbot servers/);
    });

    test('sign up asks the user to verify and does not sign in', async () => {
        axios.post.mockResolvedValue({ data: {} });
        const ipcMain = setup();

        const result = await ipcMain.invoke('auth:signup', { email: 'new@example.com', password: 'secret123' });

        expect(result).toEqual({
            success: true,
            pendingVerification: true,
            verificationEmailSent: true,
            user: { email: 'new@example.com' }
        });
        expect(fs.existsSync(sessionFile)).toBe(false);
    });

    test('sign up reports when the verification email could not be sent', async () => {
        axios.post.mockResolvedValue({ data: { verificationEmailSent: false } });
        const ipcMain = setup();

        const result = await ipcMain.invoke('auth:signup', { email: 'new@example.com', password: 'secret123' });

        expect(result.verificationEmailSent).toBe(false);
    });

    test('sign up surfaces duplicate and validation errors', async () => {
        const ipcMain = setup();

        axios.post.mockRejectedValueOnce(httpError(409, 'Email already registered.'));
        expect((await ipcMain.invoke('auth:signup', { email: 'a@b.co', password: 'secret123' })).error).toMatch(/already exists/);

        axios.post.mockRejectedValueOnce(httpError(400, 'Enter a valid email address.'));
        expect((await ipcMain.invoke('auth:signup', { email: 'a@b', password: 'secret123' })).error).toBe('Enter a valid email address.');
    });

    test('status restores a saved session and rotates its tokens', async () => {
        fs.writeFileSync(sessionFile, safeStorage.encryptString(JSON.stringify({ email: 'a@b.co', accessToken: 'old', refreshToken: 'old-r' })));
        axios.post.mockResolvedValue({ data: { token: 'new', refreshToken: 'new-r' } });
        const ipcMain = setup();

        const status = await ipcMain.invoke('auth:status');
        await flush();

        expect(status).toEqual({ authenticated: true, mock: false, api: true, user: { email: 'a@b.co' } });
        expect(axios.post).toHaveBeenCalledWith(
            'https://api.test/api/auth/refresh-token',
            { accessToken: 'old', refreshToken: 'old-r' },
            expect.any(Object)
        );
        const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile)));
        expect(stored.refreshToken).toBe('new-r');
    });

    test('an expired saved session signs the user out', async () => {
        fs.writeFileSync(sessionFile, safeStorage.encryptString(JSON.stringify({ email: 'a@b.co', accessToken: 'old', refreshToken: 'old-r' })));
        axios.post.mockRejectedValue(httpError(400, 'Invalid or expired refresh token'));
        const ipcMain = setup();

        await ipcMain.invoke('auth:status');
        await flush();

        expect((await ipcMain.invoke('auth:status')).authenticated).toBe(false);
        expect(fs.existsSync(sessionFile)).toBe(false);
    });

    test('a saved session survives being offline', async () => {
        fs.writeFileSync(sessionFile, safeStorage.encryptString(JSON.stringify({ email: 'a@b.co', accessToken: 'old', refreshToken: 'old-r' })));
        axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
        const ipcMain = setup();

        await ipcMain.invoke('auth:status');
        await flush();

        expect((await ipcMain.invoke('auth:status')).authenticated).toBe(true);
        expect(fs.existsSync(sessionFile)).toBe(true);
    });

    test.each([408, 429])('a saved session survives a %i on refresh', async (status) => {
        fs.writeFileSync(sessionFile, safeStorage.encryptString(JSON.stringify({ email: 'a@b.co', accessToken: 'old', refreshToken: 'old-r' })));
        axios.post.mockRejectedValue(httpError(status, 'Try again later'));
        const ipcMain = setup();

        await ipcMain.invoke('auth:status');
        await flush();

        expect((await ipcMain.invoke('auth:status')).authenticated).toBe(true);
        expect(fs.existsSync(sessionFile)).toBe(true);
    });

    test('sign out removes the saved session', async () => {
        axios.post.mockResolvedValue({ data: { token: 'access', refreshToken: 'refresh' } });
        const ipcMain = setup();
        await ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'secret123' });

        await ipcMain.invoke('auth:signout');

        expect(axios.post).toHaveBeenLastCalledWith('https://api.test/api/auth/logout', { refreshToken: 'refresh' }, expect.any(Object));
        expect(fs.existsSync(sessionFile)).toBe(false);
        expect((await ipcMain.invoke('auth:status')).authenticated).toBe(false);
    });

    test('sign out still works offline', async () => {
        axios.post.mockResolvedValueOnce({ data: { token: 'access', refreshToken: 'refresh' } });
        axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const ipcMain = setup();
        await ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'secret123' });

        expect(await ipcMain.invoke('auth:signout')).toEqual({ success: true });
        expect(fs.existsSync(sessionFile)).toBe(false);
    });

    test('resend verification and password reset post the email', async () => {
        axios.post.mockResolvedValue({ data: {} });
        const ipcMain = setup();

        expect(await ipcMain.invoke('auth:resend-verification', { email: 'A@b.co' })).toEqual({ success: true });
        expect(await ipcMain.invoke('auth:request-password-reset', { email: 'A@b.co' })).toEqual({ success: true });
        expect((await ipcMain.invoke('auth:request-password-reset', { email: '' })).error).toBe('Enter your email first.');

        expect(axios.post).toHaveBeenCalledWith('https://api.test/api/auth/resend-verification', { email: 'a@b.co', captchaToken: null }, expect.any(Object));
        expect(axios.post).toHaveBeenCalledWith('https://api.test/api/auth/request-password-reset', { email: 'a@b.co', captchaToken: null }, expect.any(Object));
    });

    describe('human check', () => {
        let captcha;

        const setupWithCaptcha = () => {
            const ipcMain = new FakeIpcMain();
            setupApiAuth({ ipcMain, log, axios, fs, safeStorage, sessionFile, baseUrl: 'https://api.test', captcha });
            return ipcMain;
        };

        beforeEach(() => {
            captcha = jest.fn().mockResolvedValue('turnstile-token');
            axios.get = jest.fn().mockResolvedValue({ data: { siteKey: 'site-key' } });
            axios.post.mockResolvedValue({ data: {} });
        });

        test('sign up sends the token from the captcha window', async () => {
            const ipcMain = setupWithCaptcha();

            const result = await ipcMain.invoke('auth:signup', { email: 'new@example.com', password: 'secret123' });

            expect(result.success).toBe(true);
            expect(captcha).toHaveBeenCalledWith('https://api.test/api/captcha');
            expect(axios.post).toHaveBeenCalledWith(
                'https://api.test/api/auth/register',
                { email: 'new@example.com', password: 'secret123', captchaToken: 'turnstile-token' },
                expect.any(Object)
            );
        });

        test('resend and password reset also send the token', async () => {
            const ipcMain = setupWithCaptcha();

            await ipcMain.invoke('auth:resend-verification', { email: 'a@b.co' });
            await ipcMain.invoke('auth:request-password-reset', { email: 'a@b.co' });

            expect(captcha).toHaveBeenCalledTimes(2);
            expect(axios.post.mock.calls.map(([, body]) => body.captchaToken)).toEqual(['turnstile-token', 'turnstile-token']);
        });

        test('closing the captcha window cancels without calling the API', async () => {
            captcha.mockResolvedValue(null);
            const ipcMain = setupWithCaptcha();

            const result = await ipcMain.invoke('auth:signup', { email: 'new@example.com', password: 'secret123' });

            expect(result.error).toBe('Complete the human check to continue.');
            expect(axios.post).not.toHaveBeenCalled();
        });

        test('no window opens when the server has no captcha configured', async () => {
            axios.get.mockResolvedValue({ data: { siteKey: null } });
            const ipcMain = setupWithCaptcha();

            await ipcMain.invoke('auth:signup', { email: 'new@example.com', password: 'secret123' });

            expect(captcha).not.toHaveBeenCalled();
            expect(axios.post.mock.calls[0][1].captchaToken).toBeNull();
        });

        test('an older server without the captcha endpoint still works', async () => {
            axios.get.mockRejectedValue(httpError(404));
            const ipcMain = setupWithCaptcha();

            const result = await ipcMain.invoke('auth:signup', { email: 'new@example.com', password: 'secret123' });

            expect(result.success).toBe(true);
            expect(captcha).not.toHaveBeenCalled();
        });

        test('an unreachable server is reported before opening the window', async () => {
            axios.get.mockRejectedValue(new Error('ENOTFOUND'));
            const ipcMain = setupWithCaptcha();

            const result = await ipcMain.invoke('auth:signup', { email: 'new@example.com', password: 'secret123' });

            expect(result.error).toMatch(/Can't reach Microbot servers/);
            expect(captcha).not.toHaveBeenCalled();
        });

        test('a rejected token shows the server message', async () => {
            axios.post.mockRejectedValue(httpError(400, 'The human check failed. Please try again.'));
            const ipcMain = setupWithCaptcha();

            const result = await ipcMain.invoke('auth:signup', { email: 'new@example.com', password: 'secret123' });

            expect(result.error).toBe('The human check failed. Please try again.');
        });
    });

    describe('authorized requests', () => {
        const signIn = async () => {
            axios.post.mockResolvedValueOnce({ data: { token: 'access', refreshToken: 'refresh' } });
            const ipcMain = new FakeIpcMain();
            const auth = setupApiAuth({ ipcMain, log, axios, fs, safeStorage, sessionFile, baseUrl: 'https://api.test/' });
            await ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'secret123' });
            return { ipcMain, auth };
        };

        beforeEach(() => {
            axios.request = jest.fn();
        });

        test('send the access token as a bearer header', async () => {
            const { auth } = await signIn();
            axios.request.mockResolvedValue({ data: [] });

            await auth.request({ method: 'get', path: '/api/alerts/client-links' });

            expect(auth.email()).toBe('a@b.co');
            expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'get',
                url: 'https://api.test/api/alerts/client-links',
                headers: { Authorization: 'Bearer access' }
            }));
        });

        test('refresh an expired access token once and retry', async () => {
            const { auth } = await signIn();
            axios.post.mockResolvedValueOnce({ data: { token: 'access-2', refreshToken: 'refresh-2' } });
            axios.request.mockRejectedValueOnce(httpError(401)).mockResolvedValueOnce({ data: { ok: true } });

            const { data } = await auth.request({ method: 'post', path: '/api/alerts/client-links', data: { label: 'Main' } });

            expect(data).toEqual({ ok: true });
            expect(axios.post).toHaveBeenLastCalledWith(
                'https://api.test/api/auth/refresh-token',
                { accessToken: 'access', refreshToken: 'refresh' },
                expect.any(Object)
            );
            expect(axios.request.mock.calls[1][0].headers).toEqual({ Authorization: 'Bearer access-2' });
        });

        test('concurrent expired requests share one refresh', async () => {
            const { auth } = await signIn();
            let finishRefresh;
            axios.post.mockImplementationOnce(() => new Promise((resolve) => {
                finishRefresh = () => resolve({ data: { token: 'access-2', refreshToken: 'refresh-2' } });
            }));
            axios.request
                .mockRejectedValueOnce(httpError(401))
                .mockRejectedValueOnce(httpError(401))
                .mockResolvedValue({ data: { ok: true } });

            const first = auth.request({ method: 'get', path: '/api/alerts/client-links' });
            const second = auth.request({ method: 'get', path: '/api/alerts/client-links' });
            await flush();
            finishRefresh();

            await expect(Promise.all([first, second])).resolves.toHaveLength(2);
            const refreshCalls = axios.post.mock.calls.filter(([url]) => url.endsWith('/refresh-token'));
            expect(refreshCalls).toHaveLength(1);
            expect(axios.request.mock.calls.slice(2).map(([config]) => config.headers)).toEqual([
                { Authorization: 'Bearer access-2' },
                { Authorization: 'Bearer access-2' }
            ]);
        });

        test('reject with 401 when the session cannot be refreshed', async () => {
            const { ipcMain, auth } = await signIn();
            axios.post.mockRejectedValueOnce(httpError(400, 'Invalid or expired refresh token'));
            axios.request.mockRejectedValue(httpError(401));

            await expect(auth.request({ method: 'get', path: '/api/alerts/client-links' })).rejects.toMatchObject({
                response: { status: 401 }
            });
            expect((await ipcMain.invoke('auth:status')).authenticated).toBe(false);
            expect(auth.email()).toBeNull();
        });

        test('reject with 401 when signed out', async () => {
            const auth = setupApiAuth({ ipcMain: new FakeIpcMain(), log, axios, fs, safeStorage, sessionFile, baseUrl: 'https://api.test' });

            await expect(auth.request({ method: 'get', path: '/api/alerts/client-links' })).rejects.toMatchObject({
                response: { status: 401 }
            });
            expect(axios.request).not.toHaveBeenCalled();
        });
    });

    test('nothing is written to disk when Linux has no secret store', async () => {
        axios.post.mockResolvedValue({ data: { token: 'access', refreshToken: 'refresh' } });
        const ipcMain = new FakeIpcMain();
        setupApiAuth({
            ipcMain,
            log,
            axios,
            fs,
            safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' },
            sessionFile,
            baseUrl: 'https://api.test'
        });

        await ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'secret123' });

        expect(fs.existsSync(sessionFile)).toBe(false);
        expect((await ipcMain.invoke('auth:status')).authenticated).toBe(true);
    });

    test('nothing is written to disk when encryption is unavailable', async () => {
        axios.post.mockResolvedValue({ data: { token: 'access', refreshToken: 'refresh' } });
        const ipcMain = new FakeIpcMain();
        setupApiAuth({
            ipcMain,
            log,
            axios,
            fs,
            safeStorage: { ...safeStorage, isEncryptionAvailable: () => false },
            sessionFile,
            baseUrl: 'https://api.test'
        });

        await ipcMain.invoke('auth:signin', { email: 'a@b.co', password: 'secret123' });

        expect(fs.existsSync(sessionFile)).toBe(false);
        expect((await ipcMain.invoke('auth:status')).authenticated).toBe(true);
    });
});
