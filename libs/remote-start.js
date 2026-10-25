const HEADER = 'X-Microbot-Launcher-Token';
const TOKEN_PATTERN = /^mbl_[A-Za-z0-9_-]{43}$/;
const SYNC_WAIT_SECONDS = 25;
const SYNC_TIMEOUT_MS = (SYNC_WAIT_SECONDS + 15) * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 5 * 60 * 1000;
const REPORT_ATTEMPTS = 3;
const MAX_NAME_LENGTH = 60;
const DEFAULT_NAME = 'Microbot Launcher';

module.exports = function setupRemoteStart(deps) {
    const {
        ipcMain,
        log,
        fs,
        safeStorage,
        axios,
        auth,
        alerts,
        background,
        launchProfile,
        listProxies,
        settingsFile,
        launcherFile,
        launcherName,
        version,
        notify
    } = deps;
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const retryMinMs = deps.retryMinMs || RETRY_MIN_MS;

    let enabled = readSettings().remoteStart === true;
    let generation = 0;
    let controller = null;
    let loop = null;

    function readSettings() {
        try {
            if (!fs.existsSync(settingsFile)) return {};
            const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (error) {
            log.warn(`Could not read launcher settings: ${error?.message || error}`);
            return {};
        }
    }

    const canPersist = () => {
        try {
            if (!safeStorage?.isEncryptionAvailable()) return false;
            return safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
        } catch (error) {
            return false;
        }
    };

    const signedInEmail = () => {
        try {
            return auth?.email() || null;
        } catch (error) {
            return null;
        }
    };

    const readStore = (email) => {
        try {
            if (!canPersist() || !fs.existsSync(launcherFile)) return null;
            const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(launcherFile)));
            return value?.email === email && TOKEN_PATTERN.test(String(value?.token)) ? value : null;
        } catch (error) {
            log.warn(`Could not read the launcher link: ${error?.message || error}`);
            return null;
        }
    };

    const writeStore = (value) => {
        fs.writeFileSync(launcherFile, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
        fs.chmodSync(launcherFile, 0o600);
    };

    const clearStore = () => {
        try {
            if (fs.existsSync(launcherFile)) fs.unlinkSync(launcherFile);
        } catch (error) {
            log.warn(`Could not remove the launcher link: ${error?.message || error}`);
        }
    };

    const register = async (email) => {
        const stored = readStore(email);
        if (stored) return stored;
        const name = (String(launcherName || '').replace(/[\u0000-\u001f]/g, '').trim() || DEFAULT_NAME).slice(0, MAX_NAME_LENGTH);
        const { data } = await auth.request({ method: 'post', path: '/api/launchers', data: { name }, timeout: REQUEST_TIMEOUT_MS });
        if (!data?.id || !TOKEN_PATTERN.test(String(data?.token))) throw new Error('The API returned an invalid launcher link');
        const created = { email, id: String(data.id), token: data.token };
        writeStore(created);
        log.info('Linked this launcher to the Microbot dashboard.');
        return created;
    };

    const linkedProfiles = () => {
        try {
            return alerts?.linkedProfiles() || {};
        } catch (error) {
            log.warn(`Could not read linked profiles: ${error?.message || error}`);
            return {};
        }
    };

    const report = () => {
        const linked = linkedProfiles();
        let choices = { proxies: [], suggested: {} };
        try {
            choices = listProxies();
        } catch (error) {
            log.warn(`Could not list proxies: ${error?.message || error}`);
        }
        return {
            version,
            clients: Object.entries(linked).map(([profile, clientLinkId]) => ({
                clientLinkId,
                suggestedProxyId: choices.suggested[profile] || null
            })),
            proxies: choices.proxies
        };
    };

    const sync = (store, startAllowed, signal) =>
        axios.post(
            `${auth.baseUrl}/api/launchers/sync?wait=${startAllowed ? SYNC_WAIT_SECONDS : 0}`,
            { startAllowed, ...report() },
            { headers: { [HEADER]: store.token }, timeout: startAllowed ? SYNC_TIMEOUT_MS : REQUEST_TIMEOUT_MS, signal }
        );

    const sendResult = async (store, startId, succeeded, reason) => {
        for (let attempt = 1; attempt <= REPORT_ATTEMPTS; attempt += 1) {
            try {
                await axios.post(
                    `${auth.baseUrl}/api/launchers/starts/${encodeURIComponent(startId)}/result`,
                    { succeeded, reason: reason || null },
                    { headers: { [HEADER]: store.token }, timeout: REQUEST_TIMEOUT_MS }
                );
                return;
            } catch (error) {
                const status = error?.response?.status;
                if (status && status < 500 && status !== 429) return;
                if (attempt < REPORT_ATTEMPTS) await sleep(retryMinMs * attempt);
            }
        }
        log.warn('Could not report a dashboard start result.');
    };

    const handleStart = async (store, command) => {
        const profile = Object.entries(linkedProfiles()).find(([, id]) => id === String(command.clientLinkId))?.[0];
        if (!enabled) {
            await sendResult(store, command.id, false, 'disabled');
            return;
        }
        if (!profile) {
            await sendResult(store, command.id, false, 'unknown-client');
            return;
        }
        log.info(`The dashboard asked to start profile "${profile}".`);
        notify?.('Starting a client from the dashboard', `Profile: ${profile}`);
        let outcome;
        try {
            outcome = await launchProfile(profile, { proxyId: command.proxyId || null });
        } catch (error) {
            outcome = { problem: { kind: 'launch-failed' } };
        }
        await sendResult(store, command.id, outcome?.started === true, outcome?.problem?.kind);
    };

    const runLoop = async (current) => {
        let delay = retryMinMs;
        while (current === generation) {
            const email = signedInEmail();
            if (!email || !enabled) return;
            let step = 'register';
            try {
                const store = await register(email);
                if (current !== generation) return;
                step = 'sync';
                controller = new AbortController();
                const { data } = await sync(store, true, controller.signal);
                (Array.isArray(data?.commands) ? data.commands : [])
                    .filter((command) => command?.type === 'start_client' && command.id)
                    .forEach((command) => {
                        handleStart(store, command).catch((error) =>
                            log.warn(`Could not handle a dashboard start: ${error?.message || error}`)
                        );
                    });
                delay = retryMinMs;
            } catch (error) {
                if (current !== generation) return;
                const status = error?.response?.status;
                if (status === 401 && step === 'sync') {
                    log.info('The dashboard no longer knows this launcher; linking it again.');
                    clearStore();
                } else if (status === 401) {
                    log.info('Microbot sign-in expired; stopped listening for dashboard starts.');
                    return;
                } else {
                    log.warn(`Dashboard start sync failed: ${error?.message || error}`);
                }
                await sleep(delay);
                delay = Math.min(delay * 2, RETRY_MAX_MS);
            }
        }
    };

    const start = () => {
        if (!enabled || !signedInEmail() || !canPersist()) return;
        generation += 1;
        loop = runLoop(generation).catch((error) => log.warn(`Dashboard start loop stopped: ${error?.message || error}`));
    };

    const stop = () => {
        generation += 1;
        controller?.abort();
        controller = null;
    };

    const announceOff = async () => {
        const email = signedInEmail();
        const store = email ? readStore(email) : null;
        if (!store) return;
        try {
            await sync(store, false);
        } catch (error) {
            log.warn(`Could not tell the dashboard starting is off: ${error?.message || error}`);
        }
    };

    const saveEnabled = (value) => {
        fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), remoteStart: value }, null, 2));
        enabled = value;
    };

    auth?.onChange((user) => {
        stop();
        if (user) start();
    });

    ipcMain.handle('remote-start:status', async () => ({
        enabled,
        signedIn: Boolean(signedInEmail()),
        available: canPersist()
    }));

    ipcMain.handle('remote-start:set-enabled', async (_event, value) => {
        const next = Boolean(value);
        try {
            if (next) {
                if (!signedInEmail()) return { error: 'Sign in to your Microbot account first.', enabled };
                if (!canPersist()) return { error: 'Your system has no secure storage, so this launcher cannot be linked.', enabled };
                const result = background?.enable() || {};
                if (result.error) return { error: result.error, enabled };
                saveEnabled(true);
                stop();
                start();
            } else {
                saveEnabled(false);
                stop();
                await announceOff();
            }
        } catch (error) {
            log.warn(`Could not save the dashboard start setting: ${error?.message || error}`);
            return { error: 'Could not save the setting.', enabled };
        }
        return { enabled };
    });

    return { start, stop, idle: () => loop };
};
