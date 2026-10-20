const DEFAULT_BASE_URL = 'https://microbot.cloud';
const REQUEST_TIMEOUT_MS = 15000;

module.exports = function setupApiAuth(deps) {
    const { ipcMain, log, axios, fs, safeStorage, sessionFile } = deps;
    const baseUrl = (deps.baseUrl || process.env.MICROBOT_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

    let session = null;
    let restored = false;

    const post = (endpoint, body) =>
        axios.post(`${baseUrl}/api/auth/${endpoint}`, body, { timeout: REQUEST_TIMEOUT_MS });

    const canPersist = () => {
        try {
            return Boolean(safeStorage?.isEncryptionAvailable());
        } catch (error) {
            return false;
        }
    };

    const writeSession = (value) => {
        session = value;
        try {
            if (!value) {
                if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
                return;
            }
            if (!canPersist()) return;
            fs.writeFileSync(sessionFile, safeStorage.encryptString(JSON.stringify(value)));
        } catch (error) {
            log.warn(`Could not save sign-in session: ${error?.message || error}`);
        }
    };

    const readSession = () => {
        try {
            if (!canPersist() || !fs.existsSync(sessionFile)) return null;
            const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile)));
            if (value?.email && value?.accessToken && value?.refreshToken) return value;
        } catch (error) {
            log.warn(`Could not read sign-in session: ${error?.message || error}`);
        }
        return null;
    };

    const refresh = async () => {
        const current = session;
        if (!current) return;
        try {
            const { data } = await post('refresh-token', {
                accessToken: current.accessToken,
                refreshToken: current.refreshToken
            });
            if (session === current) {
                writeSession({ ...current, accessToken: data.token, refreshToken: data.refreshToken });
            }
        } catch (error) {
            if (session !== current) return;
            if (error?.response && error.response.status < 500) {
                log.info('Stored sign-in session expired; signing out.');
                writeSession(null);
            } else {
                log.warn(`Could not refresh sign-in session: ${error?.message || error}`);
            }
        }
    };

    const restore = () => {
        if (restored) return;
        restored = true;
        if (session) return;
        session = readSession();
        refresh();
    };

    ipcMain.handle('auth:status', async () => {
        restore();
        return {
            authenticated: Boolean(session),
            mock: false,
            api: true,
            user: session ? { email: session.email } : null
        };
    });

    ipcMain.handle('auth:signin', async (_event, payload) => {
        const { email, password } = credentials(payload);
        if (!email || !password) {
            return { error: 'Enter your email and password.' };
        }
        try {
            const { data } = await post('login', { email, password });
            writeSession({ email, accessToken: data.token, refreshToken: data.refreshToken });
            return { success: true, user: { email } };
        } catch (error) {
            const status = error?.response?.status;
            if (status === 401) return { error: 'Wrong email or password.' };
            if (status === 403) {
                return { error: 'Verify your email before signing in. Check your inbox for the link.', code: 'unverified' };
            }
            return { error: describeError(error, log, 'Could not sign in.') };
        }
    });

    ipcMain.handle('auth:signup', async (_event, payload) => {
        const { email, password } = credentials(payload);
        if (!email || !password) {
            return { error: 'Enter your email and a password.' };
        }
        try {
            const { data } = await post('register', { email, password });
            return {
                success: true,
                pendingVerification: true,
                verificationEmailSent: data?.verificationEmailSent !== false,
                user: { email }
            };
        } catch (error) {
            if (error?.response?.status === 409) {
                return { error: 'An account with this email already exists. Sign in instead.' };
            }
            return { error: describeError(error, log, 'Could not create your account.') };
        }
    });

    ipcMain.handle('auth:resend-verification', async (_event, payload) => {
        const { email } = credentials(payload);
        if (!email) return { error: 'Enter your email first.' };
        try {
            await post('resend-verification', { email });
            return { success: true };
        } catch (error) {
            return { error: describeError(error, log, 'Could not send the verification email.') };
        }
    });

    ipcMain.handle('auth:request-password-reset', async (_event, payload) => {
        const { email } = credentials(payload);
        if (!email) return { error: 'Enter your email first.' };
        try {
            await post('request-password-reset', { email });
            return { success: true };
        } catch (error) {
            return { error: describeError(error, log, 'Could not send the reset email.') };
        }
    });

    ipcMain.handle('auth:signout', async () => {
        writeSession(null);
        return { success: true };
    });

    ipcMain.handle('auth:changepw', async () => ({
        error: 'Use "Forgot password?" on the sign-in screen to change your password.'
    }));
};

function credentials(payload) {
    return {
        email: String(payload?.email || '').trim().toLowerCase(),
        password: String(payload?.password || '')
    };
}

function describeError(error, log, fallback) {
    const status = error?.response?.status;
    if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
    const message = error?.response?.data?.message;
    if (status && status < 500 && typeof message === 'string' && message) return message;
    if (!error?.response) {
        log.warn(`Microbot API unreachable: ${error?.message || error}`);
        return "Can't reach Microbot servers. Check your connection and try again.";
    }
    log.warn(`Microbot API error ${status}: ${error?.message || error}`);
    return fallback;
}
