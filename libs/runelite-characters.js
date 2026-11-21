const path = require('path');
const { orderAccounts } = require('./accounts-loader.js');
const { parseProxyEndpoint } = require('./proxy-choices.js');
const { refreshSession, sessionExpired } = require('./jagex-session.js');
const credentials = require('./overwrite-credential-properties.js');

const CHARACTER_KEY = 'runeliteCharacter';
const SESSION_TIMEOUT_MS = 20000;
const REQUEST_TIMEOUT_MS = 15000;

const MESSAGES = {
    expired: (name) => `${name}'s Jagex login has expired. Press Log in again, then press Open RuneLite.`,
    unchecked: (name, host) =>
        host
            ? `Couldn't check ${name}'s Jagex login through ${host}. Check that the proxy works, or choose None to log in inside RuneLite.`
            : `Couldn't check ${name}'s Jagex login. Check your connection, or choose None to log in inside RuneLite.`,
    notSaved: (name) => `${name}'s login could not be saved for RuneLite. Check that the .runelite folder in your home folder is writable, then try again.`,
    unknown: 'That character is no longer in the launcher. Add its Jagex account again, or choose None.',
    notChosen: "Couldn't save which character to log in as. Pick it again.",
    settings: "The launcher settings file (launcher-settings.json) can't be read, so the launcher doesn't know which character to log in as. Fix or delete that file in the .microbot folder, then try again.",
    loginOpen: 'A Jagex login is already open in your browser.',
    notIncluded: (name) => `That login didn't include ${name}. Log in to the Jagex account that has ${name}.`,
    loginFailed: 'The Jagex login did not finish. Try again.'
};

function withinTime(promise, ms) {
    let timer = null;
    const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, timedOut: true }), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

function proxyHost(proxyIp) {
    if (typeof proxyIp !== 'string' || !proxyIp.trim()) return null;
    const endpoint = parseProxyEndpoint(proxyIp);
    return { host: endpoint ? endpoint.host : null };
}

function byName(a, b) {
    const nameA = (a?.displayName || a?.accountId || '').toString().trim().toLowerCase();
    const nameB = (b?.displayName || b?.accountId || '').toString().trim().toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
}

