const path = require('path');
const { orderAccounts } = require('./accounts-loader.js');
const { parseProxyEndpoint } = require('./proxy-choices.js');
const { refreshSession, sessionExpired } = require('./jagex-session.js');
const credentials = require('./overwrite-credential-properties.js');

const CHARACTER_KEY = 'runeliteCharacter';
const SESSION_TIMEOUT_MS = 20000;

const MESSAGES = {
    expired: (name) => `${name}'s Jagex login has expired. Press Log in again, then open RuneLite.`,
    unchecked: (name) => `Couldn't check ${name}'s Jagex login. Check your connection and try again.`,
    notSaved: (name) => `${name}'s login could not be saved for RuneLite. Check that the .runelite folder in your home folder is writable, then try again.`,
    unknown: 'That character is no longer in the launcher. Pick it again or choose None.'
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
    return endpoint ? endpoint.host : 'a proxy';
}

module.exports = function setupRuneliteCharacters(deps) {
    const { fs, log, microbotDir, home, readSetting, writeSetting } = deps;
    const sessionTimeoutMs = deps.sessionTimeoutMs || SESSION_TIMEOUT_MS;
    const accountsFile = path.join(microbotDir, 'accounts.json');
    const credentialDeps = { fs, path, homeDir: home };

    const checkSession =
        deps.checkSession ||
        ((account) => {
            const { writeAccountsToFile } = require('./oauth-jagex.js');
            return refreshSession({ writeAccountsToFile, log }, account.sessionId, account.proxyIp);
        });

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

    const savedChoice = () => {
        const value = readSetting(CHARACTER_KEY);
        return typeof value === 'string' && value ? value : null;
    };

    const list = () => {
        const accounts = readAccounts();
        const saved = savedChoice();
        return {
            characters: accounts.map((account) => ({
                accountId: String(account.accountId),
                displayName: String(account.displayName),
                proxy: proxyHost(account.proxyIp)
            })),
            chosen: accounts.some((account) => String(account.accountId) === saved) ? saved : null
        };
    };

    const choose = (accountId) => {
        const id = typeof accountId === 'string' && accountId ? accountId : null;
        if (id && !readAccounts().some((account) => String(account.accountId) === id)) return { ...list(), error: MESSAGES.unknown };
        try {
            if (!writeSetting(CHARACTER_KEY, id)) return { ...list(), error: 'Could not save the setting.' };
        } catch (error) {
            log.warn(`Could not save the RuneLite character: ${error?.message || error}`);
            return { ...list(), error: 'Could not save the setting.' };
        }
        return list();
    };

    const clearLauncherLogin = (accounts) => {
        try {
            const current = credentials.credentialCharacterId(credentialDeps);
            if (!current || !accounts.some((account) => String(account.accountId) === current)) return;
            credentials.removeCredentialProperties(credentialDeps);
            log.info('Removed the launcher-written Jagex login from credentials.properties, so RuneLite opens on its login screen.');
        } catch (error) {
            log.warn(`Could not clear credentials.properties: ${error?.message || error}`);
        }
    };

    const prepare = async () => {
        const accounts = readAccounts();
        const saved = savedChoice();
        const account = saved ? accounts.find((entry) => String(entry.accountId) === saved) : null;
        if (!account) {
            clearLauncherLogin(accounts);
            return { ok: true };
        }
        const name = String(account.displayName);
        if (!account.sessionId) return { ok: false, error: MESSAGES.expired(name), relogin: true };
        let result;
        try {
            result = await withinTime(Promise.resolve(checkSession(account)), sessionTimeoutMs);
        } catch (error) {
            result = { ok: false };
        }
        if (!result?.ok) {
            const expired = sessionExpired(result);
            log.warn(`The chosen character's Jagex login ${expired ? 'has expired' : 'could not be checked'}; RuneLite was not started.`);
            return expired ? { ok: false, error: MESSAGES.expired(name), relogin: true } : { ok: false, error: MESSAGES.unchecked(name) };
        }
        const fresh = readAccounts().find((entry) => String(entry.accountId) === saved && entry.sessionId) || account;
        try {
            credentials.writeCredentialProperties(credentialDeps, fresh);
        } catch (error) {
            log.warn(`Could not write credentials.properties for RuneLite: ${error?.code || 'unknown error'}`);
            return { ok: false, error: MESSAGES.notSaved(name) };
        }
        log.info('Wrote the chosen character to credentials.properties for RuneLite.');
        return { ok: true };
    };

    return { list, choose, prepare };
};

module.exports.CHARACTER_KEY = CHARACTER_KEY;
module.exports.MESSAGES = MESSAGES;
module.exports.proxyHost = proxyHost;
