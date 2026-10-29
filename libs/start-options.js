const DEFAULT_PROFILE = 'default';
const DEFAULT_CLIENT_RAM = '1g';
const RAM_CHOICES = ['256m', '512m', '1g', '2g', '4g', '6g', '8g'];
const STABLE_VERSION_PATTERN = /^\d+(\.\d+){1,3}$/;
const MAX_ACCOUNTS = 50;
const MAX_PROFILES = 50;
const MAX_VERSIONS = 20;
const MAX_LABEL_LENGTH = 80;
const MAX_PROFILE_LENGTH = 128;

function sanitizeRam(value) {
    if (typeof value !== 'string') return DEFAULT_CLIENT_RAM;
    const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)([mg])$/);
    return match ? `${match[1]}${match[2]}` : DEFAULT_CLIENT_RAM;
}

function ramChoicesFor(properties) {
    const saved = sanitizeRam(properties?.client_ram);
    return RAM_CHOICES.includes(saved) ? [...RAM_CHOICES] : [...RAM_CHOICES, saved];
}

function profileName(value) {
    return (typeof value === 'string' && value.trim()) || DEFAULT_PROFILE;
}

function isUsableProfile(name) {
    return name.length <= MAX_PROFILE_LENGTH && !/[\u0000-\u001f]/.test(name);
}

function stableVersion(value) {
    const version = typeof value === 'string' ? value.trim() : '';
    return STABLE_VERSION_PATTERN.test(version) && version !== '0.0.0' ? version : null;
}

function cleanLabel(value, fallback) {
    const label = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    return (label || fallback).slice(0, MAX_LABEL_LENGTH);
}

function profileNames({ profiles = [], accounts = [], nonJagexProfile = null }) {
    const names = [DEFAULT_PROFILE];
    const add = (value) => {
        if (typeof value !== 'string') return;
        const name = profileName(value);
        if (isUsableProfile(name) && !names.includes(name)) names.push(name);
    };
    (Array.isArray(profiles) ? profiles : []).forEach(add);
    accounts.forEach((account) => add(account.profile));
    add(nonJagexProfile);
    return names;
}

function playAccount(accounts, properties) {
    return accounts.find((account) => account.accountId === properties.selected_account) || accounts[0] || null;
}

function playProxyAddress(account, properties) {
    const own = typeof account?.proxyIp === 'string' ? account.proxyIp.trim() : '';
    if (own) return own;
    return typeof properties.proxyip === 'string' ? properties.proxyip.trim() : '';
}

function buildStartOptions({
    accounts = [],
    profiles = [],
    properties = {},
    nonJagexProfile = null,
    versions = [],
    latestVersion = null,
    linked = {},
    proxies = [],
    ids
}) {
    const usableAccounts = accounts.filter((account) => typeof account?.accountId === 'string' && account.accountId).slice(0, MAX_ACCOUNTS);
    const names = profileNames({ profiles, accounts: usableAccounts, nonJagexProfile }).slice(0, MAX_PROFILES);
    const reported = new Set(proxies.map((proxy) => proxy.id));
    const proxyIdOf = (address) => {
        const value = typeof address === 'string' ? address.trim() : '';
        if (!value) return null;
        const id = ids.proxy(value);
        return reported.has(id) ? id : null;
    };
    const profileIdOf = (value) => {
        const name = profileName(value);
        return ids.profile(names.includes(name) ? name : DEFAULT_PROFILE);
    };
    const channel = properties.client_channel === 'nightly' ? 'nightly' : 'stable';
    const account = playAccount(usableAccounts, properties);
    return {
        accounts: usableAccounts.map((entry) => ({
            id: ids.account(entry.accountId),
            label: cleanLabel(entry.displayName, 'Jagex account'),
            profileId: profileIdOf(entry.profile),
            proxyId: proxyIdOf(entry.proxyIp)
        })),
        profiles: names.map((name) => ({
            id: ids.profile(name),
            label: name === DEFAULT_PROFILE ? 'Default' : cleanLabel(name, name),
            clientLinkId: typeof linked[name] === 'string' && linked[name] ? linked[name] : null
        })),
        versions: [...new Set(versions.map(stableVersion).filter(Boolean))].slice(0, MAX_VERSIONS),
        latestVersion: stableVersion(latestVersion),
        ramChoices: ramChoicesFor(properties),
        defaults: {
            accountId: account ? ids.account(account.accountId) : null,
            profileId: profileIdOf(account ? account.profile : nonJagexProfile),
            channel,
            version: channel === 'stable' ? stableVersion(properties.version_pref) : null,
            ram: sanitizeRam(properties.client_ram),
            hwidSpoof: properties.hwid_spoof !== 'false',
            proxyId: proxyIdOf(playProxyAddress(account, properties))
        }
    };
}

module.exports = {
    DEFAULT_PROFILE,
    RAM_CHOICES,
    STABLE_VERSION_PATTERN,
    buildStartOptions,
    profileNames,
    profileName,
    ramChoicesFor,
    sanitizeRam
};
