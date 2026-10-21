const LINKS_PATH = '/api/alerts/client-links';
const REQUEST_TIMEOUT_MS = 8000;
const STATUS_TIMEOUT_MS = 3000;
const LAUNCH_BUDGET_MS = 5000;
const LABEL_MAX = 60;
const DEFAULT_PROFILE = 'default';
const TOKEN_PATTERN = /^mbc_[A-Za-z0-9_-]{43}$/;

module.exports = function setupClientAlerts(deps) {
    const { ipcMain, log, fs, safeStorage, auth, linksFile, settingsFile } = deps;
    const launchBudgetMs = deps.launchBudgetMs || LAUNCH_BUDGET_MS;

    const pending = new Map();
    let revoking = Promise.resolve();

    const canPersist = () => {
        try {
            return Boolean(safeStorage?.isEncryptionAvailable());
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

    const readDisabled = () => {
        try {
            if (!fs.existsSync(settingsFile)) return [];
            const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            return Array.isArray(value?.disabled) ? value.disabled.filter((name) => typeof name === 'string') : [];
        } catch (error) {
            log.warn(`Could not read alert settings: ${error?.message || error}`);
            return [];
        }
    };

    const isEnabled = (profile) => !readDisabled().includes(profile);

    const setEnabled = (profile, enabled) => {
        const disabled = readDisabled().filter((name) => name !== profile);
        if (!enabled) disabled.push(profile);
        fs.writeFileSync(settingsFile, JSON.stringify({ disabled }, null, 2));
    };

    const readStore = (email) => {
        const empty = { profiles: {}, revoke: [] };
        try {
            if (!canPersist() || !fs.existsSync(linksFile)) return empty;
            const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(linksFile)));
            if (value?.email !== email || !value?.profiles || typeof value.profiles !== 'object') return empty;
            const revoke = Array.isArray(value.revoke) ? value.revoke.filter((id) => typeof id === 'string') : [];
            return { profiles: value.profiles, revoke };
        } catch (error) {
            log.warn(`Could not read alert links: ${error?.message || error}`);
            return empty;
        }
    };

    const writeStore = (email, { profiles, revoke }) => {
        try {
            fs.writeFileSync(linksFile, safeStorage.encryptString(JSON.stringify({ email, profiles, revoke })));
        } catch (error) {
            log.warn(`Could not save alert links: ${error?.message || error}`);
        }
    };

    const readLinks = (email) => readStore(email).profiles;

    const writeLinks = (email, profiles) => writeStore(email, { ...readStore(email), profiles });

    const linkStillActive = async (stored) => {
        try {
            const { data } = await auth.request({ method: 'get', path: LINKS_PATH, timeout: REQUEST_TIMEOUT_MS });
            if (!Array.isArray(data)) return true;
            const id = String(stored.id).toLowerCase();
            return data.some((link) => String(link?.id).toLowerCase() === id);
        } catch (error) {
            if (error?.response?.status === 401) throw error;
            log.warn(`Could not check the alert link: ${error?.message || error}`);
            return true;
        }
    };

    const createLink = async (profile) => {
        const { data } = await auth.request({
            method: 'post',
            path: LINKS_PATH,
            data: { label: defaultLabel(profile) },
            timeout: REQUEST_TIMEOUT_MS
        });
        if (!data?.id || !TOKEN_PATTERN.test(String(data?.token))) {
            throw new Error('The API returned an invalid alert link');
        }
        return { id: data.id, token: data.token, label: typeof data.label === 'string' ? data.label : defaultLabel(profile) };
    };

    const resolveToken = async (profile, email) => {
        const links = readLinks(email);
        const stored = links[profile];
        if (stored && TOKEN_PATTERN.test(String(stored.token))) {
            if (await linkStillActive(stored)) return stored.token;
            log.info(`Alert link for profile "${profile}" was revoked; creating a new one.`);
        }
        if (stored) {
            const current = readLinks(email);
            delete current[profile];
            writeLinks(email, current);
        }
        const created = await createLink(profile);
        writeLinks(email, { ...readLinks(email), [profile]: created });
        log.info(`Linked profile "${profile}" for bot alerts.`);
        return created.token;
    };

    const revokeQueued = async () => {
        const email = signedInEmail();
        if (!email || !auth || !canPersist()) return;
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

    const unlinkProfile = (profile) => {
        const email = signedInEmail();
        if (!email || !canPersist()) return;
        const store = readStore(email);
        const stored = store.profiles[profile];
        if (!stored) return;
        delete store.profiles[profile];
        const id = stored.id ? String(stored.id) : null;
        const revoke = id && !store.revoke.includes(id) ? [...store.revoke, id] : store.revoke;
        writeStore(email, { profiles: store.profiles, revoke });
        log.info(`Unlinked profile "${profile}" from bot alerts.`);
    };

    const linkLabels = async (email, profiles) => {
        const stored = email ? readLinks(email) : {};
        const labels = {};
        profiles.forEach((profile) => {
            const cached = stored[profile]?.label;
            labels[profile] = typeof cached === 'string' && cached ? cached : defaultLabel(profile);
        });
        const linked = profiles.filter((profile) => stored[profile]?.id);
        if (!linked.length || !auth) return labels;
        try {
            const { data } = await auth.request({ method: 'get', path: LINKS_PATH, timeout: STATUS_TIMEOUT_MS });
            if (!Array.isArray(data)) return labels;
            const byId = new Map(data.map((link) => [String(link?.id).toLowerCase(), link?.label]));
            const changed = {};
            linked.forEach((profile) => {
                const label = byId.get(String(stored[profile].id).toLowerCase());
                if (typeof label !== 'string' || !label) return;
                labels[profile] = label;
                if (label !== stored[profile].label) changed[profile] = label;
            });
            if (Object.keys(changed).length) {
                const current = readLinks(email);
                Object.entries(changed).forEach(([profile, label]) => {
                    if (current[profile]?.id === stored[profile].id) current[profile] = { ...current[profile], label };
                });
                writeLinks(email, current);
            }
        } catch (error) {
            log.warn(`Could not load alert link names: ${error?.message || error}`);
        }
        return labels;
    };

    const tokenForProfile = async (rawProfile) => {
        const profile = profileName(rawProfile);
        const email = signedInEmail();
        if (!email || !auth || !isEnabled(profile)) return null;
        if (!canPersist()) {
            log.info('Bot alerts need secure storage, which is not available; launching without alerts.');
            return null;
        }
        retryRevokes();
        const key = `${email}\n${profile}`;
        if (!pending.has(key)) {
            pending.set(
                key,
                resolveToken(profile, email)
                    .catch((error) => {
                        const status = error?.response?.status;
                        if (status === 401) {
                            log.info('Microbot sign-in expired; launching without alerts.');
                        } else {
                            log.warn(`Could not link profile "${profile}" for bot alerts: ${error?.message || error}`);
                        }
                        return null;
                    })
                    .finally(() => pending.delete(key))
            );
        }
        return withinBudget(pending.get(key), () => storedToken(email, profile));
    };

    const storedToken = (email, profile) => {
        const stored = readLinks(email)[profile];
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

    ipcMain.handle('alerts:status', async (_event, names) => {
        const email = signedInEmail();
        const signedIn = Boolean(email);
        const disabled = readDisabled();
        const enabled = {};
        const profiles = (Array.isArray(names) ? names : []).map(profileName);
        profiles.forEach((profile) => {
            enabled[profile] = !disabled.includes(profile);
        });
        const available = signedIn && canPersist();
        if (available) retryRevokes();
        const labels = await linkLabels(available ? email : null, profiles);
        return { signedIn, available, enabled, labels };
    });

    ipcMain.handle('alerts:set-enabled', async (_event, name, enabled) => {
        const profile = profileName(name);
        try {
            setEnabled(profile, Boolean(enabled));
        } catch (error) {
            log.warn(`Could not save alert settings: ${error?.message || error}`);
            return { error: 'Could not save the alert setting.', enabled: isEnabled(profile) };
        }
        if (!enabled) {
            unlinkProfile(profile);
            await retryRevokes();
        }
        return { enabled: isEnabled(profile), label: defaultLabel(profile) };
    });

    return { tokenForProfile, retryRevokes };
};

function defaultLabel(profile) {
    return profile.slice(0, LABEL_MAX);
}

function profileName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    return name || DEFAULT_PROFILE;
}
