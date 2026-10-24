const DEFAULT_BASE_URL = 'https://microbot.cloud';
const REQUEST_TIMEOUT_MS = 15000;

module.exports = function setupApiAuth(deps) {
    const { ipcMain, log, axios, fs, safeStorage, sessionFile } = deps;
    const baseUrl = (deps.baseUrl || process.env.MICROBOT_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

    let session = null;
    let restored = false;
    const listeners = new Set();

    const post = (endpoint, body) =>
        axios.post(`${baseUrl}/api/auth/${endpoint}`, body, { timeout: REQUEST_TIMEOUT_MS });

    const solveCaptcha = async () => {
        if (!deps.captcha) return { token: null };
        try {
            const { data } = await axios.get(`${baseUrl}/api/captcha/config`, { timeout: REQUEST_TIMEOUT_MS });
            if (!data?.siteKey) return { token: null };
        } catch (error) {
            if (error?.response?.status === 404) return { token: null };
            return { error: describeError(error, log, 'Could not start the human check.') };
        }
        const token = await deps.captcha(`${baseUrl}/api/captcha`);
        return token ? { token } : { error: 'Complete the human check to continue.' };
    };

    const canPersist = () => {
        try {
            if (!safeStorage?.isEncryptionAvailable()) return false;
            return safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
        } catch (error) {
            return false;
        }
    };

    const writeSession = (value) => {
        const previous = session;
        session = value;
        if (Boolean(previous) !== Boolean(value) || previous?.email !== value?.email) {
            listeners.forEach((listener) => listener(value ? { email: value.email } : null));
        }
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

    let refreshing = null;

    const refresh = () => {
        if (!refreshing) {
            refreshing = refreshSession().finally(() => {
                refreshing = null;
            });
        }
        return refreshing;
    };

    const refreshSession = async () => {
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
            const status = error?.response?.status;
            if (status && status < 500 && status !== 408 && status !== 429) {
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
        const captcha = await solveCaptcha();
        if (captcha.error) return { error: captcha.error };
        try {
            const { data } = await post('register', { email, password, captchaToken: captcha.token });
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
        const captcha = await solveCaptcha();
        if (captcha.error) return { error: captcha.error };
        try {
            await post('resend-verification', { email, captchaToken: captcha.token });
            return { success: true };
        } catch (error) {
            return { error: describeError(error, log, 'Could not send the verification email.') };
        }
    });

    ipcMain.handle('auth:request-password-reset', async (_event, payload) => {
        const { email } = credentials(payload);
        if (!email) return { error: 'Enter your email first.' };
        const captcha = await solveCaptcha();
        if (captcha.error) return { error: captcha.error };
        try {
            await post('request-password-reset', { email, captchaToken: captcha.token });
            return { success: true };
        } catch (error) {
            return { error: describeError(error, log, 'Could not send the reset email.') };
        }
    });

    const endOnServer = async (refreshToken) => {
        try {
            await post('logout', { refreshToken });
        } catch (error) {
            log.warn(`Could not end the session on the server: ${error?.message || error}`);
        }
    };

    const signOut = async () => {
        const current = session;
        writeSession(null);
        if (current) {
            await Promise.all(
                [current.refreshToken, current.dashboard?.refreshToken].filter(Boolean).map(endOnServer)
            );
        }
    };

    ipcMain.handle('auth:signout', async () => {
        await signOut();
        return { success: true };
    });

    ipcMain.handle('auth:changepw', async () => ({
        error: 'Use "Forgot password?" on the sign-in screen to change your password.'
    }));

    const send = (config, current) =>
        axios.request({
            method: config.method,
            url: `${baseUrl}${config.path}`,
            data: config.data,
            timeout: config.timeout || REQUEST_TIMEOUT_MS,
            headers: { Authorization: `Bearer ${current.accessToken}` }
        });

    const request = async (config) => {
        restore();
        if (refreshing) await refreshing;
        const current = session;
        if (!current) throw signedOutError();
        try {
            return await send(config, current);
        } catch (error) {
            if (error?.response?.status !== 401) throw error;
        }
        if (session === current) await refresh();
        if (!session) throw signedOutError();
        return send(config, session);
    };

    let forking = null;

    const forkDashboard = async (retry = true) => {
        const current = session;
        let tokens;
        try {
            const { data } = await post('fork-session', { refreshToken: current.refreshToken });
            tokens = { accessToken: data.token, refreshToken: data.refreshToken };
        } catch (error) {
            if (retry && error?.response?.status === 401) {
                if (session === current) await refresh();
                return session ? forkDashboard(false) : null;
            }
            log.warn(`Could not start a dashboard session: ${error?.message || error}`);
            return null;
        }
        if (session?.email !== current.email) {
            await endOnServer(tokens.refreshToken);
            return null;
        }
        if (session.dashboard) {
            await endOnServer(tokens.refreshToken);
            return session.dashboard;
        }
        writeSession({ ...session, dashboard: tokens });
        return tokens;
    };

    const dashboardTokens = async () => {
        restore();
        if (refreshing) await refreshing;
        if (!session) return null;
        if (session.dashboard) return session.dashboard;
        if (!forking) {
            forking = forkDashboard().finally(() => {
                forking = null;
            });
        }
        return forking;
    };

    const setDashboardTokens = (tokens) => {
        if (!session || !tokens?.accessToken || !tokens?.refreshToken) return;
        const stored = session.dashboard;
        if (stored?.accessToken === tokens.accessToken && stored?.refreshToken === tokens.refreshToken) return;
        writeSession({ ...session, dashboard: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken } });
    };

    const dashboardSignedOut = async () => {
        const current = session;
        const dashboard = current?.dashboard;
        if (!dashboard) return 'none';
        let alive = false;
        try {
            const { data } = await post('refresh-token', {
                accessToken: dashboard.accessToken,
                refreshToken: dashboard.refreshToken
            });
            alive = true;
            await endOnServer(data.refreshToken);
        } catch (error) {
            alive = false;
        }
        if (session !== current) return 'none';
        if (alive) {
            await signOut();
            return 'signed-out';
        }
        writeSession({ ...current, dashboard: undefined });
        return 'expired';
    };

    return {
        email: () => {
            restore();
            return session?.email || null;
        },
        request,
        onChange: (listener) => listeners.add(listener),
        dashboardTokens,
        setDashboardTokens,
        dashboardSignedOut
    };
};

function signedOutError() {
    return Object.assign(new Error('Not signed in'), { response: { status: 401 } });
}

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
