const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const setupRuneliteLoader = require('../libs/runelite-loader');
const setupRuneliteCharacters = require('../libs/runelite-characters');
const { MESSAGES } = require('../libs/runelite-characters');
const { orderAccounts } = require('../libs/accounts-loader');
const accountsLoader = require('../libs/accounts-loader');
const { writeCredentialProperties } = require('../libs/overwrite-credential-properties');
const { sessionExpired } = require('../libs/jagex-session');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }

    invoke(channel, ...args) {
        return this.handlers.get(channel)(null, ...args);
    }
}

const SESSION_A = 'fake-session-aaaaaaaaaaaaaaaa';
const SESSION_B = 'fake-session-bbbbbbbbbbbbbbbb';

const ACCOUNTS = [
    { accountId: 'char-old', displayName: 'Zezima', sessionId: SESSION_A, createdOn: '2026-01-01T00:00:00.000Z', profile: 'default' },
    { accountId: 'char-new', displayName: 'Lynx Titan', sessionId: SESSION_B, createdOn: '2026-11-01T00:00:00.000Z', proxyIp: '203.0.113.7:1080:user:secretpass' },
    { accountId: 'char-dupe', displayName: 'Zezima', sessionId: SESSION_A, createdOn: '2025-06-01T00:00:00.000Z' },
    { accountId: 'char-unnamed', sessionId: SESSION_A, createdOn: '2026-05-01T00:00:00.000Z' }
];

