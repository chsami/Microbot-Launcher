const LINKS_PATH = '/api/alerts/client-links';
const LIST_PATH = `${LINKS_PATH}?includeHidden=true`;
const REQUEST_TIMEOUT_MS = 8000;
const LAUNCH_BUDGET_MS = 5000;
const DEFAULT_LABEL = 'Microbot client';
const DEFAULT_PROFILE = 'default';
const TOKEN_PATTERN = /^mbc_[A-Za-z0-9_-]{43}$/;
const MAX_LABEL_LENGTH = 60;
const MAX_ACCOUNT_ID_LENGTH = 128;
const LOADER_LABEL = 'RuneLite (Microbot Loader)';
const LOADER_KEY = 'runelite';
const LOADER_SLOT = { kind: 'loader', key: LOADER_KEY, profile: null, label: LOADER_LABEL };

module.exports = function setupClientAlerts(deps) {
    const { ipcMain, log, fs, safeStorage, auth, linksFile, settingsFile, accountsFile } = deps;
    const launchBudgetMs = deps.launchBudgetMs || LAUNCH_BUDGET_MS;

    const pending = new Map();
    let revoking = Promise.resolve();

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

    const readSettings = () => {
        try {
            if (!fs.existsSync(settingsFile)) return {};
            const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (error) {
            log.warn(`Could not read alert settings: ${error?.message || error}`);
            return {};
        }
    };

    const writeSettings = ({ disabled, accounts, accountsMigrated }) => {
        fs.writeFileSync(settingsFile, JSON.stringify({ disabled, accounts, accountsMigrated }, null, 2));
    };

    const readAccountProfiles = () => {
        if (!accountsFile) return null;
        try {
            if (!fs.existsSync(accountsFile)) return [];
            const value = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
            if (!Array.isArray(value)) return null;
            return value.filter((account) => isAccountId(account?.accountId));
        } catch (error) {
            log.warn(`Could not read the Jagex accounts for their dashboard switches: ${error?.message || error}`);
            return null;
        }
    };

    const migrateAccounts = (state) => {
        const known = readAccountProfiles();
        if (!known) return state;
        known.forEach((account) => {
            if (!hasOwn(state.accounts, account.accountId)) {
                state.accounts[account.accountId] = !state.disabled.includes(profileName(account.profile));
            }
        });
        const migrated = { ...state, accountsMigrated: true };
        try {
            writeSettings(migrated);
        } catch (error) {
            log.warn(`Could not save alert settings: ${error?.message || error}`);
        }
        return migrated;
    };

    const settings = () => {
        const value = readSettings();
        const disabled = Array.isArray(value.disabled) ? value.disabled.filter((name) => typeof name === 'string') : [];
        const accounts = Object.create(null);
        if (value.accounts && typeof value.accounts === 'object' && !Array.isArray(value.accounts)) {
            Object.keys(value.accounts).forEach((accountId) => {
                if (typeof value.accounts[accountId] === 'boolean') accounts[accountId] = value.accounts[accountId];
            });
        }
        const state = { disabled, accounts, accountsMigrated: value.accountsMigrated === true };
        return state.accountsMigrated ? state : migrateAccounts(state);
    };

    const readDisabled = () => settings().disabled;

    const accountOn = (state, accountId, profile) => {
        if (hasOwn(state.accounts, accountId)) return state.accounts[accountId];
        return state.accountsMigrated || !state.disabled.includes(profile);
    };

    const isAccountEnabled = (accountId, profile) => accountOn(settings(), accountId, profile);

    const setAccountEnabled = (accountId, enabled) => {
        const state = settings();
        state.accounts[accountId] = enabled;
        writeSettings(state);
    };

    const slotEnabled = (slot) => slot.kind === 'loader' || isAccountEnabled(slot.key, slot.profile);

    const readStore = (email) => {
        const empty = { profiles: {}, accounts: {}, loader: {}, revoke: [] };
        try {
            if (!canPersist() || !fs.existsSync(linksFile)) return empty;
            const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(linksFile)));
            if (value?.email !== email || !value?.profiles || typeof value.profiles !== 'object') return empty;
            const revoke = Array.isArray(value.revoke) ? value.revoke.filter((id) => typeof id === 'string') : [];
            const accounts = value.accounts && typeof value.accounts === 'object' && !Array.isArray(value.accounts) ? value.accounts : {};
            const loader = value.loader && typeof value.loader === 'object' && !Array.isArray(value.loader) ? value.loader : {};
            return { profiles: value.profiles, accounts, loader, revoke };
        } catch (error) {
            log.warn(`Could not read alert links: ${error?.message || error}`);
            return empty;
        }
    };

    const writeStore = (email, { profiles, accounts = {}, loader = {}, revoke }) => {
        if (!canPersist()) return;
        const value = { email, profiles, accounts, revoke };
        if (Object.keys(loader).length) value.loader = loader;
        try {
            fs.writeFileSync(linksFile, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
            fs.chmodSync(linksFile, 0o600);
        } catch (error) {
            log.warn(`Could not save alert links: ${error?.message || error}`);
        }
    };

    const readEntry = (email, slot) => ownEntry(readStore(email)[slot.kind], slot.key);

    const writeEntry = (email, slot, entry) => {
        const store = readStore(email);
        const links = { ...store[slot.kind] };
        if (entry) links[slot.key] = entry;
        else delete links[slot.key];
        writeStore(email, { ...store, [slot.kind]: links });
    };

    const linkStillActive = async (stored) => {
        try {
            const { data } = await auth.request({ method: 'get', path: LIST_PATH, timeout: REQUEST_TIMEOUT_MS });
            if (!Array.isArray(data)) return true;
            const id = String(stored.id).toLowerCase();
            return data.some((link) => String(link?.id).toLowerCase() === id);
        } catch (error) {
            if (error?.response?.status === 401) throw error;
            log.warn(`Could not check the alert link: ${error?.message || error}`);
            return true;
        }
    };

    const nextLabel = (email) => {
        const store = readStore(email);
        const used = new Set([...Object.values(store.profiles), ...Object.values(store.accounts)].map((link) => link?.label));
        if (!used.has(DEFAULT_LABEL)) return DEFAULT_LABEL;
        let number = 2;
        while (used.has(`${DEFAULT_LABEL} ${number}`)) number += 1;
        return `${DEFAULT_LABEL} ${number}`;
    };

    const createLink = async (email, wanted) => {
        const label = wanted || nextLabel(email);
        const { data } = await auth.request({
            method: 'post',
            path: LINKS_PATH,
            data: { label },
            timeout: REQUEST_TIMEOUT_MS
        });
        if (!data?.id || !TOKEN_PATTERN.test(String(data?.token))) {
            throw new Error('The API returned an invalid alert link');
        }
        return { id: data.id, token: data.token, label: typeof data.label === 'string' ? data.label : label };
    };

    const adoptProfileLink = (email, slot) => {
        if (slot.kind !== 'accounts') return;
        const store = readStore(email);
        if (ownEntry(store.accounts, slot.key)) return;
        const legacy = ownEntry(store.profiles, slot.profile);
        if (!legacy?.id || legacy.noJagex) return;
        const profiles = { ...store.profiles };
        delete profiles[slot.profile];
        const adopted = { id: legacy.id, token: legacy.token, label: legacy.label, profile: slot.profile };
        if (slot.label) adopted.renameTo = slot.label;
        writeStore(email, { ...store, profiles, accounts: { ...store.accounts, [slot.key]: adopted } });
        log.info(`The alert link of profile "${slot.profile}" now belongs to the Jagex account launched on it.`);
    };

    const renameAdopted = async (email, slot, entry) => {
        let label = entry.renameTo;
        try {
            const { data } = await auth.request({
                method: 'patch',
                path: `${LINKS_PATH}/${encodeURIComponent(entry.id)}`,
                data: { label },
                timeout: REQUEST_TIMEOUT_MS
            });
            if (typeof data?.label === 'string' && data.label) label = data.label;
        } catch (error) {
            const status = error?.response?.status;
            if (!status || status >= 500 || status === 401 || status === 429) {
                log.warn(`Could not rename the alert link; will retry at the next launch: ${error?.message || error}`);
                return;
            }
            log.warn(`The dashboard refused the new alert link name; keeping the old one: ${error?.message || error}`);
            label = entry.label;
        }
        const current = readEntry(email, slot);
        if (current?.id !== entry.id) return;
        const { renameTo, ...rest } = current;
        writeEntry(email, slot, { ...rest, label });
    };

    const keepEntryCurrent = async (email, slot, entry) => {
        if (slot.kind !== 'accounts') return;
        if (entry.profile !== slot.profile) writeEntry(email, slot, { ...entry, profile: slot.profile });
        if (typeof entry.renameTo === 'string' && entry.renameTo) await renameAdopted(email, slot, readEntry(email, slot));
    };

    const resolveToken = async (slot, email) => {
        adoptProfileLink(email, slot);
        const stored = readEntry(email, slot);
        if (stored && TOKEN_PATTERN.test(String(stored.token))) {
            const active = await linkStillActive(stored);
            if (!slotEnabled(slot)) return null;
            const current = readEntry(email, slot);
            if (active && current?.id === stored.id) {
                await keepEntryCurrent(email, slot, current);
                return stored.token;
            }
            if (!active) log.info(`The alert link for ${describe(slot)} was revoked; creating a new one.`);
        }
        if (stored && readEntry(email, slot)?.id === stored.id) writeEntry(email, slot, null);
        const created = await createLink(email, slot.label);
        writeEntry(email, slot, newEntry(slot, created));
        if (!slotEnabled(slot)) {
            log.info(`The dashboard switch for ${describe(slot)} was turned off while it was being linked; keeping the link for later.`);
            return null;
        }
        log.info(`Linked ${describe(slot)} for bot alerts.`);
        return created.token;
    };

    // Links made by clients started without an account can never start again, so revoke them.
    const queueNoJagexLinks = (email) => {
        const store = readStore(email);
        const dead = Object.entries(store.profiles).filter(([, link]) => link?.noJagex);
        if (!dead.length) return;
        const profiles = { ...store.profiles };
        dead.forEach(([profile]) => delete profiles[profile]);
        const ids = dead.filter(([, link]) => link.id).map(([, link]) => String(link.id));
        writeStore(email, { ...store, profiles, revoke: [...store.revoke.filter((id) => !ids.includes(id)), ...ids] });
        log.info(`Removing ${dead.length} alert link(s) made by clients started without a Jagex account.`);
    };

    const revokeQueued = async () => {
        const email = signedInEmail();
        if (!email || !auth || !canPersist()) return;
        queueNoJagexLinks(email);
        for (const id of readStore(email).revoke) {
            try {
                await auth.request({ method: 'delete', path: `${LINKS_PATH}/${encodeURIComponent(id)}`, timeout: REQUEST_TIMEOUT_MS });
            } catch (error) {
                if (error?.response?.status !== 404) {
                    log.warn(`Could not revoke an alert link; will retry later: ${error?.message || error}`);
                    return;
                }
            }
            const current = readStore(email);
            writeStore(email, { ...current, revoke: current.revoke.filter((queued) => queued !== id) });
        }
    };

    const retryRevokes = () => {
        revoking = revoking.then(revokeQueued, revokeQueued);
        return revoking;
    };

    const tokenForLaunch = async (rawProfile, account) => {
        const profile = profileName(rawProfile);
        const email = signedInEmail();
        if (!email || !auth) return null;
        // Clients only start with a Jagex account, so only accounts get an alert link.
        if (!isAccountId(account?.accountId)) return null;
        const slot = { kind: 'accounts', key: account.accountId, profile, label: accountLabel(account) };
        if (!slotEnabled(slot)) return null;
        if (!canPersist()) {
            log.info('Bot alerts need secure storage, which is not available; launching without alerts.');
            return null;
        }
        retryRevokes();
        const key = `${email}\n${slot.kind}\n${slot.key}`;
        if (!pending.has(key)) {
            pending.set(
                key,
                resolveToken(slot, email)
                    .catch((error) => {
                        const status = error?.response?.status;
                        if (status === 401) {
                            log.info('Microbot sign-in expired; launching without alerts.');
                        } else {
                            log.warn(`Could not link ${describe(slot)} for bot alerts: ${error?.message || error}`);
                        }
                        return null;
                    })
                    .finally(() => pending.delete(key))
            );
        }
        return withinBudget(pending.get(key), () => storedToken(email, slot));
    };

    const revokeUnsavedLoaderLinks = async () => {
        let links;
        try {
            const { data } = await auth.request({ method: 'get', path: LIST_PATH, timeout: REQUEST_TIMEOUT_MS });
            links = Array.isArray(data) ? data : [];
        } catch (error) {
            if (error?.response?.status === 401) throw error;
            log.warn(`Could not list the client links to clear old RuneLite links: ${error?.message || error}`);
            return;
        }
        for (const link of links.filter((entry) => entry?.id && entry.label === LOADER_LABEL)) {
            try {
                await auth.request({ method: 'delete', path: `${LINKS_PATH}/${encodeURIComponent(link.id)}`, timeout: REQUEST_TIMEOUT_MS });
            } catch (error) {
                if (error?.response?.status === 401) throw error;
                if (error?.response?.status !== 404) log.warn(`Could not revoke an old RuneLite link: ${error?.message || error}`);
            }
        }
    };

    const replaceUnsavedLoaderLink = async (email) => {
        log.info('Secure storage is not available, so the RuneLite link is not saved on this PC; replacing any earlier one.');
        await revokeUnsavedLoaderLinks();
        return (await createLink(email, LOADER_LABEL)).token;
    };

    const tokenForLoader = async () => {
        const email = signedInEmail();
        if (!email || !auth) throw signedOutError();
        const persist = canPersist();
        if (persist) retryRevokes();
        const key = `${email}\n${LOADER_SLOT.kind}\n${LOADER_SLOT.key}`;
        if (!pending.has(key)) {
            const work = persist ? resolveToken(LOADER_SLOT, email) : replaceUnsavedLoaderLink(email);
            pending.set(key, work.finally(() => pending.delete(key)));
        }
        const token = await pending.get(key);
        if (!token) throw new Error('No client link was created for RuneLite');
        return token;
    };

    const forgetLoaderToken = async () => {
        const email = signedInEmail();
        if (!email || !auth) return;
        if (!canPersist()) {
            await revokeUnsavedLoaderLinks();
            log.info('Unlinked Microbot in RuneLite from the dashboard.');
            return;
        }
        const store = readStore(email);
        const entry = ownEntry(store.loader, LOADER_KEY);
        if (!entry) return;
        const loader = { ...store.loader };
        delete loader[LOADER_KEY];
        const revoke = entry.id ? [...store.revoke.filter((id) => id !== String(entry.id)), String(entry.id)] : store.revoke;
        writeStore(email, { ...store, loader, revoke });
        log.info('Unlinked Microbot in RuneLite from the dashboard.');
        await retryRevokes();
    };

    const storedToken = (email, slot) => {
        const stored = readEntry(email, slot);
        return stored && TOKEN_PATTERN.test(String(stored.token)) ? stored.token : null;
    };

    const withinBudget = (work, fallback) => {
        let timer = null;
        const deadline = new Promise((resolve) => {
            timer = setTimeout(() => {
                log.warn('The Microbot API is slow to answer; launching with the alert link saved on this PC, if any.');
                resolve(fallback());
            }, launchBudgetMs);
        });
        return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
    };

    ipcMain.handle('alerts:accounts', async (_event, accountIds) => {
        const email = signedInEmail();
        const signedIn = Boolean(email);
        const state = settings();
        const ids = (Array.isArray(accountIds) ? accountIds : []).filter(isAccountId);
        const known = readAccountProfiles() || [];
        const enabled = Object.fromEntries(ids.map((accountId) => [accountId, accountOn(state, accountId, accountProfile(known, accountId))]));
        return { signedIn, available: signedIn && Boolean(auth) && canPersist(), enabled };
    });

    ipcMain.handle('alerts:set-account-enabled', async (_event, accountId, enabled) => {
        if (!isAccountId(accountId)) return { error: 'That Jagex account could not be found.' };
        try {
            setAccountEnabled(accountId, Boolean(enabled));
        } catch (error) {
            log.warn(`Could not save alert settings: ${error?.message || error}`);
            return { error: 'Could not save the dashboard setting.', enabled: isAccountEnabled(accountId, accountProfile(readAccountProfiles() || [], accountId)) };
        }
        return { enabled: isAccountEnabled(accountId, DEFAULT_PROFILE) };
    });

    const linkedProfiles = () => {
        const email = signedInEmail();
        if (!email || !canPersist()) return {};
        const disabled = readDisabled();
        // Only a Jagex account can start a client, so a profile no account uses has nothing to start.
        const used = new Set((readAccountProfiles() || []).map((account) => profileName(account.profile)));
        const linked = {};
        Object.entries(readStore(email).profiles).forEach(([profile, link]) => {
            if (link?.id && !link.noJagex && used.has(profile) && !disabled.includes(profile)) linked[profile] = String(link.id);
        });
        return linked;
    };

    const linkedAccounts = (accounts) => {
        const email = signedInEmail();
        if (!email || !canPersist()) return {};
        const stored = readStore(email).accounts;
        const state = settings();
        const linked = {};
        (Array.isArray(accounts) ? accounts : []).forEach((account) => {
            const link = isAccountId(account?.accountId) ? ownEntry(stored, account.accountId) : null;
            if (link?.id && accountOn(state, account.accountId, profileName(account.profile))) linked[account.accountId] = String(link.id);
        });
        return linked;
    };

    return { tokenForLaunch, tokenForLoader, forgetLoaderToken, retryRevokes, linkedProfiles, linkedAccounts };
};

function hasOwn(object, key) {
    return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function ownEntry(links, key) {
    return hasOwn(links, key) ? links[key] : undefined;
}

function accountProfile(accounts, accountId) {
    return profileName(accounts.find((account) => account.accountId === accountId)?.profile);
}

function isAccountId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ACCOUNT_ID_LENGTH;
}

function signedOutError() {
    return Object.assign(new Error('Not signed in'), { response: { status: 401 } });
}

function newEntry(slot, created) {
    return slot.kind === 'loader' ? created : { ...created, profile: slot.profile };
}

function describe(slot) {
    if (slot.kind === 'loader') return 'Microbot in RuneLite';
    return `the Jagex account on profile "${slot.profile}"`;
}

function accountLabel(account) {
    const name = typeof account?.displayName === 'string' ? account.displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    return name ? name.slice(0, MAX_LABEL_LENGTH) : null;
}

function profileName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    return name || DEFAULT_PROFILE;
}
