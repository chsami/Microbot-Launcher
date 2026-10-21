const LINKS_PATH = '/api/alerts/client-links';
const REQUEST_TIMEOUT_MS = 8000;
const LABEL_MAX = 60;
const DEFAULT_PROFILE = 'default';
const TOKEN_PATTERN = /^mbc_[A-Za-z0-9_-]{43}$/;

module.exports = function setupClientAlerts(deps) {
    const { ipcMain, log, fs, safeStorage, auth, linksFile, settingsFile } = deps;

    const pending = new Map();

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

    const readLinks = (email) => {
        try {
            if (!canPersist() || !fs.existsSync(linksFile)) return {};
            const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(linksFile)));
            if (value?.email !== email || !value?.profiles || typeof value.profiles !== 'object') return {};
            return value.profiles;
        } catch (error) {
            log.warn(`Could not read alert links: ${error?.message || error}`);
            return {};
        }
    };

    const writeLinks = (email, profiles) => {
        try {
            fs.writeFileSync(linksFile, safeStorage.encryptString(JSON.stringify({ email, profiles })));
        } catch (error) {
            log.warn(`Could not save alert links: ${error?.message || error}`);
        }
    };

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
            data: { label: profile.slice(0, LABEL_MAX) },
            timeout: REQUEST_TIMEOUT_MS
        });
        if (!data?.id || !TOKEN_PATTERN.test(String(data?.token))) {
            throw new Error('The API returned an invalid alert link');
        }
        return { id: data.id, token: data.token };
    };

    const resolveToken = async (profile, email) => {
        const links = readLinks(email);
        const stored = links[profile];
        if (stored && TOKEN_PATTERN.test(String(stored.token))) {
            if (await linkStillActive(stored)) return stored.token;
            log.info(`Alert link for profile "${profile}" was revoked; creating a new one.`);
        }
        if (stored) {
            delete links[profile];
            writeLinks(email, links);
        }
        const created = await createLink(profile);
        writeLinks(email, { ...readLinks(email), [profile]: created });
        log.info(`Linked profile "${profile}" for bot alerts.`);
        return created.token;
    };

    const tokenForProfile = async (rawProfile) => {
        const profile = profileName(rawProfile);
        const email = signedInEmail();
        if (!email || !auth || !isEnabled(profile)) return null;
        if (!canPersist()) {
            log.info('Bot alerts need secure storage, which is not available; launching without alerts.');
            return null;
        }
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
        return pending.get(key);
    };

    ipcMain.handle('alerts:status', async (_event, names) => {
        const signedIn = Boolean(signedInEmail());
        const disabled = readDisabled();
        const enabled = {};
        (Array.isArray(names) ? names : []).forEach((name) => {
            const profile = profileName(name);
            enabled[profile] = !disabled.includes(profile);
        });
        return { signedIn, available: signedIn && canPersist(), enabled };
    });

    ipcMain.handle('alerts:set-enabled', async (_event, name, enabled) => {
        const profile = profileName(name);
        try {
            setEnabled(profile, Boolean(enabled));
            return { enabled: isEnabled(profile) };
        } catch (error) {
            log.warn(`Could not save alert settings: ${error?.message || error}`);
            return { error: 'Could not save the alert setting.', enabled: isEnabled(profile) };
        }
    });

    return { tokenForProfile };
};

function profileName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    return name || DEFAULT_PROFILE;
}
