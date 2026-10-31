const {
    DEFAULT_PROFILE,
    STABLE_VERSION_PATTERN,
    buildStartOptions,
    profileNames,
    ramChoicesFor
} = require('./start-options.js');

const MAX_PROFILE_LENGTH = 128;
const MAX_WAITING = 3;
const LAUNCH_DEADLINE_MS = 10 * 60 * 1000;
const LATEST_TTL_MS = 5 * 60 * 1000;
const LATEST_TIMEOUT_MS = 10 * 1000;
const CHANNELS = ['stable', 'nightly'];

const problem = (kind, title, message) => ({ problem: { kind, title, message } });
const refuse = (message) => problem('unknown-option', 'Unknown Option', message);
const tooManyLaunches = () =>
    problem('too-many-launches', 'Too Many Launches', 'Other clients are still starting. Try again in a minute.');

module.exports = function setupProfileLauncher(deps) {
    const {
        fs,
        path,
        log,
        microbotDir,
        launch,
        writeCredentials,
        isSafeClientVersion,
        downloadClient,
        prepareNightly,
        fetchLatestVersion,
        recordClientUse,
        proxyChoices,
        listProfiles,
        listVersions
    } = deps;

    const deadlineMs = deps.deadlineMs || LAUNCH_DEADLINE_MS;
    const launchQueue = deps.launchQueue || require('./launch-queue.js')();
    let waiting = 0;
    let latest = { value: null, at: -Infinity };

    const readJson = (name, fallback) => {
        const file = path.join(microbotDir, name);
        try {
            if (!fs.existsSync(file)) return fallback;
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            log.warn(`Could not read ${name}: ${error?.message || error}`);
            return fallback;
        }
    };

    const readProperties = () => {
        const value = readJson('resource_versions.json', {});
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    };

    const readAccounts = () => {
        const value = readJson('accounts.json', []);
        return Array.isArray(value) ? value.filter((account) => typeof account?.accountId === 'string') : [];
    };

    const readNonJagexProfile = () => {
        const value = readJson('non-jagex-preferred-profile.json', null)?.profile;
        return typeof value === 'string' ? value : null;
    };

    const listOf = (what, read) => {
        try {
            const value = read?.();
            return Array.isArray(value) ? value : [];
        } catch (error) {
            log.warn(`Could not list ${what}: ${error?.message || error}`);
            return [];
        }
    };

    const currentProfiles = (accounts) =>
        profileNames({ profiles: listOf('profiles', listProfiles), accounts, nonJagexProfile: readNonJagexProfile() });

    const profileName = (value) => (typeof value === 'string' && value.trim()) || DEFAULT_PROFILE;

    const findAccount = (profile) => {
        const matches = readAccounts().filter((account) => profileName(account.profile) === profile);
        if (matches.length > 1) {
            return problem(
                'ambiguous-profile',
                'More Than One Account',
                `More than one Jagex account uses the profile "${profile}". Give each account its own profile.`
            );
        }
        return { account: matches[0] || null };
    };

    const ensureDownloaded = async (version) => {
        if (fs.existsSync(path.join(microbotDir, `microbot-${version}.jar`))) return { version };
        const result = await downloadClient(version);
        if (result?.error) return problem('download-failed', 'Download Failed', result.error);
        return { version };
    };

    const latestStable = async () => {
        const value = await fetchLatestVersion();
        return typeof value === 'string' ? value.replace(/^microbot-/, '').replace(/\.jar$/, '').trim() : '';
    };

    const cachedLatest = async () => {
        if (Date.now() - latest.at < LATEST_TTL_MS) return latest.value;
        let timer = null;
        try {
            const value = await Promise.race([
                latestStable(),
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error('the lookup timed out')), LATEST_TIMEOUT_MS);
                })
            ]);
            latest = { value: value || null, at: Date.now() };
        } catch (error) {
            log.warn(`Could not look up the latest client: ${error?.message || error}`);
            latest = { value: latest.value, at: Date.now() };
        } finally {
            clearTimeout(timer);
        }
        return latest.value;
    };

    const resolveVersion = async (channel, preferred) => {
        if (channel === 'nightly') {
            const result = await prepareNightly();
            const build = result?.info?.build;
            if (result?.error || !build) {
                return problem('download-failed', 'Download Failed', result?.error || 'The nightly download failed.');
            }
            return { version: build };
        }
        let version = typeof preferred === 'string' ? preferred.trim() : '';
        if (!version || version === '0.0.0') {
            try {
                version = await latestStable();
            } catch (error) {
                return problem('version-unavailable', 'No Client Version', `Could not look up the latest client: ${error.message}`);
            }
        }
        if (!isSafeClientVersion(version)) {
            return problem('version-unavailable', 'No Client Version', 'No client version is selected in the launcher.');
        }
        return ensureDownloaded(version);
    };

    const choosableProxies = (properties) => proxyChoices.savedProxies(properties, readAccounts());

    const listProxies = () => {
        const accounts = readAccounts();
        const proxies = proxyChoices.savedProxies(readProperties(), accounts);
        const suggested = {};
        const ownProxies = accounts.map((account) => {
            const own = typeof account.proxyIp === 'string' ? account.proxyIp.trim() : '';
            if (own) suggested[profileName(account.profile)] = proxyChoices.idFor(own);
            return { accountId: account.accountId, profile: profileName(account.profile), proxyId: own ? proxyChoices.idFor(own) : null };
        });
        return { proxies: proxies.map(({ id, label }) => ({ id, label })), suggested, accounts: ownProxies };
    };

    const startOptions = async (linked = {}, proxies = [], linkedAccounts = {}) => {
        const accounts = readAccounts();
        return buildStartOptions({
            accounts,
            profiles: listOf('profiles', listProfiles),
            properties: readProperties(),
            nonJagexProfile: readNonJagexProfile(),
            versions: listOf('client versions', listVersions),
            latestVersion: await cachedLatest(),
            linked,
            linkedAccounts,
            proxies,
            ids: { account: proxyChoices.accountIdFor, profile: proxyChoices.profileIdFor, proxy: proxyChoices.idFor }
        });
    };

    const chooseOptions = (options) => {
        if (!options || typeof options !== 'object' || Array.isArray(options)) return refuse('The start options could not be read.');
        const properties = readProperties();
        const accounts = readAccounts();
        const profile =
            typeof options.profileId === 'string'
                ? currentProfiles(accounts).find((name) => proxyChoices.profileIdFor(name) === options.profileId)
                : undefined;
        if (!profile) return refuse('That profile is no longer in the launcher on this PC.');
        let account = null;
        if (options.accountId != null) {
            account =
                typeof options.accountId === 'string'
                    ? accounts.find((entry) => proxyChoices.accountIdFor(entry.accountId) === options.accountId)
                    : undefined;
            if (!account) return refuse('That Jagex account is no longer logged in to the launcher on this PC.');
        }
        if (!CHANNELS.includes(options.channel)) return refuse('The client channel must be Stable or Nightly.');
        let version = null;
        if (options.version != null) {
            if (options.channel !== 'stable') return refuse('A client version can only be chosen on the Stable channel.');
            if (
                typeof options.version !== 'string' ||
                !STABLE_VERSION_PATTERN.test(options.version) ||
                !isSafeClientVersion(options.version)
            ) {
                return refuse('That client version is not one the launcher can start.');
            }
            version = options.version;
        }
        if (typeof options.ram !== 'string' || !ramChoicesFor(properties).includes(options.ram)) {
            return refuse('That client RAM amount is not one of the launcher\'s choices.');
        }
        if (typeof options.hwidSpoof !== 'boolean') return refuse('Spoof hardware IDs must be on or off.');
        let proxyIp = '';
        if (options.proxyId != null) {
            const chosen =
                typeof options.proxyId === 'string'
                    ? choosableProxies(properties).find((proxy) => proxy.id === options.proxyId)
                    : undefined;
            if (!chosen) return refuse('That proxy is no longer saved in the launcher on this PC.');
            proxyIp = chosen.address;
        }
        return {
            choice: { profile, account, channel: options.channel, version, ram: options.ram, hwidSpoof: options.hwidSpoof, proxyIp }
        };
    };

    const resolveChosenVersion = async ({ channel, version }) => {
        if (channel === 'nightly' || version === null) return resolveVersion(channel, null);
        if (!listOf('client versions', listVersions).includes(version)) {
            let newest;
            try {
                newest = await latestStable();
            } catch (error) {
                return problem('version-unavailable', 'No Client Version', `Could not look up the latest client: ${error.message}`);
            }
            if (newest !== version) return refuse(`Client version ${version} is no longer downloaded on this PC.`);
        }
        return ensureDownloaded(version);
    };

    const startClient = async (profile, account, settings) => {
        if (!settings.version.startsWith('nightly-')) {
            try {
                await recordClientUse(settings.version);
            } catch (error) {
                log.warn(`Could not record client use: ${error?.message || error}`);
            }
        }
        log.info(`Starting profile "${profile}" ${account ? 'with a Jagex account' : 'without a Jagex account'}.`);
        if (account) {
            if (account.accountId && account.sessionId) writeCredentials(account);
            return launch({ ...settings, account: profileName(account.profile) === profile ? account : { ...account, profile } });
        }
        return launch({ ...settings, noJagexProfile: profile });
    };

    const launchChosen = async (options, attempt, stillWanted) => {
        if (!stillWanted()) return problem('disabled', 'Start Cancelled', 'Starting from the dashboard was turned off.');
        const chosen = chooseOptions(options);
        if (chosen.problem) return chosen;
        const { choice } = chosen;
        const resolved = await resolveChosenVersion(choice);
        if (resolved.problem) return resolved;
        if (attempt.expired) return problem('timed-out', 'Took Too Long', 'Starting the client took too long. Check the launcher.');
        if (!stillWanted()) return problem('disabled', 'Start Cancelled', 'Starting from the dashboard was turned off.');
        return startClient(choice.profile, choice.account, {
            version: resolved.version,
            proxy: { proxyIp: choice.proxyIp },
            ramPreference: choice.ram,
            hwidSpoof: choice.hwidSpoof
        });
    };

    const accountGone = () =>
        problem('unknown-client', 'Unknown Account', 'That Jagex account is no longer logged in to the launcher on this PC.');

    const findAccountById = (accountId) => {
        const account = readAccounts().find((entry) => entry.accountId === accountId);
        return account ? { account } : accountGone();
    };

    const launchNow = async (profile, proxyId, attempt, stillWanted, accountId = null, withoutAccount = false) => {
        if (!stillWanted()) return problem('disabled', 'Start Cancelled', 'Starting from the dashboard was turned off.');
        const target = withoutAccount ? { account: null } : accountId ? findAccountById(accountId) : findAccount(profile);
        if (target.problem) return target;
        const properties = readProperties();
        let proxyIp = '';
        if (proxyId) {
            const chosen = choosableProxies(properties).find((proxy) => proxy.id === proxyId);
            if (!chosen) {
                return problem('unknown-proxy', 'Unknown Proxy', 'That proxy is no longer saved in the launcher.');
            }
            proxyIp = chosen.address;
        }
        const resolved = await resolveVersion(properties.client_channel === 'nightly' ? 'nightly' : 'stable', properties.version_pref);
        if (resolved.problem) return resolved;
        if (attempt.expired) return problem('timed-out', 'Took Too Long', 'Starting the client took too long. Check the launcher.');
        if (!stillWanted()) return problem('disabled', 'Start Cancelled', 'Starting from the dashboard was turned off.');
        return startClient(profile, target.account, {
            version: resolved.version,
            proxy: { proxyIp },
            ramPreference: typeof properties.client_ram === 'string' ? properties.client_ram : '',
            hwidSpoof: properties.hwid_spoof !== 'false'
        });
    };

    const launchProfile = (rawProfile, { proxyId = null, stillWanted = () => true, withoutAccount = false } = {}) => {
        const profile = profileName(rawProfile);
        if (profile.length > MAX_PROFILE_LENGTH || /[\u0000-\u001f]/.test(profile)) {
            return Promise.resolve(problem('invalid-profile', 'Invalid Profile', 'That profile name is not valid.'));
        }
        return enqueue(profile, (attempt) => launchNow(profile, proxyId, attempt, stillWanted, null, withoutAccount === true));
    };

    const launchAccount = (accountId, { proxyId = null, stillWanted = () => true, onAccepted = () => {} } = {}) => {
        const found = typeof accountId === 'string' && accountId ? findAccountById(accountId) : accountGone();
        if (found.problem) return Promise.resolve(found);
        const profile = profileName(found.account.profile);
        if (profile.length > MAX_PROFILE_LENGTH || /[\u0000-\u001f]/.test(profile)) {
            return Promise.resolve(problem('invalid-profile', 'Invalid Profile', 'That profile name is not valid.'));
        }
        if (waiting >= MAX_WAITING) return Promise.resolve(tooManyLaunches());
        onAccepted({ profile, account: found.account.displayName || 'Jagex account' });
        return enqueue(profile, (attempt) => launchNow(profile, proxyId, attempt, stillWanted, accountId));
    };

    const launchOptions = (options, { stillWanted = () => true, onAccepted = () => {} } = {}) => {
        const chosen = chooseOptions(options);
        if (chosen.problem) return Promise.resolve(chosen);
        if (waiting >= MAX_WAITING) return Promise.resolve(tooManyLaunches());
        const { profile, account } = chosen.choice;
        onAccepted({ profile, account: account ? account.displayName || 'Jagex account' : null });
        return enqueue(profile, (attempt) => launchChosen(options, attempt, stillWanted));
    };

    const enqueue = (profile, start) => {
        if (waiting >= MAX_WAITING) return Promise.resolve(tooManyLaunches());
        waiting += 1;
        return launchQueue
            .run(() => withDeadline(start, profile))
            .catch((error) => {
                log.error(`Could not start profile "${profile}": ${error?.message || error}`);
                return problem('launch-failed', 'Launch Failed', error?.message || String(error));
            })
            .finally(() => {
                waiting -= 1;
            });
    };

    const withDeadline = (start, profile) => {
        const attempt = { expired: false };
        let timer = null;
        const deadline = new Promise((resolve) => {
            timer = setTimeout(() => {
                attempt.expired = true;
                log.warn(`Starting profile "${profile}" took too long; moving on to the next launch.`);
                resolve(problem('timed-out', 'Took Too Long', 'Starting the client took too long. Check the launcher.'));
            }, deadlineMs);
        });
        return Promise.race([start(attempt), deadline]).finally(() => clearTimeout(timer));
    };

    return { launchProfile, launchAccount, launchOptions, listProxies, startOptions };
};
