const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const setupRuneliteLoader = require('../libs/runelite-loader');
const setupRuneliteCharacters = require('../libs/runelite-characters');
const { MESSAGES } = require('../libs/runelite-characters');
const accountsLoader = require('../libs/accounts-loader');
const createLaunchQueue = require('../libs/launch-queue');
const { writeCredentialProperties, WRITTEN_KEY } = require('../libs/overwrite-credential-properties');
const { sessionExpired, refreshSession } = require('../libs/jagex-session');

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
const STARTING = 'RuneLite is starting. Microbot will be in the sidebar.';

const ACCOUNTS = [
    { accountId: 'char-old', displayName: 'zezima', sessionId: SESSION_A, createdOn: '2026-01-01T00:00:00.000Z', profile: 'default' },
    { accountId: 'char-new', displayName: 'Lynx Titan', sessionId: SESSION_B, createdOn: '2026-11-01T00:00:00.000Z', proxyIp: '203.0.113.7:1080:user:secretpass' },
    { accountId: 'char-dupe', displayName: 'zezima', sessionId: SESSION_A, createdOn: '2025-06-01T00:00:00.000Z' },
    { accountId: 'char-unnamed', sessionId: SESSION_A, createdOn: '2026-05-01T00:00:00.000Z' },
    { accountId: 'char-alpha', displayName: 'Alpha', sessionId: SESSION_A, createdOn: '2026-04-01T00:00:00.000Z', proxyIp: '' }
];

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe('characters on the Microbot in RuneLite card', () => {
    let dir;
    let home;
    let microbotDir;
    let settingsFile;
    let log;
    let checkSession;
    let peekSession;

    const credentialsFile = () => path.join(home, '.runelite', 'credentials.properties');
    const logged = () => [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].map((args) => args.join(' ')).join('\n');
    const writeAccounts = (accounts) => fs.writeFileSync(path.join(microbotDir, 'accounts.json'), JSON.stringify(accounts, null, 2));
    const readAccountsFile = () => JSON.parse(fs.readFileSync(path.join(microbotDir, 'accounts.json'), 'utf8'));
    const readSettings = () => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {});
    const writeSettings = (value) => fs.writeFileSync(settingsFile, JSON.stringify(value));
    const launcherWrite = (account) => writeCredentialProperties({ fs, path, homeDir: home, settingsFile, log }, account);
    const foreignFile = (text) => {
        fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true });
        fs.writeFileSync(credentialsFile(), text);
    };

    const launchable = () => {
        const spawn = jest.fn(() => {
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
        const webContents = { send: jest.fn() };
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
            peekSession,
            getWindow: () => ({ isDestroyed: () => false, webContents, isMinimized: () => false, show: jest.fn(), focus: jest.fn() }),
            ...overrides
        });
        return { ipcMain, loader, webContents };
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runelite-characters-'));
        home = path.join(dir, 'home');
        microbotDir = path.join(home, '.microbot');
        fs.mkdirSync(microbotDir, { recursive: true });
        settingsFile = path.join(microbotDir, 'launcher-settings.json');
        log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        checkSession = jest.fn(async () => ({ ok: true, added: 0, updated: 0 }));
        peekSession = jest.fn(async () => ({ ok: true }));
        writeAccounts(ACCOUNTS);
    });

    afterEach(() => {
        jest.useRealTimers();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('the picker list', () => {
        test('is deduplicated by the shared read-accounts code and sorted A-Z like the sidebar', async () => {
            const ipcMain = new FakeIpcMain();
            await accountsLoader({ fs, path, microbotDir, ipcMain, log });
            const sidebar = await ipcMain.invoke('read-accounts');

            const { characters } = await setupLoader().ipcMain.invoke('runelite-loader:characters');

            expect(new Set(characters.map((character) => character.accountId))).toEqual(new Set(sidebar.map((account) => account.accountId)));
            expect(characters.map((character) => character.displayName)).toEqual(['Alpha', 'Lynx Titan', 'Not set', 'zezima']);
            expect(characters.find((character) => character.displayName === 'zezima').accountId).toBe('char-old');
        });

        test('never carries a session id or proxy login to the card', async () => {
            const data = await setupLoader().ipcMain.invoke('runelite-loader:characters');
            const text = JSON.stringify(data);

            expect(text).not.toContain(SESSION_A);
            expect(text).not.toContain(SESSION_B);
            expect(text).not.toContain('secretpass');
            expect(text).not.toContain('user');
            expect(data.characters.find((character) => character.accountId === 'char-new').proxy).toEqual({ host: '203.0.113.7' });
            expect(data.characters.find((character) => character.accountId === 'char-alpha').proxy).toBeNull();
        });

        test('never picked shows the character credentials.properties holds when the launcher knows it', async () => {
            foreignFile('JX_CHARACTER_ID=char-new\nJX_SESSION_ID=whatever\n');

            expect(await setupLoader().ipcMain.invoke('runelite-loader:characters')).toMatchObject({ chosen: 'char-new', picked: false, missing: null });

            foreignFile('JX_CHARACTER_ID=someone-else\n');
            expect(await setupLoader().ipcMain.invoke('runelite-loader:characters')).toMatchObject({ chosen: null, picked: false });
        });

        test('None is stored as its own value, different from never picked', async () => {
            writeSettings({ launcherMode: 'runelite', runelitePath: '/opt/RuneLite.AppImage' });
            foreignFile('JX_CHARACTER_ID=char-new\n');
            const { ipcMain } = setupLoader();

            expect(await ipcMain.invoke('runelite-loader:set-character', 'char-old')).toMatchObject({ chosen: 'char-old', picked: true });
            expect(readSettings()).toEqual({ launcherMode: 'runelite', runelitePath: '/opt/RuneLite.AppImage', runeliteCharacter: 'char-old' });

            expect(await ipcMain.invoke('runelite-loader:set-character', null)).toMatchObject({ chosen: null, picked: true });
            expect(readSettings()).toHaveProperty('runeliteCharacter', null);
        });

        test('an unknown character is refused and not saved', async () => {
            const result = await setupLoader().ipcMain.invoke('runelite-loader:set-character', 'char-gone');

            expect(result).toMatchObject({ error: 'That character is no longer in the launcher. Add its Jagex account again, or choose None.' });
            expect(readSettings().runeliteCharacter).toBeUndefined();
        });

        test('a picked character that left accounts.json is reported as missing', async () => {
            writeSettings({ runeliteCharacter: 'char-gone' });

            expect(await setupLoader().ipcMain.invoke('runelite-loader:characters')).toMatchObject({ chosen: null, picked: true, missing: 'char-gone' });
        });

        test('unreadable launcher settings are not overwritten by the choice', async () => {
            fs.writeFileSync(settingsFile, '{ broken');

            const result = await setupLoader().ipcMain.invoke('runelite-loader:set-character', 'char-old');

            expect(result.error).toBe("Couldn't save which character to log in as. Pick it again.");
            expect(fs.readFileSync(settingsFile, 'utf8')).toBe('{ broken');
        });
    });

    describe('never picked: exactly as before', () => {
        test('the file’s login is checked read-only and credentials.properties is never written or removed', async () => {
            foreignFile('JX_CHARACTER_ID=char-new\nJX_SESSION_ID=file-session\n');
            const accountsBefore = fs.readFileSync(path.join(microbotDir, 'accounts.json'), 'utf8');
            const spawn = launchable();
            const { loader, webContents } = setupLoader({ spawn });

            expect(await loader.openRuneLite()).toEqual({ ok: true, message: STARTING });

            expect(peekSession).toHaveBeenCalledTimes(1);
            expect(peekSession.mock.calls[0][0]).toMatchObject({ accountId: 'char-new', sessionId: 'file-session', proxyIp: '203.0.113.7:1080:user:secretpass' });
            expect(checkSession).not.toHaveBeenCalled();
            expect(webContents.send).toHaveBeenCalledWith('runelite-loader:launch-status', { text: "Checking Lynx Titan's Jagex login..." });
            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe('JX_CHARACTER_ID=char-new\nJX_SESSION_ID=file-session\n');
            expect(fs.readFileSync(path.join(microbotDir, 'accounts.json'), 'utf8')).toBe(accountsBefore);
            expect(readSettings()).toEqual({});
            expect(spawn).toHaveBeenCalledTimes(1);
        });

        test('an expired file login still starts RuneLite, with a note and Log in again', async () => {
            launcherWrite(ACCOUNTS[0]);
            const before = fs.readFileSync(credentialsFile(), 'utf8');
            peekSession.mockResolvedValue({ ok: false, status: 401 });
            const spawn = launchable();

            expect(await setupLoader({ spawn }).loader.openRuneLite()).toEqual({
                ok: true,
                message: STARTING,
                notice: "zezima's saved login has expired; RuneLite will open on its login screen. Press Log in again to renew it.",
                relogin: true,
                accountId: 'char-old'
            });
            expect(spawn).toHaveBeenCalledTimes(1);
            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe(before);
        });

        test('a file login that cannot be checked starts RuneLite as before', async () => {
            launcherWrite(ACCOUNTS[0]);
            peekSession.mockResolvedValue({ ok: false });

            expect(await setupLoader().loader.openRuneLite()).toEqual({ ok: true, message: STARTING });
        });

        test('a file for a character the launcher does not know is not checked', async () => {
            foreignFile('JX_CHARACTER_ID=someone-else\nJX_SESSION_ID=theirs\n');

            expect((await setupLoader().loader.openRuneLite()).ok).toBe(true);
            expect(peekSession).not.toHaveBeenCalled();
        });

        test('the read-only check only asks Jagex, through the proxy, and closes the bridge', async () => {
            jest.resetModules();
            const close = jest.fn(async () => {});
            jest.doMock('../libs/login-proxy.js', () => ({
                ...jest.requireActual('../libs/login-proxy.js'),
                startLoginProxy: jest.fn(async () => ({ httpOptions: { proxy: false }, close }))
            }));
            const fresh = require('../libs/jagex-session');
            const expired = Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } });
            const axios = { get: jest.fn(async () => { throw expired; }) };

            const result = await fresh.peekSession({ axios, log }, 'file-session', '203.0.113.7:1080', { timeoutMs: 15000 });

            expect(result).toEqual({ ok: false, status: 401 });
            expect(fresh.sessionExpired(result)).toBe(true);
            expect(axios.get).toHaveBeenCalledWith('https://auth.jagex.com/game-session/v1/accounts', {
                proxy: false,
                timeout: 15000,
                headers: { Authorization: 'Bearer file-session' }
            });
            expect(close).toHaveBeenCalledTimes(1);
            expect(logged()).not.toContain('file-session');
            axios.get.mockResolvedValue({ data: [] });
            expect(await fresh.peekSession({ axios, log }, 'file-session', '')).toEqual({ ok: true });
            jest.dontMock('../libs/login-proxy.js');
        });

        test('members with no settings and no accounts see no change', async () => {
            fs.rmSync(path.join(microbotDir, 'accounts.json'));
            foreignFile('JX_CHARACTER_ID=char-old\n');

            expect(await setupLoader().loader.openRuneLite()).toEqual({ ok: true, message: STARTING });
            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe('JX_CHARACTER_ID=char-old\n');
            expect(fs.existsSync(settingsFile)).toBe(false);
        });

        test('unreadable launcher settings stop the start with a clear message', async () => {
            fs.writeFileSync(settingsFile, '{ broken');
            const spawn = launchable();

            const result = await setupLoader({ spawn }).loader.openRuneLite();

            expect(result).toEqual({ ok: false, error: MESSAGES.settings });
            expect(result.error).toContain("launcher-settings.json) can't be read");
            expect(spawn).not.toHaveBeenCalled();
            expect(fs.readFileSync(settingsFile, 'utf8')).toBe('{ broken');
        });
    });

    describe('Open RuneLite with a character chosen', () => {
        test('checks the session, writes its login owner-only and records it, then starts RuneLite as that character', async () => {
            writeSettings({ runeliteCharacter: 'char-old' });
            const spawn = launchable();
            const { loader, webContents } = setupLoader({ spawn, env: { PATH: '/usr/bin', HOME: home, JX_SESSION_ID: 'inherited-session' } });

            expect(await loader.openRuneLite()).toEqual({ ok: true, message: 'RuneLite is starting as zezima. Microbot will be in the sidebar.' });

            expect(checkSession.mock.calls[0][0]).toMatchObject({ accountId: 'char-old', sessionId: SESSION_A });
            expect(webContents.send).toHaveBeenCalledWith('runelite-loader:launch-status', { text: "Checking zezima's Jagex login..." });
            const written = fs.readFileSync(credentialsFile(), 'utf8');
            expect(written).toContain('JX_CHARACTER_ID=char-old\n');
            expect(written).toContain(`JX_SESSION_ID=${SESSION_A}\n`);
            expect(written).toContain('JX_DISPLAY_NAME=zezima\n');
            expect(spawn.children[0].credentialsAtSpawn).toBe(written);
            expect(spawn.mock.calls[0][2].env).toEqual({ PATH: '/usr/bin', HOME: home });
            if (process.platform !== 'win32') expect(fs.statSync(credentialsFile()).mode & 0o777).toBe(0o600);
            expect(readSettings()[WRITTEN_KEY]).toBe(crypto.createHash('sha256').update(written).digest('hex'));
            expect(JSON.stringify(readSettings())).not.toContain(SESSION_A);
            expect(logged()).not.toContain(SESSION_A);
        });

        test('an expired session asks the member to log in again and RuneLite does not start', async () => {
            writeSettings({ runeliteCharacter: 'char-old' });
            launcherWrite(ACCOUNTS[1]);
            const before = fs.readFileSync(credentialsFile(), 'utf8');
            checkSession.mockResolvedValue({ ok: false, status: 401, error: 'Request failed with status code 401' });
            const spawn = launchable();

            const result = await setupLoader({ spawn }).ipcMain.invoke('runelite-loader:open');

            expect(result).toEqual({
                ok: false,
                error: "zezima's Jagex login has expired. Press Log in again, then press Open RuneLite.",
                relogin: true,
                accountId: 'char-old'
            });
            expect(spawn).not.toHaveBeenCalled();
            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe(before);
            expect(logged()).not.toContain(SESSION_A);
        });

        test('a character without a session is expired without calling Jagex', async () => {
            writeAccounts([{ accountId: 'char-old', displayName: 'zezima', createdOn: '2026-01-01T00:00:00.000Z' }]);
            writeSettings({ runeliteCharacter: 'char-old' });

            expect(await setupLoader().loader.openRuneLite()).toMatchObject({ ok: false, relogin: true, accountId: 'char-old' });
            expect(checkSession).not.toHaveBeenCalled();
        });

        test('a check that fails says how, with and without a proxy, and nothing starts', async () => {
            checkSession.mockResolvedValue({ ok: false, error: 'getaddrinfo ENOTFOUND auth.jagex.com' });
            const spawn = launchable();

            writeSettings({ runeliteCharacter: 'char-old' });
            expect((await setupLoader({ spawn }).loader.openRuneLite()).error).toBe(
                "Couldn't check zezima's Jagex login. Check your connection, or choose None to log in inside RuneLite."
            );
            writeSettings({ runeliteCharacter: 'char-new' });
            expect((await setupLoader({ spawn }).loader.openRuneLite()).error).toBe(
                "Couldn't check Lynx Titan's Jagex login through 203.0.113.7. Check that the proxy works, or choose None to log in inside RuneLite."
            );
            checkSession.mockRejectedValue(new Error('boom'));
            expect((await setupLoader({ spawn }).loader.openRuneLite()).ok).toBe(false);
            checkSession.mockImplementation(() => new Promise(() => {}));
            expect((await setupLoader({ spawn, sessionTimeoutMs: 20 }).loader.openRuneLite()).ok).toBe(false);
            expect(spawn).not.toHaveBeenCalled();
        });

        test('a picked character that left the launcher does not start RuneLite', async () => {
            writeSettings({ runeliteCharacter: 'char-gone' });
            const spawn = launchable();

            expect(await setupLoader({ spawn }).loader.openRuneLite()).toEqual({ ok: false, error: MESSAGES.unknown });
            expect(spawn).not.toHaveBeenCalled();
        });

        test('Find RuneLite… checks after the file is chosen', async () => {
            writeSettings({ runeliteCharacter: 'char-old' });
            checkSession.mockResolvedValue({ ok: false, status: 401 });
            const chosen = path.join(dir, 'RuneLite.AppImage');
            fs.writeFileSync(chosen, '');
            const order = [];
            const dialog = {
                showOpenDialog: jest.fn(async () => {
                    order.push('dialog');
                    return { canceled: false, filePaths: [chosen] };
                })
            };
            const spawn = launchable();
            const { loader, webContents } = setupLoader({ spawn, dialog, finder: undefined });
            webContents.send.mockImplementation((channel) => channel === 'runelite-loader:launch-status' && order.push('checking'));

            expect(await loader.findAndOpen()).toMatchObject({ ok: false, relogin: true, opener: 'open' });
            expect(order).toEqual(['dialog', 'checking']);
            expect(spawn).not.toHaveBeenCalled();
            expect(readSettings().runelitePath).toBe(chosen);
        });
    });

    describe('Open RuneLite with None', () => {
        test('removes the login the launcher itself last wrote, even for a character no longer in accounts.json', async () => {
            launcherWrite({ accountId: 'char-deleted', displayName: 'Gone', sessionId: 'live-session' });
            writeSettings({ ...readSettings(), runeliteCharacter: null });
            const spawn = launchable();

            expect(await setupLoader({ spawn }).loader.openRuneLite()).toEqual({ ok: true, message: STARTING });

            expect(fs.existsSync(credentialsFile())).toBe(false);
            expect(spawn.children[0].credentialsAtSpawn).toBeNull();
            expect(readSettings()[WRITTEN_KEY]).toBeNull();
            expect(checkSession).not.toHaveBeenCalled();
        });

        test('never deletes a file the launcher did not write, even for a character the launcher knows', async () => {
            writeSettings({ runeliteCharacter: null });
            foreignFile('JX_CHARACTER_ID=char-old\nJX_SESSION_ID=theirs\n');

            expect((await setupLoader().loader.openRuneLite()).ok).toBe(true);
            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe('JX_CHARACTER_ID=char-old\nJX_SESSION_ID=theirs\n');
        });

        test('clears a file the launcher wrote before this update, recognised by its own format', async () => {
            launcherWrite(ACCOUNTS[0]);
            writeSettings({ runeliteCharacter: null });

            expect(readSettings()[WRITTEN_KEY]).toBeUndefined();
            expect((await setupLoader().loader.openRuneLite()).ok).toBe(true);
            expect(fs.existsSync(credentialsFile())).toBe(false);
        });

        test('leaves a file RuneLite wrote itself, with its tokens filled in', async () => {
            writeSettings({ runeliteCharacter: null });
            const runeliteFile = [
                '#Do not share this file with anyone',
                '#Fri Nov 21 10:00:00 CET 2026',
                'JX_CHARACTER_ID=char-old',
                'JX_SESSION_ID=theirs',
                'JX_REFRESH_TOKEN=refresh-value',
                'JX_DISPLAY_NAME=zezima',
                'JX_ACCESS_TOKEN=access-value',
                ''
            ].join('\n');
            foreignFile(runeliteFile);

            expect((await setupLoader().loader.openRuneLite()).ok).toBe(true);
            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe(runeliteFile);
        });

        test('leaves a Java-written file even with empty tokens', async () => {
            writeSettings({ runeliteCharacter: null });
            const javaFile = [
                '#Do not share this file with anyone',
                '#Sat Nov 21 17:28:19 CET 2026',
                'JX_CHARACTER_ID=char-old',
                'JX_SESSION_ID=theirs',
                'JX_REFRESH_TOKEN=',
                'JX_DISPLAY_NAME=zezima',
                'JX_ACCESS_TOKEN=',
                ''
            ].join('\n');
            foreignFile(javaFile);

            expect((await setupLoader().loader.openRuneLite()).ok).toBe(true);
            expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe(javaFile);
        });

        test('leaves a file that changed since the launcher wrote it', async () => {
            launcherWrite(ACCOUNTS[0]);
            writeSettings({ ...readSettings(), runeliteCharacter: null });
            fs.appendFileSync(credentialsFile(), 'JX_EXTRA=1\n');

            expect((await setupLoader().loader.openRuneLite()).ok).toBe(true);
            expect(fs.existsSync(credentialsFile())).toBe(true);
        });

        test('the Microbot client path records its writes too', async () => {
            const ipcMain = new FakeIpcMain();
            const overwrite = require('../libs/overwrite-credential-properties');
            const homedir = jest.spyOn(os, 'homedir').mockReturnValue(home);
            try {
                await overwrite({ fs, path, ipcMain, log, microbotDir });
                await ipcMain.invoke('overwrite-credential-properties', ACCOUNTS[0]);
            } finally {
                homedir.mockRestore();
            }
            expect(typeof readSettings()[WRITTEN_KEY]).toBe('string');
            writeSettings({ ...readSettings(), runeliteCharacter: null });

            expect((await setupLoader().loader.openRuneLite()).ok).toBe(true);
            expect(fs.existsSync(credentialsFile())).toBe(false);
        });
    });

    describe('the shared launch queue', () => {
        test('a card start waits for a Microbot client start that holds the queue', async () => {
            writeSettings({ runeliteCharacter: 'char-old' });
            const launchQueue = createLaunchQueue();
            let releaseClient;
            const clientDone = launchQueue.run(() => new Promise((resolve) => (releaseClient = resolve)));
            const spawn = launchable();
            const { loader, webContents } = setupLoader({ spawn, launchQueue, credentialsHoldMs: 0 });

            const opening = loader.openRuneLite();
            await flush();
            expect(webContents.send).toHaveBeenCalledWith('runelite-loader:launch-status', { text: 'Waiting for the previous client to finish starting...' });
            expect(checkSession).not.toHaveBeenCalled();
            expect(fs.existsSync(credentialsFile())).toBe(false);

            releaseClient();
            await clientDone;
            expect((await opening).ok).toBe(true);
            expect(spawn).toHaveBeenCalledTimes(1);
        });

        test('a Microbot client start queued after a card start waits out RuneLite reading the file', async () => {
            jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
            writeSettings({ runeliteCharacter: 'char-old' });
            const launchQueue = createLaunchQueue();
            const { loader } = setupLoader({ launchQueue, credentialsHoldMs: 20000 });

            expect((await loader.openRuneLite()).ok).toBe(true);
            const client = jest.fn();
            const clientDone = launchQueue.run(client);
            await flush();
            expect(client).not.toHaveBeenCalled();

            jest.advanceTimersByTime(20000);
            await clientDone;
            expect(client).toHaveBeenCalledTimes(1);
        });

        test('a card start that changes nothing does not hold the queue', async () => {
            const launchQueue = createLaunchQueue();
            const { loader } = setupLoader({ launchQueue, credentialsHoldMs: 60000 });

            expect((await loader.openRuneLite()).ok).toBe(true);
            const client = jest.fn();
            await launchQueue.run(client);
            expect(client).toHaveBeenCalledTimes(1);
        });

        test('the Session Recorder open goes through the queue and stops on an expired session', async () => {
            writeSettings({ runeliteCharacter: 'char-old', sessionRecorder: true });
            checkSession.mockResolvedValue({ ok: false, status: 401 });
            const launchQueue = createLaunchQueue();
            const { loader } = setupLoader({ launchQueue, credentialsHoldMs: 0 });
            const setupSessionRecorder = require('../libs/session-recorder');
            const { STATUS_PREFIX } = require('../libs/session-recorder');
            const ipcMain = new FakeIpcMain();
            const written = [];
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.stdin = { writable: true, write: (text) => written.push(text) };
            const jar = fs.readFileSync(__filename);
            const sha = crypto.createHash('sha256').update(jar).digest('hex');
            setupSessionRecorder({
                ipcMain,
                log,
                fs,
                spawn: () => child,
                directory: dir,
                runelite: { ...loader, javaForTools: async () => '/jdk/bin/java', installedAgentJar: async () => '/agent.jar' },
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
            await flush();
            child.stdout.emit('data', Buffer.from(STATUS_PREFIX + JSON.stringify({ state: 'ready', message: 'On.', recording: 0, unrecorded: 0 }) + '\n'));

            let releaseClient;
            launchQueue.run(() => new Promise((resolve) => (releaseClient = resolve)));
            const opening = ipcMain.invoke('session-recorder:open');
            await flush();
            expect(checkSession).not.toHaveBeenCalled();
            releaseClient();

            expect(await opening).toMatchObject({ ok: false, relogin: true });
            expect(written).toEqual([]);

            checkSession.mockResolvedValue({ ok: true });
            expect((await ipcMain.invoke('session-recorder:open')).ok).toBe(true);
            expect(written).toEqual(['open\n']);
            expect(fs.readFileSync(credentialsFile(), 'utf8')).toContain('JX_CHARACTER_ID=char-old\n');
        });
    });

    describe('logging in from the card', () => {
        const authWith = (fetched, { error } = {}) => {
            const { mergeAccounts } = jest.requireActual('../libs/oauth-jagex.js');
            const startAuthFlow = jest.fn(async ({ proxy, keepProxies }) => {
                if (error) throw error;
                const fields = keepProxies ? (isNew) => (isNew ? { proxyIp: proxy.proxyIp } : {}) : { proxyIp: proxy.proxyIp };
                const { accounts } = mergeAccounts(readAccountsFile(), fetched, 'fresh-session', '2026-11-21T00:00:00.000Z', fields);
                writeAccounts(accounts);
                return 'Authentication successful.';
            });
            return { startAuthFlow, authFlowRunning: jest.fn(() => false) };
        };

        test('Add Jagex account logs in without a proxy and keeps every existing proxyIp; one new character is selected', async () => {
            const jagexAuth = authWith([
                { accountId: 'char-new', displayName: 'Lynx Titan' },
                { accountId: 'char-woox', displayName: 'Woox' }
            ]);

            const result = await setupLoader({ jagexAuth }).ipcMain.invoke('runelite-loader:login', null);

            expect(jagexAuth.startAuthFlow).toHaveBeenCalledWith({ proxy: { proxyIp: '' }, keepProxies: true });
            const stored = readAccountsFile();
            expect(stored.find((account) => account.accountId === 'char-new').proxyIp).toBe('203.0.113.7:1080:user:secretpass');
            expect(stored.find((account) => account.accountId === 'char-old').proxyIp).toBeUndefined();
            expect(stored.find((account) => account.accountId === 'char-woox').proxyIp).toBe('');
            expect(result).toMatchObject({ added: 1, chosen: 'char-woox', picked: true });
            expect(readSettings().runeliteCharacter).toBe('char-woox');
        });

        test('several new characters are counted and none is picked for the member', async () => {
            const jagexAuth = authWith([
                { accountId: 'char-x', displayName: 'Xenon' },
                { accountId: 'char-y', displayName: 'Yew' }
            ]);

            const result = await setupLoader({ jagexAuth }).ipcMain.invoke('runelite-loader:login', null);

            expect(result).toMatchObject({ added: 2, picked: false });
            expect(readSettings().runeliteCharacter).toBeUndefined();
        });

        test('Log in again goes through the character’s own proxy, changes no proxy and reports the new session', async () => {
            const jagexAuth = authWith([{ accountId: 'char-new', displayName: 'Lynx Titan' }, { accountId: 'char-alpha', displayName: 'Alpha' }]);

            const result = await setupLoader({ jagexAuth }).ipcMain.invoke('runelite-loader:login', 'char-new');

            expect(jagexAuth.startAuthFlow).toHaveBeenCalledWith({ proxy: { proxyIp: '203.0.113.7:1080:user:secretpass' }, keepProxies: true });
            const stored = readAccountsFile();
            expect(stored.find((account) => account.accountId === 'char-new')).toMatchObject({ proxyIp: '203.0.113.7:1080:user:secretpass', sessionId: 'fresh-session' });
            expect(stored.find((account) => account.accountId === 'char-alpha').proxyIp).toBe('');
            expect(result).toMatchObject({ renewed: true, added: 0 });
            expect(JSON.stringify(result)).not.toContain('fresh-session');
        });

        test('Log in again into a Jagex account without that character is not a renewal and says so', async () => {
            const jagexAuth = authWith([{ accountId: 'char-other', displayName: 'Other' }]);

            expect(await setupLoader({ jagexAuth }).ipcMain.invoke('runelite-loader:login', 'char-old')).toMatchObject({
                renewed: false,
                error: "That login didn't include zezima. Log in to the Jagex account that has zezima."
            });
        });

        test('Log in again for the never-picked file character makes it the choice once renewed', async () => {
            launcherWrite(ACCOUNTS[0]);
            const jagexAuth = authWith([{ accountId: 'char-old', displayName: 'zezima' }]);

            const result = await setupLoader({ jagexAuth }).ipcMain.invoke('runelite-loader:login', 'char-old');

            expect(result).toMatchObject({ renewed: true, chosen: 'char-old', picked: true });
            expect(readSettings().runeliteCharacter).toBe('char-old');
        });

        test('the list says whether the launcher has saved proxies', async () => {
            expect((await setupLoader().ipcMain.invoke('runelite-loader:characters')).proxiesSaved).toBe(true);
            writeAccounts([ACCOUNTS[0]]);
            expect((await setupLoader().ipcMain.invoke('runelite-loader:characters')).proxiesSaved).toBe(false);
            fs.writeFileSync(path.join(microbotDir, 'resource_versions.json'), JSON.stringify({ proxies: [{ name: 'home', address: '198.51.100.2:1080' }] }));
            expect((await setupLoader().ipcMain.invoke('runelite-loader:characters')).proxiesSaved).toBe(true);
        });

        test('a login already open says so and starts nothing', async () => {
            const jagexAuth = authWith([]);
            jagexAuth.authFlowRunning.mockReturnValue(true);

            expect(await setupLoader({ jagexAuth }).ipcMain.invoke('runelite-loader:login', null)).toMatchObject({ error: 'A Jagex login is already open in your browser.' });
            expect(jagexAuth.startAuthFlow).not.toHaveBeenCalled();
        });

        test('a cancelled login reports cancelled, a failed one its message', async () => {
            const cancelled = Object.assign(new Error('Login cancelled.'), { code: 'CANCELLED' });
            expect(await setupLoader({ jagexAuth: authWith([], { error: cancelled }) }).ipcMain.invoke('runelite-loader:login', null)).toMatchObject({ cancelled: true });
            expect(await setupLoader({ jagexAuth: authWith([], { error: new Error('Browser was closed before authentication flow completed.') }) }).ipcMain.invoke('runelite-loader:login', null)).toMatchObject({
                error: 'Browser was closed before authentication flow completed.'
            });
        });
    });

    describe('oauth-jagex keeps proxies for card logins', () => {
        let mergeAccounts;

        beforeAll(() => {
            jest.isolateModules(() => {
                jest.doMock('patchright', () => ({ chromium: {} }));
                jest.doMock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
                jest.doMock('electron-log', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
                ({ mergeAccounts } = require('../libs/oauth-jagex.js'));
            });
        });

        test('fields for new characters only leave existing proxies alone', () => {
            const { accounts } = mergeAccounts(
                [{ accountId: 'a', displayName: 'A', proxyIp: '1.2.3.4:1080', sessionId: 'old' }],
                [{ accountId: 'a', displayName: 'A' }, { accountId: 'b', displayName: 'B' }],
                'new',
                '2026-11-21T00:00:00.000Z',
                (isNew) => (isNew ? { proxyIp: '' } : {})
            );

            expect(accounts).toEqual([
                { accountId: 'a', displayName: 'A', proxyIp: '1.2.3.4:1080', sessionId: 'new' },
                { accountId: 'b', displayName: 'B', proxyIp: '', sessionId: 'new', createdOn: '2026-11-21T00:00:00.000Z' }
            ]);
        });

        test('the sidebar login still sets the proxy on every character it logs in', () => {
            const { accounts } = mergeAccounts(
                [{ accountId: 'a', displayName: 'A', proxyIp: '1.2.3.4:1080', sessionId: 'old' }],
                [{ accountId: 'a', displayName: 'A' }],
                'new',
                '2026-11-21T00:00:00.000Z',
                { proxyIp: '' }
            );

            expect(accounts[0].proxyIp).toBe('');
        });
    });

    describe('credentials file details', () => {
        test('an existing file is tightened to owner-only', () => {
            if (process.platform === 'win32') return;
            fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true });
            fs.writeFileSync(credentialsFile(), 'old\n', { mode: 0o644 });
            fs.chmodSync(credentialsFile(), 0o644);

            launcherWrite(ACCOUNTS[0]);

            expect(fs.statSync(credentialsFile()).mode & 0o777).toBe(0o600);
        });

        test('a chmod EPERM is logged by code and the write still counts', () => {
            const eperm = Object.assign(new Error('operation not permitted, chmod /secret/path'), { code: 'EPERM' });
            const fakeFs = { ...fs, chmodSync: jest.fn(() => { throw eperm; }) };

            expect(() => writeCredentialProperties({ fs: fakeFs, path, homeDir: home, settingsFile, log }, ACCOUNTS[0])).not.toThrow();

            expect(fs.readFileSync(credentialsFile(), 'utf8')).toContain('JX_CHARACTER_ID=char-old\n');
            expect(log.warn).toHaveBeenCalledWith('Could not make credentials.properties owner-only: EPERM');
            expect(typeof readSettings()[WRITTEN_KEY]).toBe('string');
        });

        test('other chmod failures still fail the write', () => {
            const eio = Object.assign(new Error('io'), { code: 'EIO' });
            const fakeFs = { ...fs, chmodSync: () => { throw eio; } };

            expect(() => writeCredentialProperties({ fs: fakeFs, path, homeDir: home }, ACCOUNTS[0])).toThrow('io');
        });
    });

    describe('session check', () => {
        test('401 and 403 are expired, anything else is unchecked', () => {
            expect(sessionExpired({ ok: false, status: 401 })).toBe(true);
            expect(sessionExpired({ ok: false, status: 403 })).toBe(true);
            expect(sessionExpired({ ok: false, status: 500 })).toBe(false);
            expect(sessionExpired({ ok: false })).toBe(false);
        });

        test('the request gets its own timeout, and the proxy bridge closes when it fails', async () => {
            jest.resetModules();
            const close = jest.fn(async () => {});
            jest.doMock('../libs/login-proxy.js', () => ({
                ...jest.requireActual('../libs/login-proxy.js'),
                startLoginProxy: jest.fn(async () => ({ httpOptions: { proxy: false }, close }))
            }));
            const fresh = require('../libs/jagex-session');
            const timedOut = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
            const writeAccountsToFile = jest.fn(async () => {
                throw timedOut;
            });

            await expect(fresh.refreshSession({ writeAccountsToFile, log }, SESSION_B, '203.0.113.7:1080', { timeoutMs: 15000 })).rejects.toThrow('timeout');
            expect(writeAccountsToFile).toHaveBeenCalledWith(SESSION_B, { proxy: false, timeout: 15000 });
            expect(close).toHaveBeenCalledTimes(1);

            const direct = jest.fn(async () => ({ ok: true }));
            await fresh.refreshSession({ writeAccountsToFile: direct, log }, SESSION_A, '', { timeoutMs: 15000 });
            expect(direct).toHaveBeenCalledWith(SESSION_A, { timeout: 15000 });
            jest.dontMock('../libs/login-proxy.js');
        });

        test('Refresh accounts keeps calling it without a timeout', async () => {
            const direct = jest.fn(async () => ({ ok: true }));
            await refreshSession({ writeAccountsToFile: direct, log }, SESSION_A, '');
            expect(direct).toHaveBeenCalledWith(SESSION_A);
        });

        test('the card’s default check uses the account proxy and a request timeout', async () => {
            jest.resetModules();
            const writeAccountsToFile = jest.fn(async () => ({ ok: true }));
            jest.doMock('../libs/oauth-jagex.js', () => ({ writeAccountsToFile }));
            jest.doMock('../libs/login-proxy.js', () => ({
                ...jest.requireActual('../libs/login-proxy.js'),
                startLoginProxy: jest.fn(async () => ({ httpOptions: { proxy: false, marker: 'via-proxy' }, close: async () => {} }))
            }));
            const freshSetup = require('../libs/runelite-characters');
            const settings = { runeliteCharacter: 'char-new' };
            const characters = freshSetup({ fs, log, microbotDir, home, readSettings: () => settings, writeSetting: () => true });

            expect(await characters.prepare()).toMatchObject({ ok: true, touched: true, name: 'Lynx Titan' });
            expect(writeAccountsToFile).toHaveBeenCalledWith(SESSION_B, { proxy: false, marker: 'via-proxy', timeout: 15000 });
            jest.dontMock('../libs/oauth-jagex.js');
            jest.dontMock('../libs/login-proxy.js');
        });
    });

    test('the card reads accounts.json without changing it', async () => {
        const before = fs.readFileSync(path.join(microbotDir, 'accounts.json'), 'utf8');
        const settings = {};
        const characters = setupRuneliteCharacters({
            fs,
            log,
            microbotDir,
            home,
            readSettings: () => settings,
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
