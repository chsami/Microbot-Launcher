const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const setupRuneliteLoader = require('../libs/runelite-loader');
const { parseStatus, parseAgent, MESSAGES } = require('../libs/runelite-loader');
const { PROBE_ARGS } = require('../libs/java-runtime');

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

const TOKEN = `mbc_${'Q'.repeat(43)}`;
const JAR = Buffer.from('PK\u0003\u0004 microbot agent 1.0.0');
const JAR_SHA = crypto.createHash('sha256').update(JAR).digest('hex');
const OTHER_SHA = 'f'.repeat(64);
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('runelite-loader', () => {
    let dir;
    let downloadsDir;
    let agentJar;
    let log;
    let email;
    let access;
    let served;
    let auth;
    let alerts;
    let cli;
    let spawn;
    let children;
    let managedJdk;
    let settingsFile;

    const logged = () => [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].map((args) => args.join(' ')).join('\n');
    const agentRuns = () => children.filter((child) => child.args[0] === '-jar');
    const runsOf = (flag) => agentRuns().filter((child) => child.args[2] === flag);

    const setup = (overrides = {}) => {
        const ipcMain = new FakeIpcMain();
        const webContents = { send: jest.fn() };
        const loader = setupRuneliteLoader({
            ipcMain,
            log,
            fs,
            spawn,
            auth,
            alerts,
            axios: {},
            microbotDir: dir,
            downloadsDir,
            agentJar,
            settingsFile,
            managedJdk,
            getWindow: () => ({ isDestroyed: () => false, webContents }),
            ...overrides
        });
        return { ipcMain, loader, webContents };
    };

    const respond = (child, { code = 0, stdout = '', stderr = '' }) => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout));
        if (stderr) child.stderr.emit('data', Buffer.from(stderr));
        child.emit('close', code);
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runelite-loader-'));
        downloadsDir = path.join(dir, 'loader', 'downloads');
        agentJar = path.join(dir, 'loader', 'agent.jar');
        settingsFile = path.join(dir, 'launcher-settings.json');
        log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        email = 'admin@example.com';
        access = { available: true, agent: { version: '1.0.0', sha256: JAR_SHA, size: JAR.length, url: '/api/loader/agent' } };
        served = { data: JAR, headers: { 'x-content-sha256': JAR_SHA } };
        auth = {
            email: () => email,
            request: jest.fn(async (config) => {
                if (config.path === '/api/loader/access') {
                    if (access instanceof Error) throw access;
                    return { data: access };
                }
                if (config.path === '/api/loader/agent') {
                    if (served instanceof Error) throw served;
                    return { data: served.data, headers: served.headers };
                }
                throw httpError(404);
            })
        };
        alerts = { tokenForLoader: jest.fn(async () => TOKEN), forgetLoaderToken: jest.fn(async () => {}) };
        cli = {
            install: { code: 0, stdout: 'Microbot was added to RuneLite.\n' },
            status: { code: 0, stdout: JSON.stringify({ installed: true, settingsPath: '/home/p/.runelite/settings.json', launchMode: 'JVM', signedIn: true, agentVersion: '1.0.0', agentSha256: JAR_SHA }) },
            remove: { code: 0, stdout: 'Microbot was removed from RuneLite.\n' }
        };
        children = [];
        managedJdk = { javaPath: () => path.join(dir, 'jdk', 'bin', 'java'), install: jest.fn() };
        spawn = jest.fn((command, args, options) => {
            const child = new EventEmitter();
            child.command = command;
            child.args = args;
            child.options = options;
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.kill = jest.fn();
            child.stdinText = null;
            child.stdin = Object.assign(new EventEmitter(), {
                end: jest.fn((text) => {
                    child.stdinText = text;
                    if (args[2] === '--install') setImmediate(() => respond(child, cli.install));
                })
            });
            children.push(child);
            if (args === PROBE_ARGS) {
                setImmediate(() => respond(child, { stderr: '    java.version = 17.0.12\n    java.home = /usr/lib/jvm/17\n' }));
            } else if (args[2] === '--status') {
                setImmediate(() => respond(child, cli.status));
            } else if (args[2] === '--remove') {
                setImmediate(() => respond(child, cli.remove));
            }
            return child;
        });
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('who sees the card', () => {
        test('nothing shows when the API says the account is not in the audience', async () => {
            access = { available: false, reason: 'not-in-audience', message: 'Not for you yet.' };
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toEqual({ visible: false });
            expect(spawn).not.toHaveBeenCalled();
        });

        test('nothing shows when there is no release yet', async () => {
            access = { available: false, reason: 'no-release', message: 'No release.' };
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toEqual({ visible: false });
        });

        test('nothing shows on 401', async () => {
            access = httpError(401);
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toEqual({ visible: false });
            expect(log.warn).not.toHaveBeenCalled();
        });

        test('nothing shows and nothing is asked when signed out', async () => {
            email = null;
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toEqual({ visible: false });
            expect(auth.request).not.toHaveBeenCalled();
        });

        test('nothing shows when the API cannot be reached or has no endpoint yet', async () => {
            access = new Error('socket hang up');
            expect(await setup().ipcMain.invoke('runelite-loader:state')).toEqual({ visible: false });
            access = httpError(404);
            expect(await setup().ipcMain.invoke('runelite-loader:state')).toEqual({ visible: false });
        });

        test('a release with a bad version, hash or foreign url is ignored', async () => {
            access.agent.url = 'https://evil.example/agent.jar';
            expect(await setup().ipcMain.invoke('runelite-loader:state')).toEqual({ visible: false });
            expect(parseAgent({ ...access.agent, url: '//evil.example/a' })).toBeNull();
            expect(parseAgent({ ...access.agent, url: '/api/loader/agent', version: '../x' })).toBeNull();
            expect(parseAgent({ ...access.agent, url: '/api/loader/agent', sha256: 'abc' })).toBeNull();
            expect(parseAgent({ ...access.agent, url: '/api/loader/agent', size: 0 })).toBeNull();
            expect(parseAgent({ version: '1.0.0', sha256: JAR_SHA.toUpperCase(), size: 10 })).toEqual({ version: '1.0.0', sha256: JAR_SHA, size: 10, path: '/api/loader/agent' });
        });

        test('an install refused by access tells the member it is not available', async () => {
            access = { available: false, reason: 'not-in-audience' };
            const { loader } = setup();

            expect(await loader.install()).toEqual({ visible: false, error: MESSAGES.unavailable });
            expect(alerts.tokenForLoader).not.toHaveBeenCalled();
        });
    });

    describe('state', () => {
        test('not added when no agent is on this PC, without starting Java', async () => {
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toEqual({ visible: true, state: 'not-added', version: '1.0.0', mode: 'client' });
            expect(spawn).not.toHaveBeenCalled();
        });

        test('added when the installed agent matches the release', async () => {
            fs.mkdirSync(path.dirname(agentJar), { recursive: true });
            fs.writeFileSync(agentJar, JAR);
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toEqual({ visible: true, state: 'added', version: '1.0.0', mode: 'client' });
            expect(runsOf('--status')).toHaveLength(1);
            expect(runsOf('--status')[0].args).toEqual(['-jar', agentJar, '--status', '--json']);
        });

        test('update when the release has a different hash than the installed agent', async () => {
            fs.mkdirSync(path.dirname(agentJar), { recursive: true });
            fs.writeFileSync(agentJar, JAR);
            access.agent.sha256 = OTHER_SHA;
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toMatchObject({ visible: true, state: 'update', reason: 'new-version' });
        });

        test('not added when the status says so', async () => {
            fs.mkdirSync(path.dirname(agentJar), { recursive: true });
            fs.writeFileSync(agentJar, JAR);
            cli.status.stdout = JSON.stringify({ installed: false, settingsPath: null, launchMode: null, signedIn: false, agentVersion: null, agentSha256: null });
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toMatchObject({ state: 'not-added' });
        });

        test('signed out inside RuneLite offers the update to sign it in again', async () => {
            fs.mkdirSync(path.dirname(agentJar), { recursive: true });
            fs.writeFileSync(agentJar, JAR);
            cli.status.stdout = JSON.stringify({ installed: true, signedIn: false, agentVersion: '1.0.0', agentSha256: JAR_SHA });
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toMatchObject({ state: 'update', reason: 'signed-out' });
        });

        test('parses the status object, skipping JVM noise around it', () => {
            const output = [
                'Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8',
                '{"installed":true,"settingsPath":"C:\\\\Users\\\\p\\\\.runelite\\\\settings.json","launchMode":"JVM","signedIn":true,"agentVersion":"1.0.0","agentSha256":"ABC"}',
                ''
            ].join('\n');

            expect(parseStatus(output)).toEqual({
                installed: true,
                settingsPath: 'C:\\Users\\p\\.runelite\\settings.json',
                launchMode: 'JVM',
                signedIn: true,
                agentVersion: '1.0.0',
                agentSha256: 'abc'
            });
            expect(parseStatus('{"installed":"yes"}')).toMatchObject({ installed: false, signedIn: null, agentSha256: null });
            expect(parseStatus('not json')).toBeNull();
            expect(parseStatus('[1,2]')).toBeNull();
            expect(parseStatus('')).toBeNull();
        });
    });

    describe('install', () => {
        test('downloads, verifies, links and installs with the token on stdin only', async () => {
            const { loader, webContents } = setup();

            const result = await loader.install();

            expect(result).toEqual({ visible: true, state: 'added', version: '1.0.0', mode: 'client', message: 'Microbot was added to RuneLite.' });
            const target = path.join(downloadsDir, 'agent-1.0.0.jar');
            expect(fs.readFileSync(target)).toEqual(JAR);
            expect(fs.readdirSync(downloadsDir)).toEqual(['agent-1.0.0.jar']);
            const [run] = runsOf('--install');
            expect(run.args).toEqual(['-jar', target, '--install', '--token-stdin']);
            expect(run.stdinText).toBe(`${TOKEN}\n`);
            children.forEach((child) => {
                expect(JSON.stringify(child.args)).not.toContain(TOKEN);
                expect(JSON.stringify(child.options || {})).not.toContain(TOKEN);
                expect(child.options?.env).toBeUndefined();
            });
            expect(JSON.stringify(process.env)).not.toContain(TOKEN);
            expect(logged()).not.toContain(TOKEN);
            expect(JSON.stringify(webContents.send.mock.calls)).not.toContain(TOKEN);
            expect(JSON.stringify(result)).not.toContain(TOKEN);
            expect(webContents.send).toHaveBeenCalledWith('runelite-loader:progress', { text: 'Adding Microbot to RuneLite...' });
            const download = auth.request.mock.calls.find(([config]) => config.path === '/api/loader/agent')[0];
            expect(download).toMatchObject({ method: 'get', responseType: 'arraybuffer' });
            expect(download.timeout).toBeGreaterThan(0);
        });

        test('a CLI that echoes the token never gets it into the logs or the card', async () => {
            cli.install = { code: 2, stdout: `token ${TOKEN}\n`, stderr: `RuneLite rejected ${TOKEN}.\n` };
            const { loader } = setup();

            const result = await loader.install();

            expect(result.error).toBe('RuneLite rejected ***.');
            expect(logged()).not.toContain(TOKEN);
            expect(JSON.stringify(result)).not.toContain(TOKEN);
        });

        test('a failed install shows the CLI sentence', async () => {
            cli.install = { code: 1, stderr: 'WARNING: something from the JVM\nClose RuneLite first, then try again.\n' };
            cli.status.stdout = JSON.stringify({ installed: false, signedIn: false, agentSha256: null });
            const { loader } = setup();

            const result = await loader.install();

            expect(result).toMatchObject({ visible: true, state: 'not-added', error: 'Close RuneLite first, then try again.' });
        });

        test('a failed install with no output gets a plain sentence', async () => {
            cli.install = { code: 1 };
            const { loader } = setup();

            expect((await loader.install()).error).toBe(MESSAGES.install);
        });

        test('a download with the wrong SHA-256 is rejected and deleted', async () => {
            const tampered = Buffer.from(JAR);
            tampered[tampered.length - 1] ^= 1;
            served = { data: tampered, headers: {} };
            expect(served.data.length).toBe(JAR.length);
            const { loader } = setup();

            const result = await loader.install();

            expect(result.error).toBe(MESSAGES.damaged);
            expect(fs.readdirSync(downloadsDir)).toEqual([]);
            expect(runsOf('--install')).toHaveLength(0);
            expect(alerts.tokenForLoader).not.toHaveBeenCalled();
        });

        test('a download with the wrong size is rejected', async () => {
            served = { data: Buffer.concat([JAR, Buffer.from('x')]), headers: {} };
            const { loader } = setup();

            expect((await loader.install()).error).toBe(MESSAGES.damaged);
            expect(fs.readdirSync(downloadsDir)).toEqual([]);
        });

        test('a download whose X-Content-SHA256 disagrees is rejected', async () => {
            served = { data: JAR, headers: { 'x-content-sha256': OTHER_SHA } };
            const { loader } = setup();

            expect((await loader.install()).error).toBe(MESSAGES.damaged);
            expect(fs.readdirSync(downloadsDir)).toEqual([]);
        });

        test('a damaged earlier download is replaced', async () => {
            fs.mkdirSync(downloadsDir, { recursive: true });
            fs.writeFileSync(path.join(downloadsDir, 'agent-1.0.0.jar'), 'broken');
            fs.writeFileSync(path.join(downloadsDir, 'agent-0.9.0.jar'), 'old');
            const { loader } = setup();

            expect((await loader.install()).state).toBe('added');
            expect(fs.readFileSync(path.join(downloadsDir, 'agent-1.0.0.jar'))).toEqual(JAR);
            expect(fs.readdirSync(downloadsDir)).toEqual(['agent-1.0.0.jar']);
        });

        test('a verified download is reused', async () => {
            const { loader } = setup();
            await loader.install();
            await loader.install();

            expect(auth.request.mock.calls.filter(([config]) => config.path === '/api/loader/agent')).toHaveLength(1);
        });

        test('a network failure during the download gets a plain sentence', async () => {
            served = new Error('ECONNRESET');
            const { loader } = setup();

            expect((await loader.install()).error).toBe(MESSAGES.offline);
        });

        test('a token that cannot be created stops before the CLI runs', async () => {
            alerts.tokenForLoader.mockRejectedValue(Object.assign(new Error('HTTP 500'), { response: { status: 500 } }));
            const { loader } = setup();

            expect((await loader.install()).error).toBe(MESSAGES.link);
            expect(runsOf('--install')).toHaveLength(0);
        });

        test('Java 17 is installed into the launcher folder when none is found', async () => {
            const managedJava = path.join(dir, 'jdk', 'bin', 'java');
            const realSpawn = spawn.getMockImplementation();
            spawn.mockImplementation((command, args, options) => {
                if (args === PROBE_ARGS && command === 'java') {
                    const child = realSpawn(command, ['none'], options);
                    child.args = args;
                    setImmediate(() => child.emit('error', Object.assign(new Error('spawn java ENOENT'), { code: 'ENOENT' })));
                    return child;
                }
                return realSpawn(command, args, options);
            });
            managedJdk.install.mockImplementation(async ({ onProgress }) => {
                onProgress(40, 'Downloading Java 17...');
                fs.mkdirSync(path.dirname(managedJava), { recursive: true });
                fs.writeFileSync(managedJava, '');
                return managedJava;
            });
            const { loader, webContents } = setup();

            expect((await loader.install()).state).toBe('added');
            expect(runsOf('--install')[0].command).toBe(managedJava);
            expect(webContents.send).toHaveBeenCalledWith('runelite-loader:progress', { text: 'Downloading Java 17... 40%' });
        });

        test('a CLI that hangs is stopped and the member is told', async () => {
            jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
            try {
                cli.install = null;
                const realSpawn = spawn.getMockImplementation();
                spawn.mockImplementation((command, args, options) => {
                    const child = realSpawn(command, args, options);
                    if (args[2] === '--install') child.stdin.end = jest.fn((text) => (child.stdinText = text));
                    return child;
                });
                const { loader } = setup();
                const pending = loader.install();
                for (let i = 0; i < 50 && !runsOf('--install').length; i += 1) await flush();
                expect(runsOf('--install')).toHaveLength(1);
                jest.advanceTimersByTime(90000);

                expect((await pending).error).toBe(MESSAGES.timeout);
                expect(runsOf('--install')[0].kill).toHaveBeenCalled();
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('one at a time', () => {
        test('concurrent clicks run one install', async () => {
            const { ipcMain } = setup();

            const results = await Promise.all([
                ipcMain.invoke('runelite-loader:install'),
                ipcMain.invoke('runelite-loader:install'),
                ipcMain.invoke('runelite-loader:install')
            ]);

            expect(results[0]).toEqual(results[1]);
            expect(results[1]).toEqual(results[2]);
            expect(runsOf('--install')).toHaveLength(1);
            expect(alerts.tokenForLoader).toHaveBeenCalledTimes(1);
            expect(auth.request.mock.calls.filter(([config]) => config.path === '/api/loader/agent')).toHaveLength(1);
        });

        test('remove during an install is refused, and the card shows it is working', async () => {
            const { loader } = setup();

            const installing = loader.install();
            const removing = await loader.remove();
            const during = await loader.state();
            await installing;

            expect(removing).toMatchObject({ state: 'working', error: MESSAGES.busy });
            expect(during).toMatchObject({ visible: true, state: 'working' });
            expect(runsOf('--remove')).toHaveLength(0);
        });

        test('a new install can start after the first one finished', async () => {
            const { loader } = setup();
            await loader.install();
            await loader.install();

            expect(runsOf('--install')).toHaveLength(2);
        });
    });

    describe('remove', () => {
        beforeEach(() => {
            fs.mkdirSync(path.dirname(agentJar), { recursive: true });
            fs.writeFileSync(agentJar, JAR);
        });

        test('runs --remove and unlinks the RuneLite token', async () => {
            cli.status.stdout = JSON.stringify({ installed: true, signedIn: true, agentSha256: JAR_SHA });
            const { ipcMain } = setup();
            expect((await ipcMain.invoke('runelite-loader:state')).state).toBe('added');
            cli.status.stdout = JSON.stringify({ installed: false, signedIn: false, agentSha256: null });

            const result = await ipcMain.invoke('runelite-loader:remove');

            expect(result).toEqual({ visible: true, state: 'not-added', version: '1.0.0', mode: 'client', message: 'Microbot was removed from RuneLite.' });
            expect(runsOf('--remove')).toHaveLength(1);
            expect(runsOf('--remove')[0].args).toEqual(['-jar', agentJar, '--remove']);
            expect(runsOf('--remove')[0].stdinText).toBe('');
            expect(alerts.forgetLoaderToken).toHaveBeenCalledTimes(1);
            expect(alerts.tokenForLoader).not.toHaveBeenCalled();
        });

        test('a failed remove shows the CLI sentence and keeps the link', async () => {
            cli.remove = { code: 3, stderr: 'Close RuneLite first, then try again.\n' };
            const { loader } = setup();

            const result = await loader.remove();

            expect(result).toMatchObject({ state: 'added', error: 'Close RuneLite first, then try again.' });
            expect(alerts.forgetLoaderToken).not.toHaveBeenCalled();
        });
    });

    describe('which screen the launcher shows', () => {
        const settings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));

        test('the Microbot client is the default', async () => {
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:state')).toMatchObject({ visible: true, mode: 'client' });
        });

        test('the choice is remembered in the launcher settings, next to the other settings', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({ runInBackground: true, remoteStartFor: 'admin@example.com' }));
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:set-mode', 'runelite')).toEqual({ mode: 'runelite' });

            expect(settings()).toEqual({ runInBackground: true, remoteStartFor: 'admin@example.com', launcherMode: 'runelite' });
            expect(await setup().ipcMain.invoke('runelite-loader:state')).toMatchObject({ visible: true, mode: 'runelite' });
        });

        test('an unknown choice is refused', async () => {
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:set-mode', 'other')).toEqual({ error: 'Unknown view.', mode: 'client' });
            expect(fs.existsSync(settingsFile)).toBe(false);
        });

        test.each([
            ['the API leaves the account out', () => { access = { available: false, reason: 'not-in-audience' }; }],
            ['the session is gone', () => { access = httpError(401); }],
            ['the endpoint is forbidden', () => { access = httpError(403); }],
            ['the endpoint is missing', () => { access = httpError(404); }],
            ['the account signed out', () => { email = null; }]
        ])('falls back to the Microbot client when %s', async (_name, loseAccess) => {
            const { ipcMain } = setup();
            await ipcMain.invoke('runelite-loader:set-mode', 'runelite');
            loseAccess();

            expect(await ipcMain.invoke('runelite-loader:state')).toEqual({ visible: false });
            expect(settings().launcherMode).toBe('client');
        });

        test('an API outage hides the switch but keeps the choice for later', async () => {
            const { ipcMain } = setup();
            await ipcMain.invoke('runelite-loader:set-mode', 'runelite');
            access = new Error('socket hang up');

            expect(await ipcMain.invoke('runelite-loader:state')).toEqual({ visible: false });
            expect(settings().launcherMode).toBe('runelite');
        });

        test('install results carry the chosen screen', async () => {
            const { ipcMain, loader } = setup();
            await ipcMain.invoke('runelite-loader:set-mode', 'runelite');

            expect(await loader.install()).toMatchObject({ state: 'added', mode: 'runelite' });
        });
    });
});
