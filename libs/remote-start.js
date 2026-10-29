const HEADER = 'X-Microbot-Launcher-Token';
const TOKEN_PATTERN = /^mbl_[A-Za-z0-9_-]{43}$/;
const SYNC_WAIT_SECONDS = 25;
const SYNC_TIMEOUT_MS = (SYNC_WAIT_SECONDS + 15) * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 5 * 60 * 1000;
const REPORT_ATTEMPTS = 3;
const MAX_NAME_LENGTH = 60;
const MAX_PROXIES = 100;
const MAX_CLIENTS = 50;
const MAX_LABEL_LENGTH = 80;
const MIN_SYNC_GAP_MS = 2000;
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
        launchAccount,
        launchOptions,
        listProxies,
        startOptions,
        settingsFile,
        launcherFile,
        launcherName,
        version,
        notify
    } = deps;
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const retryMinMs = deps.retryMinMs || RETRY_MIN_MS;

    let owner = ownerFrom(readSettings());
    let generation = 0;
    let controller = null;
    let loop = null;

    function ownerFrom(settings) {
        return typeof settings.remoteStartFor === 'string' && settings.remoteStartFor ? settings.remoteStartFor : null;
    }

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

    const isOn = () => owner !== null && owner === signedInEmail();

    const register = async (email, current) => {
        const stored = readStore(email);
        if (stored) return stored;
        const name = (String(launcherName || '').replace(/[\u0000-\u001f]/g, '').trim() || DEFAULT_NAME).slice(0, MAX_NAME_LENGTH);
        const { data } = await auth.request({ method: 'post', path: '/api/launchers', data: { name }, timeout: REQUEST_TIMEOUT_MS });
        if (!data?.id || !TOKEN_PATTERN.test(String(data?.token))) throw new Error('The API returned an invalid launcher link');
        if (current !== generation) return null;
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

    const readChoices = () => {
        try {
            const choices = listProxies();
            return {
                proxies: Array.isArray(choices?.proxies) ? choices.proxies : [],
                suggested: choices?.suggested || {},
                accounts: Array.isArray(choices?.accounts) ? choices.accounts : []
            };
        } catch (error) {
            log.warn(`Could not list proxies: ${error?.message || error}`);
            return { proxies: [], suggested: {}, accounts: [] };
        }
    };

    const linkedAccounts = (accounts) => {
        try {
            return alerts?.linkedAccounts?.(accounts) || {};
        } catch (error) {
            log.warn(`Could not read linked accounts: ${error?.message || error}`);
            return {};
        }
    };

    const report = async () => {
        const linked = linkedProfiles();
        const choices = readChoices();
        const accountLinks = linkedAccounts(choices.accounts);
        const clients = [
            ...choices.accounts
                .filter((account) => accountLinks[account.accountId])
                .map((account) => ({ clientLinkId: accountLinks[account.accountId], suggestedProxyId: account.proxyId || null })),
            ...Object.entries(linked).map(([profile, clientLinkId]) => ({
                clientLinkId,
                suggestedProxyId: choices.suggested[profile] || null
            }))
        ];
        const body = {
            version,
            clients: clients.slice(0, MAX_CLIENTS),
            proxies: choices.proxies.slice(0, MAX_PROXIES).map((proxy) => ({ id: proxy.id, label: String(proxy.label).slice(0, MAX_LABEL_LENGTH) }))
        };
        if (startOptions) {
            try {
                body.startOptions = await startOptions(linked, body.proxies, accountLinks);
            } catch (error) {
                log.warn(`Could not list the start options: ${error?.message || error}`);
            }
        }
        return body;
    };

    const sync = async (store, startAllowed, signal) =>
        axios.post(
            `${auth.baseUrl}/api/launchers/sync?wait=${startAllowed ? SYNC_WAIT_SECONDS : 0}`,
            { startAllowed, ...(await report()) },
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

    const announce = ({ profile, account }) => {
        log.info(`The dashboard asked to start profile "${profile}" ${account ? 'with a Jagex account' : 'without a Jagex account'}.`);
        try {
            notify?.('Starting a client from the dashboard', account ? `${account} on profile ${profile}` : `Profile: ${profile}`);
        } catch (error) {
            log.warn(`Could not show the start notification: ${error?.message || error}`);
        }
    };

    const findLinked = (clientLinkId) => {
        const id = String(clientLinkId);
        const profile = Object.entries(linkedProfiles()).find(([, linkId]) => linkId === id)?.[0];
        if (profile) return { profile };
        if (!launchAccount) return null;
        const accountLinks = linkedAccounts(readChoices().accounts);
        const accountId = Object.entries(accountLinks).find(([, linkId]) => linkId === id)?.[0];
        return accountId ? { accountId } : null;
    };

    const handleOptionsStart = async (store, command) => {
        if (!isOn()) {
            await sendResult(store, command.id, false, 'disabled');
            return;
        }
        if (!launchOptions) {
            await sendResult(store, command.id, false, 'unknown-option');
            return;
        }
        let outcome;
        try {
            outcome = await launchOptions(command.options, {
                stillWanted: () => isOn() && signedInEmail() === store.email,
                onAccepted: announce
            });
        } catch (error) {
            outcome = { problem: { kind: 'launch-failed' } };
        }
        if (outcome?.problem?.kind === 'unknown-option') log.warn(`Refused a dashboard start: ${outcome.problem.message}`);
        await sendResult(store, command.id, outcome?.started === true, outcome?.problem?.kind);
    };

    const handleStart = async (store, command) => {
        if (command.options != null) {
            await handleOptionsStart(store, command);
            return;
        }
        const target = findLinked(command.clientLinkId);
        if (!isOn()) {
            await sendResult(store, command.id, false, 'disabled');
            return;
        }
        if (!target) {
            await sendResult(store, command.id, false, 'unknown-client');
            return;
        }
        const stillWanted = () => isOn() && signedInEmail() === store.email;
        let outcome;
        try {
            if (target.accountId) {
                outcome = await launchAccount(target.accountId, { proxyId: command.proxyId || null, stillWanted, onAccepted: announce });
            } else {
                log.info(`The dashboard asked to start profile "${target.profile}".`);
                notify?.('Starting a client from the dashboard', `Profile: ${target.profile}`);
                outcome = await launchProfile(target.profile, { proxyId: command.proxyId || null, stillWanted });
            }
        } catch (error) {
            outcome = { problem: { kind: 'launch-failed' } };
        }
        await sendResult(store, command.id, outcome?.started === true, outcome?.problem?.kind);
    };

    const runLoop = async (current) => {
        let delay = retryMinMs;
        while (current === generation) {
            const email = signedInEmail();
            if (!email || owner !== email) return;
            let step = 'register';
            try {
                const store = await register(email, current);
                if (!store || current !== generation) return;
                step = 'sync';
                controller = new AbortController();
                const syncStarted = Date.now();
                const { data } = await sync(store, true, controller.signal);
                if (current !== generation) return;
                const commands = Array.isArray(data?.commands) ? data.commands : [];
                commands
                    .filter((command) => command?.type === 'start_client' && command.id)
                    .forEach((command) => {
                        handleStart(store, command).catch((error) =>
                            log.warn(`Could not handle a dashboard start: ${error?.message || error}`)
                        );
                    });
                delay = retryMinMs;
                const elapsed = Date.now() - syncStarted;
                if (commands.length === 0 && elapsed < MIN_SYNC_GAP_MS) await sleep(MIN_SYNC_GAP_MS - elapsed);
            } catch (error) {
                if (current !== generation) return;
                const status = error?.response?.status;
                if (status === 401 && step === 'sync') {
                    log.info('This launcher was removed from the dashboard; turned dashboard starts off.');
                    clearStore();
                    turnOff();
                    notify?.('Dashboard starts turned off', 'This launcher was removed from the Microbot dashboard.');
                    return;
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
        if (!isOn() || !canPersist()) return;
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

    const saveOwner = (email) => {
        fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), remoteStartFor: email }, null, 2));
        owner = email;
    };

    const turnOff = () => {
        try {
            saveOwner(null);
        } catch (error) {
            log.warn(`Could not save the dashboard start setting: ${error?.message || error}`);
            owner = null;
        }
    };

    background?.onDisabled?.(() => {
        if (owner === null) return;
        const wasOn = isOn();
        turnOff();
        stop();
        if (!wasOn) return;
        log.info('Dashboard starts were turned off because the launcher no longer keeps running in the tray.');
        announceOff().catch(() => {});
    });

    auth?.onChange((user) => {
        stop();
        if (user) start();
    });

    ipcMain.handle('remote-start:status', async () => ({
        enabled: isOn(),
        signedIn: Boolean(signedInEmail()),
        available: canPersist()
    }));

    ipcMain.handle('remote-start:set-enabled', async (_event, value) => {
        const next = Boolean(value);
        try {
            if (next) {
                if (!signedInEmail()) return { error: 'Sign in to your Microbot account first.', enabled: false };
                if (!canPersist()) return { error: 'Your system has no secure storage, so this launcher cannot be linked.', enabled: false };
                const result = background?.enable() || {};
                if (result.error) return { error: result.error, enabled: isOn() };
                saveOwner(signedInEmail());
                stop();
                start();
            } else {
                const wasOn = isOn();
                saveOwner(null);
                stop();
                if (wasOn) await announceOff();
            }
        } catch (error) {
            log.warn(`Could not save the dashboard start setting: ${error?.message || error}`);
            return { error: 'Could not save the setting.', enabled: isOn() };
        }
        return { enabled: isOn() };
    });

    return { start, stop, idle: () => loop };
};
