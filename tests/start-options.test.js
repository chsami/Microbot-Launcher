const { buildStartOptions, ramChoicesFor, sanitizeRam } = require('../libs/start-options.js');

const ids = {
    account: (accountId) => `a_${accountId}`,
    profile: (name) => `p_${name}`,
    proxy: (address) => `x_${address.length}`
};

const ACCOUNTS = [
    { accountId: '111', sessionId: 's-1', displayName: 'Zezima', proxyIp: '' },
    { accountId: '222', sessionId: 's-1', displayName: 'Lynx', profile: 'default', proxyIp: '10.0.0.2:1080:bob:hunter2' },
    { accountId: '333', sessionId: 's-2', displayName: 'Iron Ted', profile: 'alt' }
];

const build = (input = {}) =>
    buildStartOptions({
        accounts: ACCOUNTS,
        profiles: ['alt', 'pvm'],
        properties: { version_pref: '2.6.44', client_ram: '2g', proxyip: '10.0.0.8:1080' },
        nonJagexProfile: null,
        versions: ['2.6.44', '2.6.34', 'my-build'],
        latestVersion: '2.6.45',
        linked: { alt: 'link-2' },
        proxies: [
            { id: ids.proxy('10.0.0.8:1080'), label: '10.0.0.8:1080' },
            { id: ids.proxy('10.0.0.2:1080:bob:hunter2'), label: '10.0.0.2:1080' }
        ],
        ids,
        ...input
    });

describe('start options sent to the dashboard', () => {
    test('lists accounts, profiles, versions and RAM, with what Play would use as defaults', () => {
        expect(build()).toEqual({
            accounts: [
                { id: 'a_111', label: 'Zezima', profileId: 'p_default', proxyId: null, clientLinkId: null },
                { id: 'a_222', label: 'Lynx', profileId: 'p_default', proxyId: 'x_25', clientLinkId: null },
                { id: 'a_333', label: 'Iron Ted', profileId: 'p_alt', proxyId: null, clientLinkId: null }
            ],
            profiles: [
                { id: 'p_default', label: 'Default', clientLinkId: null },
                { id: 'p_alt', label: 'alt', clientLinkId: 'link-2' },
                { id: 'p_pvm', label: 'pvm', clientLinkId: null }
            ],
            versions: ['2.6.44', '2.6.34'],
            latestVersion: '2.6.45',
            ramChoices: ['256m', '512m', '1g', '2g', '4g', '6g', '8g'],
            defaults: {
                accountId: 'a_111',
                profileId: 'p_default',
                channel: 'stable',
                version: '2.6.44',
                ram: '2g',
                hwidSpoof: true,
                proxyId: 'x_13'
            }
        });
    });

    test('each account carries its own dashboard link and profiles keep the link of clients without an account', () => {
        const { accounts, profiles } = build({ linked: { default: 'link-0' }, linkedAccounts: { 222: 'link-lynx', 333: 'link-ted', 999: 'link-gone' } });

        expect(accounts.map((account) => account.clientLinkId)).toEqual([null, 'link-lynx', 'link-ted']);
        expect(profiles.map((profile) => profile.clientLinkId)).toEqual(['link-0', null, null]);
        expect(JSON.stringify(accounts)).not.toContain('link-gone');
    });

    test('never sends addresses, credentials or session ids', () => {
        const text = JSON.stringify(build());
        expect(text).not.toMatch(/10\.0\.0|hunter2|bob|s-1|s-2/);
    });

    test('defaults to the account picked in the launcher, with its own profile and proxy', () => {
        const { defaults } = build({ properties: { selected_account: '222', proxyip: '10.0.0.8:1080' } });
        expect(defaults).toMatchObject({ accountId: 'a_222', profileId: 'p_default', proxyId: 'x_25' });
        expect(build({ properties: { selected_account: '333' } }).defaults).toMatchObject({ accountId: 'a_333', profileId: 'p_alt', proxyId: null });
    });

    test('without Jagex accounts it defaults to a normal account on the preferred profile', () => {
        const { defaults, accounts, profiles } = build({ accounts: [], nonJagexProfile: 'pking' });
        expect(accounts).toEqual([]);
        expect(defaults).toMatchObject({ accountId: null, profileId: 'p_pking', proxyId: 'x_13' });
        expect(profiles.map((profile) => profile.id)).toEqual(['p_default', 'p_alt', 'p_pvm', 'p_pking']);
    });

    test('a version never picked means the latest, and Nightly has no version', () => {
        expect(build({ properties: { version_pref: '0.0.0' } }).defaults.version).toBeNull();
        expect(build({ properties: {} }).defaults.version).toBeNull();
        const nightly = build({ properties: { version_pref: '2.6.44', client_channel: 'nightly' } }).defaults;
        expect(nightly).toMatchObject({ channel: 'nightly', version: null });
    });

    test('RAM and hardware ID spoofing follow the saved settings, like the Play screen', () => {
        expect(build({ properties: { client_ram: ' 4G ', hwid_spoof: 'false' } }).defaults).toMatchObject({ ram: '4g', hwidSpoof: false });
        expect(build({ properties: { client_ram: 'lots' } }).defaults.ram).toBe('1g');
        const custom = build({ properties: { client_ram: '3g' } });
        expect(custom.defaults.ram).toBe('3g');
        expect(custom.ramChoices).toEqual(['256m', '512m', '1g', '2g', '4g', '6g', '8g', '3g']);
    });

    test('an unknown latest version is sent as null', () => {
        expect(build({ latestVersion: null }).latestVersion).toBeNull();
        expect(build({ latestVersion: '<html>' }).latestVersion).toBeNull();
    });

    test('a proxy the sync does not report is never referenced', () => {
        const { accounts, defaults } = build({ proxies: [] });
        expect(accounts.every((account) => account.proxyId === null)).toBe(true);
        expect(defaults.proxyId).toBeNull();
    });

    test('caps the lists and cleans labels so the sync stays under the API limits', () => {
        const many = Array.from({ length: 70 }, (_, i) => ({ accountId: `${i}`, displayName: `Bot\n${'x'.repeat(100)}`, profile: `p${i}` }));
        const result = build({
            accounts: [...many, { accountId: '', displayName: 'Broken' }],
            versions: Array.from({ length: 30 }, (_, i) => `2.6.${i}`)
        });
        expect(result.accounts).toHaveLength(50);
        expect(result.accounts[0].label).toBe(`Bot${'x'.repeat(77)}`);
        expect(result.profiles).toHaveLength(50);
        expect(result.versions).toHaveLength(20);
        expect(build({ accounts: [{ accountId: '9' }] }).accounts[0].label).toBe('Jagex account');
    });

    test('skips profile names the launcher could not start', () => {
        const { profiles } = build({ profiles: ['ok', 'bad\nname', 'x'.repeat(200), 7] });
        expect(profiles.map((profile) => profile.id)).toEqual(['p_default', 'p_ok', 'p_alt']);
    });
});

describe('RAM choices', () => {
    test('match the Play screen dropdown and keep a saved custom amount', () => {
        expect(ramChoicesFor({})).toEqual(['256m', '512m', '1g', '2g', '4g', '6g', '8g']);
        expect(ramChoicesFor({ client_ram: '1.5g' })).toContain('1.5g');
        expect(sanitizeRam(undefined)).toBe('1g');
    });
});