describe('characters on the Microbot in RuneLite card', () => {
    let dir;
    let home;
    let microbotDir;
    let settingsFile;
    let log;
    let checkSession;

    const credentialsFile = () => path.join(home, '.runelite', 'credentials.properties');
    const logged = () => [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].map((args) => args.join(' ')).join('\n');
    const writeAccounts = (accounts) => fs.writeFileSync(path.join(microbotDir, 'accounts.json'), JSON.stringify(accounts, null, 2));
    const readSettings = () => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {});

    const launchable = () => {
        const spawn = jest.fn((command, args, options) => {
            const child = new EventEmitter();
            child.unref = jest.fn();
            child.credentialsAtSpawn = fs.existsSync(credentialsFile()) ? fs.readFileSync(credentialsFile(), 'utf8') : null;
            setImmediate(() => child.emit('spawn'));
            spawn.children.push(child);
            return child;
        });
        spawn.children = [];
        return spawn;
    };

    const setupLoader = (overrides = {}) => {
        const ipcMain = new FakeIpcMain();
        const spec = { command: '/home/p/Downloads/RuneLite.AppImage', args: [], source: 'appimage', label: 'RuneLite' };
        const loader = setupRuneliteLoader({
            ipcMain,
            log,
            fs,
            spawn: launchable(),
            auth: null,
            alerts: null,
            axios: {},
            microbotDir,
            downloadsDir: path.join(dir, 'downloads'),
            agentJar: path.join(dir, 'agent.jar'),
            settingsFile,
            finder: { find: () => spec, fromPath: () => spec },
            env: { PATH: '/usr/bin', HOME: home },
            home,
            platform: 'linux',
            checkSession,
            getWindow: () => null,
            ...overrides
        });
        return { ipcMain, loader };
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runelite-characters-'));
        home = path.join(dir, 'home');
        microbotDir = path.join(home, '.microbot');
        fs.mkdirSync(microbotDir, { recursive: true });
        settingsFile = path.join(microbotDir, 'launcher-settings.json');
        log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        checkSession = jest.fn(async () => ({ ok: true, added: 0, updated: 0 }));
        writeAccounts(ACCOUNTS);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('the picker list', () => {
        test('is ordered and deduplicated exactly like the read-accounts list', async () => {
            const ipcMain = new FakeIpcMain();
            await accountsLoader({ fs, path, microbotDir, ipcMain, log });
            const sidebar = await ipcMain.invoke('read-accounts');

            const { characters } = await setupLoader().ipcMain.invoke('runelite-loader:characters');

            expect(characters.map((character) => character.accountId)).toEqual(sidebar.map((account) => account.accountId));
            expect(characters.map((character) => character.displayName)).toEqual(['Lynx Titan', 'Not set', 'Zezima']);
            expect(orderAccounts(JSON.parse(JSON.stringify(ACCOUNTS))).map((account) => account.accountId)).toEqual(['char-new', 'char-unnamed', 'char-old']);
        });

        test('never carries a session id or proxy login to the card', async () => {
            const data = await setupLoader().ipcMain.invoke('runelite-loader:characters');
            const text = JSON.stringify(data);

            expect(text).not.toContain(SESSION_A);
            expect(text).not.toContain(SESSION_B);
            expect(text).not.toContain('secretpass');
            expect(text).not.toContain('user');
            expect(data.characters[0]).toEqual({ accountId: 'char-new', displayName: 'Lynx Titan', proxy: '203.0.113.7' });
            expect(data.characters[2].proxy).toBeNull();
        });

        test('without accounts.json there are no characters and None is chosen', async () => {
            fs.rmSync(path.join(microbotDir, 'accounts.json'));

            expect(await setupLoader().ipcMain.invoke('runelite-loader:characters')).toEqual({ characters: [], chosen: null });
        });

        test('the choice is remembered in the launcher settings next to the other settings', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ launcherMode: 'runelite', runelitePath: '/opt/RuneLite.AppImage' }));
            const { ipcMain } = setupLoader();

            expect((await ipcMain.invoke('runelite-loader:set-character', 'char-old')).chosen).toBe('char-old');
            expect(readSettings()).toEqual({ launcherMode: 'runelite', runelitePath: '/opt/RuneLite.AppImage', runeliteCharacter: 'char-old' });
            expect((await setupLoader().ipcMain.invoke('runelite-loader:characters')).chosen).toBe('char-old');

            expect((await ipcMain.invoke('runelite-loader:set-character', null)).chosen).toBeNull();
            expect(readSettings().runeliteCharacter).toBeNull();
        });

        test('an unknown character is refused and not saved', async () => {
            const result = await setupLoader().ipcMain.invoke('runelite-loader:set-character', 'char-gone');

            expect(result).toMatchObject({ chosen: null, error: MESSAGES.unknown });
            expect(readSettings().runeliteCharacter).toBeUndefined();
        });

        test('a character removed from accounts.json shows as None', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ runeliteCharacter: 'char-gone' }));

            expect((await setupLoader().ipcMain.invoke('runelite-loader:characters')).chosen).toBeNull();
        });

        test('unreadable launcher settings are not overwritten by the choice', async () => {
            fs.writeFileSync(settingsFile, '{ broken');

            const result = await setupLoader().ipcMain.invoke('runelite-loader:set-character', 'char-old');

            expect(result.error).toBe('Could not save the setting.');
            expect(fs.readFileSync(settingsFile, 'utf8')).toBe('{ broken');
        });
    });

    describe('Open RuneLite with a character chosen', () => {
        test('checks the session, then writes its login to credentials.properties before RuneLite starts', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ runeliteCharacter: 'char-old' }));
            const { loader } = setupLoader();

            expect(await loader.openRuneLite()).toEqual({ ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.' });

            expect(checkSession).toHaveBeenCalledTimes(1);
            expect(checkSession.mock.calls[0][0]).toMatchObject({ accountId: 'char-old', sessionId: SESSION_A });
            const written = fs.readFileSync(credentialsFile(), 'utf8');
            expect(written).toContain('JX_CHARACTER_ID=char-old\n');
            expect(written).toContain(`JX_SESSION_ID=${SESSION_A}\n`);
            expect(written).toContain('JX_DISPLAY_NAME=Zezima\n');
            if (process.platform !== 'win32') expect(fs.statSync(credentialsFile()).mode & 0o777).toBe(0o600);
            expect(logged()).not.toContain(SESSION_A);
        });

        test('the login is on disk when RuneLite is spawned, and RuneLite gets no JX_ variables', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ runeliteCharacter: 'char-new' }));
            const spawn = launchable();
            const { loader } = setupLoader({ spawn, env: { PATH: '/usr/bin', HOME: home, JX_SESSION_ID: 'inherited-session' } });

            await loader.openRuneLite();

            expect(spawn).toHaveBeenCalledTimes(1);
            expect(spawn.children[0].credentialsAtSpawn).toContain('JX_CHARACTER_ID=char-new\n');
            expect(spawn.mock.calls[0][2].env).toEqual({ PATH: '/usr/bin', HOME: home });
        });

        test('an existing credentials file is tightened to owner-only', async () => {
            if (process.platform === 'win32') return;
            fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true });
            fs.writeFileSync(credentialsFile(), 'JX_CHARACTER_ID=someone\n', { mode: 0o644 });
            fs.chmodSync(credentialsFile(), 0o644);

            writeCredentialProperties({ fs, path, homeDir: home }, ACCOUNTS[0]);

            expect(fs.statSync(credentialsFile()).mode & 0o777).toBe(0o600);
        });

        test('an expired session asks the member to log in again and RuneLite does not start', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ runeliteCharacter: 'char-old' }));
            checkSession.mockResolvedValue({ ok: false, status: 401, error: 'Request failed with status code 401' });
            const spawn = launchable();
            const { ipcMain } = setupLoader({ spawn });

            const result = await ipcMain.invoke('runelite-loader:open');

            expect(result).toEqual({ ok: false, error: MESSAGES.expired('Zezima'), relogin: true });
            expect(result.error).toBe("Zezima's Jagex login has expired. Press Log in again, then open RuneLite.");
            expect(spawn).not.toHaveBeenCalled();
            expect(fs.existsSync(credentialsFile())).toBe(false);
            expect(logged()).not.toContain(SESSION_A);
        });

        test('an expired session leaves an earlier login file alone', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ runeliteCharacter: 'char-old' }));
            fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true });
            fs.writeFileSync(credentialsFile(), 'JX_CHARACTER_ID=char-new\n');
            checkSession.mockResolvedValue({ ok: false, status: 403 });

            expect((await setupLoader().loader.openRuneLite()).relogin).toBe(true);
            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe('JX_CHARACTER_ID=char-new\n');
        });

        test('a character without a session is treated as expired without calling Jagex', async () => {
            writeAccounts([{ accountId: 'char-old', displayName: 'Zezima', createdOn: '2026-01-01T00:00:00.000Z' }]);
            fs.writeFileSync(settingsFile, JSON.stringify({ runeliteCharacter: 'char-old' }));

            expect(await setupLoader().loader.openRuneLite()).toEqual({ ok: false, error: MESSAGES.expired('Zezima'), relogin: true });
            expect(checkSession).not.toHaveBeenCalled();
        });

        test('when Jagex cannot be reached RuneLite does not start with an unchecked session', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ runeliteCharacter: 'char-old' }));
            checkSession.mockResolvedValue({ ok: false, error: 'getaddrinfo ENOTFOUND auth.jagex.com' });
            const spawn = launchable();

            expect(await setupLoader({ spawn }).loader.openRuneLite()).toEqual({ ok: false, error: MESSAGES.unchecked('Zezima') });
            expect(spawn).not.toHaveBeenCalled();

            checkSession.mockRejectedValue(new Error('boom'));
            expect((await setupLoader({ spawn }).loader.openRuneLite()).error).toBe(MESSAGES.unchecked('Zezima'));
            expect(spawn).not.toHaveBeenCalled();
        });

        test('a session check that never answers gives up instead of leaving the card busy', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ runeliteCharacter: 'char-old' }));
            checkSession.mockImplementation(() => new Promise(() => {}));
            const spawn = launchable();

            expect(await setupLoader({ spawn, sessionTimeoutMs: 20 }).loader.openRuneLite()).toEqual({ ok: false, error: MESSAGES.unchecked('Zezima') });
            expect(spawn).not.toHaveBeenCalled();
        });

        test('Find RuneLite… checks the chosen character too', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ runeliteCharacter: 'char-old' }));
            checkSession.mockResolvedValue({ ok: false, status: 401 });
            const chosen = path.join(dir, 'RuneLite.AppImage');
            fs.writeFileSync(chosen, '');
            const dialog = { showOpenDialog: jest.fn(async () => ({ canceled: false, filePaths: [chosen] })) };
            const spawn = launchable();

            const result = await setupLoader({ spawn, dialog, finder: undefined }).loader.findAndOpen();

            expect(result).toMatchObject({ ok: false, relogin: true, opener: 'open' });
            expect(spawn).not.toHaveBeenCalled();
            expect(readSettings().runelitePath).toBe(chosen);
        });

        test('the session check uses the shared refresh rule: 401 and 403 are expired', () => {
            expect(sessionExpired({ ok: false, status: 401 })).toBe(true);
            expect(sessionExpired({ ok: false, status: 403 })).toBe(true);
            expect(sessionExpired({ ok: false, status: 500 })).toBe(false);
            expect(sessionExpired({ ok: false })).toBe(false);
        });

        test('the default session check goes through the account proxy like Refresh accounts', async () => {
            jest.resetModules();
            const writeAccountsToFile = jest.fn(async () => ({ ok: true }));
            const close = jest.fn(async () => {});
            jest.doMock('../libs/oauth-jagex.js', () => ({ writeAccountsToFile }));
            jest.doMock('../libs/login-proxy.js', () => ({
                ...jest.requireActual('../libs/login-proxy.js'),
                startLoginProxy: jest.fn(async () => ({ httpOptions: { proxy: false, marker: 'via-proxy' }, close }))
            }));
            const freshSetup = require('../libs/runelite-characters');
            const settings = { runeliteCharacter: 'char-new' };
            const characters = freshSetup({
                fs,
                log,
                microbotDir,
                home,
                readSetting: (key) => settings[key],
                writeSetting: () => true
            });

            expect(await characters.prepare()).toEqual({ ok: true });
            expect(writeAccountsToFile).toHaveBeenCalledWith(SESSION_B, { proxy: false, marker: 'via-proxy' });
            expect(close).toHaveBeenCalled();
            jest.dontMock('../libs/oauth-jagex.js');
            jest.dontMock('../libs/login-proxy.js');
        });
    });

    describe('Open RuneLite with None', () => {
        test('a login the launcher wrote for one of its characters is removed, so RuneLite opens on its login screen', async () => {
            writeCredentialProperties({ fs, path, homeDir: home }, ACCOUNTS[1]);
            const spawn = launchable();

            expect((await setupLoader({ spawn }).loader.openRuneLite()).ok).toBe(true);

            expect(fs.existsSync(credentialsFile())).toBe(false);
            expect(spawn.children[0].credentialsAtSpawn).toBeNull();
            expect(checkSession).not.toHaveBeenCalled();
        });

        test('a login file the launcher does not know is left alone', async () => {
            fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true });
            fs.writeFileSync(credentialsFile(), 'JX_CHARACTER_ID=made-by-runelite\nJX_SESSION_ID=theirs\n');

            expect((await setupLoader().loader.openRuneLite()).ok).toBe(true);

            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe('JX_CHARACTER_ID=made-by-runelite\nJX_SESSION_ID=theirs\n');
        });

        test('members without Jagex accounts in the launcher see no change at all', async () => {
            fs.rmSync(path.join(microbotDir, 'accounts.json'));
            fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true });
            fs.writeFileSync(credentialsFile(), 'JX_CHARACTER_ID=char-old\n');
            const spawn = launchable();

            expect(await setupLoader({ spawn }).loader.openRuneLite()).toEqual({ ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.' });

            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe('JX_CHARACTER_ID=char-old\n');
            expect(spawn).toHaveBeenCalledTimes(1);
            expect(checkSession).not.toHaveBeenCalled();
            expect(fs.existsSync(settingsFile)).toBe(false);
        });
    });

    describe('the Session Recorder start', () => {
        test('prepares the chosen character first and stops on an expired session', async () => {
            const setupSessionRecorder = require('../libs/session-recorder');
            const ipcMain = new FakeIpcMain();
            const written = [];
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.stdin = { writable: true, write: (text) => written.push(text) };
            const prepareCharacter = jest.fn(async () => ({ ok: false, error: MESSAGES.expired('Zezima'), relogin: true }));
            const settings = { sessionRecorder: true };
            const jar = fs.readFileSync(__filename);
            const sha = require('crypto').createHash('sha256').update(jar).digest('hex');
            setupSessionRecorder({
                ipcMain,
                log,
                fs,
                spawn: () => child,
                directory: dir,
                runelite: {
                    readSetting: (key) => settings[key],
                    writeSetting: (key, value) => (settings[key] = value),
                    javaForTools: async () => '/jdk/bin/java',
                    installedAgentJar: async () => '/agent.jar',
                    prepareCharacter
                },
                auth: {
                    email: () => 'admin@example.com',
                    request: async (config) =>
                        config.path === '/api/loader/recorder/info'
                            ? { data: { version: '1.0.0', sha256: sha, size: jar.length, url: '/api/loader/recorder' } }
                            : { data: jar }
                },
                getWindow: () => null
            });
            await ipcMain.invoke('session-recorder:state');
            for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
            child.stdout.emit('data', Buffer.from(require('../libs/session-recorder').STATUS_PREFIX + JSON.stringify({ state: 'ready', message: 'On.', recording: 0, unrecorded: 0 }) + '\n'));

            expect(await ipcMain.invoke('session-recorder:open')).toEqual({ ok: false, error: MESSAGES.expired('Zezima'), relogin: true });
            expect(written).toEqual([]);

            prepareCharacter.mockResolvedValue({ ok: true });
            expect((await ipcMain.invoke('session-recorder:open')).ok).toBe(true);
            expect(written).toEqual(['open\n']);
        });
    });

    test('setupRuneliteCharacters reads the same accounts.json the in-client switch reads, without changing it', async () => {
        const before = fs.readFileSync(path.join(microbotDir, 'accounts.json'), 'utf8');
        const settings = {};
        const characters = setupRuneliteCharacters({
            fs,
            log,
            microbotDir,
            home,
            readSetting: (key) => settings[key],
            writeSetting: (key, value) => {
                settings[key] = value;
                return true;
            },
            checkSession
        });

        characters.list();
        characters.choose('char-old');
        await characters.prepare();

        expect(fs.readFileSync(path.join(microbotDir, 'accounts.json'), 'utf8')).toBe(before);
    });
});