module.exports = function setupRuneliteCharacters(deps) {
    const { fs, log, microbotDir, home, readSettings, writeSetting, settingsFile } = deps;
    const accountsFile = path.join(microbotDir, 'accounts.json');
    const propertiesFile = path.join(microbotDir, 'resource_versions.json');
    const credentialDeps = { fs, path, homeDir: home, settingsFile, log };
    const sessionTimeoutMs = deps.sessionTimeoutMs || SESSION_TIMEOUT_MS;
    const onChecking = deps.onChecking || (() => {});
    const focusWindow = deps.focusWindow || (() => {});
    let loginRunning = false;

    const checkSession =
        deps.checkSession ||
        ((account) => {
            const { writeAccountsToFile } = require('./oauth-jagex.js');
            return refreshSession({ writeAccountsToFile, log }, account.sessionId, account.proxyIp, { timeoutMs: REQUEST_TIMEOUT_MS });
        });

    const auth = () => deps.auth || require('./oauth-jagex.js');

    const readAccounts = () => {
        try {
            if (!fs.existsSync(accountsFile)) return [];
            const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
            return Array.isArray(accounts) ? orderAccounts(accounts).filter((account) => account.accountId) : [];
        } catch (error) {
            log.warn(`Could not read the Jagex accounts for Microbot in RuneLite: ${error?.message || error}`);
            return [];
        }
    };

    const find = (accounts, id) => accounts.find((account) => String(account.accountId) === id) || null;

    const fileLogin = () => {
        try {
            return credentials.readCredentialLogin(credentialDeps);
        } catch (error) {
            return null;
        }
    };

    const fileCharacter = (accounts) => {
        const id = fileLogin()?.characterId;
        return id && find(accounts, id) ? id : null;
    };

    const rawAccounts = () => {
        try {
            const value = fs.existsSync(accountsFile) ? JSON.parse(fs.readFileSync(accountsFile, 'utf8')) : [];
            return Array.isArray(value) ? value : [];
        } catch (error) {
            return [];
        }
    };

    const proxiesSaved = () => {
        let properties = {};
        try {
            if (fs.existsSync(propertiesFile)) properties = JSON.parse(fs.readFileSync(propertiesFile, 'utf8')) || {};
        } catch (error) {
            properties = {};
        }
        const addresses = [
            ...(Array.isArray(properties.proxies) ? properties.proxies.map((entry) => entry?.address) : []),
            properties.proxyip,
            ...rawAccounts().map((account) => account?.proxyIp)
        ];
        return addresses.some((address) => typeof address === 'string' && address.trim() && parseProxyEndpoint(address));
    };

    const list = () => {
        const accounts = readAccounts();
        const settings = readSettings() || {};
        const saved = settings[CHARACTER_KEY];
        const picked = saved === null || typeof saved === 'string';
        const known = typeof saved === 'string' && find(accounts, saved);
        return {
            characters: [...accounts].sort(byName).map((account) => ({
                accountId: String(account.accountId),
                displayName: String(account.displayName),
                proxy: proxyHost(account.proxyIp)
            })),
            chosen: picked ? (known ? saved : null) : fileCharacter(accounts),
            picked,
            missing: typeof saved === 'string' && !known ? saved : null,
            proxiesSaved: proxiesSaved()
        };
    };

    const choose = (accountId) => {
        const id = typeof accountId === 'string' && accountId ? accountId : null;
        if (id && !find(readAccounts(), id)) return { ...list(), error: MESSAGES.unknown };
        try {
            if (!writeSetting(CHARACTER_KEY, id)) return { ...list(), error: MESSAGES.notChosen };
        } catch (error) {
            log.warn(`Could not save the RuneLite character: ${error?.message || error}`);
            return { ...list(), error: MESSAGES.notChosen };
        }
        return list();
    };

    const clearLauncherLogin = (settings) => {
        try {
            if (!credentials.launcherWroteCurrent(credentialDeps, settings)) return false;
            credentials.removeCredentialProperties(credentialDeps);
            writeSetting(credentials.WRITTEN_KEY, null);
            log.info('Removed the Jagex login the launcher wrote to credentials.properties, so RuneLite opens on its login screen.');
            return true;
        } catch (error) {
            log.warn(`Could not clear credentials.properties: ${error?.code || error?.message || error}`);
            return false;
        }
    };

    const check = async (account) => {
        try {
            return await withinTime(Promise.resolve(checkSession(account)), sessionTimeoutMs);
        } catch (error) {
            return { ok: false };
        }
    };

    const checkFileLogin = async () => {
        const login = fileLogin();
        const account = login?.characterId && login.sessionId ? find(readAccounts(), login.characterId) : null;
        if (!account) return { ok: true };
        const name = String(account.displayName);
        onChecking(name);
        const result = await check({ ...account, sessionId: login.sessionId });
        if (!result?.ok && sessionExpired(result)) {
            log.warn("The Jagex login in credentials.properties has expired; RuneLite was not started.");
            return { ok: false, error: MESSAGES.expired(name), relogin: true, accountId: String(account.accountId) };
        }
        return { ok: true };
    };

    const prepare = async () => {
        const settings = readSettings();
        if (!settings) return { ok: false, error: MESSAGES.settings };
        const saved = settings[CHARACTER_KEY];
        if (saved === undefined) return checkFileLogin();
        if (saved === null) return { ok: true, touched: clearLauncherLogin(settings) };
        const account = typeof saved === 'string' ? find(readAccounts(), saved) : null;
        if (!account) return { ok: false, error: MESSAGES.unknown };
        const name = String(account.displayName);
        const proxy = proxyHost(account.proxyIp);
        if (!account.sessionId) return { ok: false, error: MESSAGES.expired(name), relogin: true, accountId: saved };
        onChecking(name);
        const result = await check(account);
        if (!result?.ok) {
            const expired = sessionExpired(result);
            log.warn(`The chosen character's Jagex login ${expired ? 'has expired' : 'could not be checked'}; RuneLite was not started.`);
            if (expired) return { ok: false, error: MESSAGES.expired(name), relogin: true, accountId: saved };
            return { ok: false, error: MESSAGES.unchecked(name, proxy ? proxy.host || 'its proxy' : null) };
        }
        const fresh = readAccounts().find((entry) => String(entry.accountId) === saved && entry.sessionId) || account;
        try {
            credentials.writeCredentialProperties(credentialDeps, fresh);
        } catch (error) {
            log.warn(`Could not write credentials.properties for RuneLite: ${error?.code || 'unknown error'}`);
            return { ok: false, error: MESSAGES.notSaved(name) };
        }
        log.info('Wrote the chosen character to credentials.properties for RuneLite.');
        return { ok: true, touched: true, name };
    };

    const login = async (accountId) => {
        const { startAuthFlow, authFlowRunning } = auth();
        if (loginRunning || authFlowRunning?.()) return { ...list(), error: MESSAGES.loginOpen };
        const before = readAccounts();
        const target = typeof accountId === 'string' && accountId ? find(before, accountId) : null;
        if (accountId && !target) return { ...list(), error: MESSAGES.unknown };
        const proxyIp = target && typeof target.proxyIp === 'string' ? target.proxyIp.trim() : '';
        loginRunning = true;
        try {
            await startAuthFlow({ proxy: { proxyIp }, keepProxies: true });
        } catch (error) {
            if (error?.code === 'CANCELLED') return { ...list(), cancelled: true };
            log.warn(`The Jagex login from the RuneLite card failed: ${error?.message || error}`);
            return { ...list(), error: error?.message || MESSAGES.loginFailed };
        } finally {
            loginRunning = false;
            focusWindow();
        }
        const after = readAccounts();
        const added = after.filter((account) => !find(before, String(account.accountId)));
        if (!target && added.length === 1) choose(String(added[0].accountId));
        const renewed = target ? Boolean(after.find((entry) => String(entry.accountId) === accountId && entry.sessionId && entry.sessionId !== target.sessionId)) : false;
        if (renewed && (readSettings() || {})[CHARACTER_KEY] === undefined) choose(accountId);
        const result = { ...list(), added: added.length, renewed };
        return target && !renewed ? { ...result, error: MESSAGES.notIncluded(String(target.displayName)) } : result;
    };

    return { list, choose, prepare, login };
};

module.exports.CHARACTER_KEY = CHARACTER_KEY;
module.exports.MESSAGES = MESSAGES;
module.exports.proxyHost = proxyHost;
