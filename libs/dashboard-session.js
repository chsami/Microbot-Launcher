const DEFAULT_DASHBOARD_URL = 'https://dashboard.microbot.cloud';
const PARTITION = 'persist:dashboard';
const ACCESS_COOKIE = 'auth-token';
const REFRESH_COOKIE = 'refresh-token';

module.exports = function setupDashboardSession(deps) {
    const { ipcMain, log, session: electronSession, auth, getWindow } = deps;
    const baseUrl = (deps.baseUrl || process.env.MICROBOT_DASHBOARD_URL || DEFAULT_DASHBOARD_URL).replace(/\/+$/, '');
    const cookieUrl = `${baseUrl}/`;
    const host = new URL(baseUrl).hostname;
    const cookies = electronSession.fromPartition(PARTITION).cookies;

    const send = (channel) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send(channel);
    };

    const setCookie = (name, value) =>
        cookies.set({ url: cookieUrl, name, value, path: '/', secure: true, sameSite: 'strict' });

    const writeCookies = async (tokens) => {
        await setCookie(ACCESS_COOKIE, tokens.accessToken);
        await setCookie(REFRESH_COOKIE, tokens.refreshToken);
    };

    const clearCookies = async () => {
        await Promise.all(
            [ACCESS_COOKIE, REFRESH_COOKIE].map((name) =>
                cookies.remove(cookieUrl, name).catch((error) => log.warn(`Could not clear ${name}: ${error?.message || error}`))
            )
        );
    };

    const readCookies = async () => {
        const list = await cookies.get({ url: cookieUrl });
        const value = (name) => list.find((cookie) => cookie.name === name)?.value || null;
        return { accessToken: value(ACCESS_COOKIE), refreshToken: value(REFRESH_COOKIE) };
    };

    let writing = Promise.resolve();
    let reconciling = null;
    let reconcileAgain = false;

    const reconcile = async () => {
        await writing;
        const { accessToken, refreshToken } = await readCookies();
        if (accessToken && refreshToken) {
            auth.setDashboardTokens({ accessToken, refreshToken });
            return;
        }
        if (refreshToken) return;
        const outcome = await auth.dashboardSignedOut();
        if (outcome === 'expired') send('dashboard:reload');
    };

    const scheduleReconcile = () => {
        if (reconciling) {
            reconcileAgain = true;
            return;
        }
        reconciling = reconcile()
            .catch((error) => log.warn(`Could not sync the dashboard session: ${error?.message || error}`))
            .finally(() => {
                reconciling = null;
                if (reconcileAgain) {
                    reconcileAgain = false;
                    scheduleReconcile();
                }
            });
    };

    cookies.on('changed', (_event, cookie) => {
        if (cookie.domain?.replace(/^\./, '') !== host) return;
        if (cookie.name !== ACCESS_COOKIE && cookie.name !== REFRESH_COOKIE) return;
        scheduleReconcile();
    });

    auth.onChange((user) => {
        if (!user) writing = writing.then(clearCookies);
        send('auth:changed');
    });

    ipcMain.handle('dashboard:open', async () => {
        const tokens = await auth.dashboardTokens();
        if (!tokens) return { url: null };
        const pending = writing.then(() => writeCookies(tokens));
        writing = pending.catch(() => {});
        try {
            await pending;
        } catch (error) {
            log.warn(`Could not hand the sign-in to the dashboard: ${error?.message || error}`);
            return { url: null };
        }
        return { url: `${baseUrl}/dashboard/` };
    });

    return { partition: PARTITION };
};
