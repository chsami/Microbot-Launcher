const DEFAULT_PROFILE = 'default';
const MAX_PROFILE_LENGTH = 128;
const MAX_WAITING = 3;
const LAUNCH_DEADLINE_MS = 10 * 60 * 1000;

const problem = (kind, title, message) => ({ problem: { kind, title, message } });

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
        proxyChoices
    } = deps;

    const deadlineMs = deps.deadlineMs || LAUNCH_DEADLINE_MS;
    let queue = Promise.resolve();
    let waiting = 0;

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

    const resolveVersion = async (properties) => {
        if (properties.client_channel === 'nightly') {
            const result = await prepareNightly();
            const build = result?.info?.build;
            if (result?.error || !build) {
                return problem('download-failed', 'Download Failed', result?.error || 'The nightly download failed.');
            }
            return { version: build };
        }
        let version = typeof properties.version_pref === 'string' ? properties.version_pref.trim() : '';
        if (!version || version === '0.0.0') {
            try {
                const latest = await fetchLatestVersion();
                version = typeof latest === 'string' ? latest.replace(/^microbot-/, '').replace(/\.jar$/, '').trim() : '';
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
        accounts.forEach((account) => {
            const own = typeof account.proxyIp === 'string' ? account.proxyIp.trim() : '';
            if (own) suggested[profileName(account.profile)] = proxyChoices.idFor(own);
        });
        return { proxies: proxies.map(({ id, label }) => ({ id, label })), suggested };
    };

    const launchNow = async (profile, proxyId) => {
        const target = findAccount(profile);
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
        const resolved = await resolveVersion(properties);
        if (resolved.problem) return resolved;
        const settings = {
            version: resolved.version,
            proxy: { proxyIp },
            ramPreference: typeof properties.client_ram === 'string' ? properties.client_ram : '',
            hwidSpoof: properties.hwid_spoof !== 'false'
        };
        if (!resolved.version.startsWith('nightly-')) {
            try {
                await recordClientUse(resolved.version);
            } catch (error) {
                log.warn(`Could not record client use: ${error?.message || error}`);
            }
        }
        log.info(`Starting profile "${profile}" ${target.account ? 'with its Jagex account' : 'without a Jagex account'}.`);
        if (target.account) {
            writeCredentials(target.account);
            return launch({ ...settings, account: target.account });
        }
        return launch({ ...settings, noJagexProfile: profile });
    };

    const launchProfile = (rawProfile, { proxyId = null } = {}) => {
        const profile = profileName(rawProfile);
        if (profile.length > MAX_PROFILE_LENGTH || /[\u0000-\u001f]/.test(profile)) {
            return Promise.resolve(problem('invalid-profile', 'Invalid Profile', 'That profile name is not valid.'));
        }
        if (waiting >= MAX_WAITING) {
            return Promise.resolve(
                problem('too-many-launches', 'Too Many Launches', 'Other clients are still starting. Try again in a minute.')
            );
        }
        waiting += 1;
        const run = queue
            .then(() => withDeadline(launchNow(profile, proxyId), profile))
            .catch((error) => {
                log.error(`Could not start profile "${profile}": ${error?.message || error}`);
                return problem('launch-failed', 'Launch Failed', error?.message || String(error));
            })
            .finally(() => {
                waiting -= 1;
            });
        queue = run;
        return run;
    };

    const withDeadline = (work, profile) => {
        let timer = null;
        const deadline = new Promise((resolve) => {
            timer = setTimeout(() => {
                log.warn(`Starting profile "${profile}" took too long; moving on to the next launch.`);
                resolve(problem('timed-out', 'Took Too Long', 'Starting the client took too long. Check the launcher.'));
            }, deadlineMs);
        });
        return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
    };

    return { launchProfile, listProxies };
};
