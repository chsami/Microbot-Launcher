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
            finder: { find: () => null, fromPath: () => null },
            env: { PATH: '/usr/bin', HOME: dir },
            home: dir,
            platform: 'linux',
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

            expect(await ipcMain.invoke('runelite-loader:state')).toEqual({ visible: true, state: 'added', opener: 'find', version: '1.0.0', mode: 'client' });
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
                agentSha256: 'abc',
                willLoad: null,
                enabled: true,
                lastStart: null
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

            expect(result).toEqual({ visible: true, state: 'added', opener: 'find', version: '1.0.0', mode: 'client', message: 'Microbot was added to RuneLite.' });
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

    describe('review fixes', () => {
        const installAgentJar = (file = agentJar) => {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JAR);
        };
        const statusWith = (fields) => {
            cli.status.stdout = JSON.stringify({ installed: true, settingsPath: null, launchMode: 'JVM', signedIn: true, agentVersion: '1.0.0', agentSha256: JAR_SHA, ...fields });
        };

        test('Update when RuneLite will not load the agent', async () => {
            installAgentJar();
            statusWith({ willLoad: false, lastStart: null });

            expect(await setup().loader.state()).toMatchObject({ state: 'update', reason: 'not-loading' });
        });

        const lastStart = (code, message = null) => ({ code, at: '2026-11-08T07:00:00Z', message });

        test('Update when the last RuneLite start was signed out', async () => {
            installAgentJar();
            statusWith({ willLoad: true, lastStart: lastStart('signed-out', 'The client token was refused.') });

            expect(await setup().loader.state()).toMatchObject({ state: 'update', reason: 'signed-out' });
        });

        test('not ready reads as added with a quiet note', async () => {
            installAgentJar();
            statusWith({ willLoad: true, lastStart: lastStart('not-ready') });

            expect(await setup().loader.state()).toEqual({ visible: true, state: 'added', note: 'not-ready', opener: 'find', version: '1.0.0', mode: 'client' });
        });

        test.each(['loaded', 'not-member', 'safe-mode', 'offline', 'error', 'something-new'])('a last start of %s reads as added', async (code) => {
            installAgentJar();
            statusWith({ willLoad: true, lastStart: lastStart(code, 'whatever') });

            expect(await setup().loader.state()).toEqual({ visible: true, state: 'added', opener: 'find', version: '1.0.0', mode: 'client' });
        });

        test('no last start yet reads as added', async () => {
            installAgentJar();
            statusWith({ willLoad: true, lastStart: null });

            expect(await setup().loader.state()).toMatchObject({ state: 'added' });
        });

        test('not-member without access is the remove-only state', async () => {
            installAgentJar();
            statusWith({ willLoad: true, lastStart: lastStart('not-member') });
            access = { available: false, reason: 'not-in-audience' };

            expect(await setup().loader.state()).toEqual({ visible: true, state: 'remove-only', mode: 'runelite' });
        });

        test('reads the new status fields and tolerates odd shapes', () => {
            expect(parseStatus(JSON.stringify({ installed: true, willLoad: false, lastStart: { code: 'Signed-Out', at: '2026-11-08T07:00:00Z', message: 'Refused.' } }))).toMatchObject({
                willLoad: false,
                lastStart: { code: 'signed-out', at: '2026-11-08T07:00:00Z', message: 'Refused.' }
            });
            expect(parseStatus(JSON.stringify({ installed: true, lastStart: { code: 3, at: null } }))).toMatchObject({ lastStart: { code: null, at: null, message: null } });
            expect(parseStatus(JSON.stringify({ installed: true, willLoad: 'no', lastStart: 'x' }))).toMatchObject({ willLoad: null, lastStart: null });
        });

        test('without access but installed, the card offers only Remove and keeps the RuneLite screen', async () => {
            installAgentJar();
            fs.writeFileSync(settingsFile, JSON.stringify({ launcherMode: 'runelite' }));
            access = httpError(403);

            expect(await setup().ipcMain.invoke('runelite-loader:state')).toEqual({ visible: true, state: 'remove-only', mode: 'runelite' });
            expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).launcherMode).toBe('runelite');
        });

        test('remove-only opens the RuneLite screen even when the client screen was chosen, without saving it', async () => {
            installAgentJar();
            fs.writeFileSync(settingsFile, JSON.stringify({ launcherMode: 'client' }));
            access = httpError(403);

            expect(await setup().loader.state()).toMatchObject({ state: 'remove-only', mode: 'runelite' });
            expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).launcherMode).toBe('client');
        });

        test('signed out it is hidden', async () => {
            installAgentJar(path.join(path.dirname(agentJar), 'agent-0a1b2c3d.jar'));
            email = null;

            expect(await setup().loader.state()).toEqual({ visible: false });
        });

        test('also when offline', async () => {
            installAgentJar(path.join(path.dirname(agentJar), 'agent-0a1b2c3d.jar'));
            access = new Error('socket hang up');
            expect(await setup().loader.state()).toMatchObject({ visible: true, state: 'remove-only' });
        });

        test('someone without access who never installed it sees nothing and starts no Java', async () => {
            access = { available: false, reason: 'not-in-audience' };

            expect(await setup().loader.state()).toEqual({ visible: false });
            expect(spawn).not.toHaveBeenCalled();
        });

        test('without the API, Remove runs the jar the RuneLite line names', async () => {
            const named = path.join(path.dirname(agentJar), 'agent-0a1b2c3d.jar');
            installAgentJar();
            installAgentJar(named);
            const runeliteSettings = path.join(dir, 'runelite-settings.json');
            fs.writeFileSync(runeliteSettings, JSON.stringify({ launchMode: 'JVM', jvmArguments: ['-Xmx1g', `-javaagent:${named}=quiet`, '-javaagent:/opt/other/agent.jar'] }));
            statusWith({ settingsPath: runeliteSettings });
            access = httpError(403);
            const { loader } = setup();

            const result = await loader.remove();

            expect(result).toEqual({ visible: false, message: 'Microbot was removed from RuneLite.' });
            expect(runsOf('--remove')).toHaveLength(1);
            expect(runsOf('--status')[0].args[1]).toBe(agentJar);
            expect(runsOf('--remove')[0].args).toEqual(['-jar', named, '--remove']);
            expect(auth.request.mock.calls.filter(([config]) => config.path === '/api/loader/agent')).toHaveLength(0);
            expect(alerts.forgetLoaderToken).toHaveBeenCalled();
        });

        test('without the API and no readable line, Remove falls back to agent.jar', async () => {
            installAgentJar();
            installAgentJar(path.join(downloadsDir, 'agent-0.9.0.jar'));
            fs.utimesSync(agentJar, new Date(2020, 1, 1), new Date(2020, 1, 1));
            statusWith({ settingsPath: path.join(dir, 'missing-settings.json') });
            access = new Error('socket hang up');

            await setup().loader.remove();

            expect(runsOf('--remove')[0].args).toEqual(['-jar', agentJar, '--remove']);
        });

        test('the downloaded jar is checked again right before Java runs it', async () => {
            const managedJava = path.join(dir, 'jdk', 'bin', 'java');
            const realSpawn = spawn.getMockImplementation();
            spawn.mockImplementation((command, args, options) => {
                if (args === PROBE_ARGS && command === 'java') {
                    const child = realSpawn(command, ['none'], options);
                    setImmediate(() => child.emit('error', Object.assign(new Error('spawn java ENOENT'), { code: 'ENOENT' })));
                    return child;
                }
                return realSpawn(command, args, options);
            });
            managedJdk.install.mockImplementation(async () => {
                fs.writeFileSync(path.join(downloadsDir, 'agent-1.0.0.jar'), Buffer.from(JAR).fill(0x41, 10, 12));
                fs.mkdirSync(path.dirname(managedJava), { recursive: true });
                fs.writeFileSync(managedJava, '');
                return managedJava;
            });
            cli.status.stdout = JSON.stringify({ installed: false });
            const { loader } = setup();

            const result = await loader.install();

            expect(result.error).toBe(MESSAGES.damaged);
            expect(runsOf('--install')).toHaveLength(0);
            expect(fs.existsSync(path.join(downloadsDir, 'agent-1.0.0.jar'))).toBe(false);
        });

        test('a body larger than the release says the download was damaged', async () => {
            served = Object.assign(new Error(`maxContentLength size of ${JAR.length + 1} exceeded`), { code: 'ERR_BAD_RESPONSE' });
            const { loader } = setup();

            expect((await loader.install()).error).toBe('The Microbot download was damaged. Try again in a minute.');
        });

        test('unreadable launcher settings are never overwritten by the view choice', async () => {
            fs.writeFileSync(settingsFile, '{ "runInBackground": tru');
            const { ipcMain } = setup();

            expect(await ipcMain.invoke('runelite-loader:set-mode', 'runelite')).toEqual({ error: 'Could not save the setting.', mode: 'runelite' });
            expect(fs.readFileSync(settingsFile, 'utf8')).toBe('{ "runInBackground": tru');

            access = { available: false, reason: 'not-in-audience' };
            await ipcMain.invoke('runelite-loader:state');
            expect(fs.readFileSync(settingsFile, 'utf8')).toBe('{ "runInBackground": tru');
        });
    });

    describe('Open RuneLite', () => {
        const appImage = '/home/zezima/Downloads/RuneLite.AppImage';
        const launchable = () => {
            const children = [];
            const launchSpawn = jest.fn((command, args, options) => {
                if (options?.detached) {
                    const child = new EventEmitter();
                    child.unref = jest.fn();
                    children.push(child);
                    setImmediate(() => child.emit('spawn'));
                    return child;
                }
                return spawn(command, args, options);
            });
            return { launchSpawn, children };
        };

        test('Added shows Open RuneLite when RuneLite is found, Find RuneLite… when not', async () => {
            fs.mkdirSync(path.dirname(agentJar), { recursive: true });
            fs.writeFileSync(agentJar, JAR);
            const spec = { command: '/snap/bin/runelite', args: [], source: 'snap', label: '/snap/bin/runelite' };

            expect(await setup({ finder: { find: () => spec, fromPath: () => null } }).loader.state()).toMatchObject({ state: 'added', opener: 'open' });
            expect(await setup().loader.state()).toMatchObject({ state: 'added', opener: 'find' });
        });

        test('starts the found RuneLite detached with a clean environment', async () => {
            const { launchSpawn } = launchable();
            const spec = { command: '/snap/bin/runelite', args: [], source: 'snap', label: '/snap/bin/runelite' };
            const { ipcMain } = setup({
                spawn: launchSpawn,
                finder: { find: () => spec, fromPath: () => null },
                env: { PATH: '/usr/bin', HOME: dir, DISPLAY: ':0', MICROBOT_CLIENT_TOKEN: TOKEN, JX_SESSION_ID: 'jagex-secret', HTTPS_PROXY: 'http://u:p@proxy:1' }
            });

            expect(await ipcMain.invoke('runelite-loader:open')).toEqual({ ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.' });

            const [command, args, options] = launchSpawn.mock.calls[0];
            expect(command).toBe('/snap/bin/runelite');
            expect(args).toEqual([]);
            expect(options).toMatchObject({ detached: true, stdio: 'ignore' });
            expect(options.env).toEqual({ PATH: '/usr/bin', HOME: dir, DISPLAY: ':0' });
            expect(JSON.stringify(launchSpawn.mock.calls)).not.toContain(TOKEN);
            expect(alerts.tokenForLoader).not.toHaveBeenCalled();
        });

        test('double clicks start RuneLite once', async () => {
            const { launchSpawn } = launchable();
            const spec = { command: '/snap/bin/runelite', args: [], source: 'snap', label: '/snap/bin/runelite' };
            const { loader } = setup({ spawn: launchSpawn, finder: { find: () => spec, fromPath: () => null } });

            await Promise.all([loader.openRuneLite(), loader.openRuneLite()]);

            expect(launchSpawn).toHaveBeenCalledTimes(1);
        });

        test('not found asks the member to find it', async () => {
            const { loader } = setup();

            expect(await loader.openRuneLite()).toEqual({ ok: false, opener: 'find', error: "RuneLite wasn't found on this PC. Press Find RuneLite… to choose it." });
        });

        test('a failed start gives one plain sentence', async () => {
            const failing = jest.fn(() => {
                const child = new EventEmitter();
                child.unref = jest.fn();
                setImmediate(() => child.emit('error', new Error('spawn EACCES')));
                return child;
            });
            const spec = { command: appImage, args: [], source: 'appimage', label: appImage };
            const { loader } = setup({ spawn: failing, finder: { find: () => spec, fromPath: () => null } });

            expect(await loader.openRuneLite()).toEqual({ ok: false, error: 'RuneLite could not be started. Try opening it the usual way.' });
        });

        test('Find RuneLite… remembers the chosen file and starts it', async () => {
            const chosen = path.join(dir, 'RuneLite.AppImage');
            fs.writeFileSync(chosen, '');
            fs.writeFileSync(settingsFile, JSON.stringify({ launcherMode: 'runelite' }));
            const { launchSpawn } = launchable();
            const dialog = { showOpenDialog: jest.fn(async () => ({ canceled: false, filePaths: [chosen] })) };
            const { ipcMain } = setup({ spawn: launchSpawn, dialog, finder: undefined, platform: 'linux' });

            expect(await ipcMain.invoke('runelite-loader:find')).toEqual({ ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.', opener: 'open', starts: ['~', 'RuneLite.AppImage'].join(path.sep) });

            expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))).toEqual({ launcherMode: 'runelite', runelitePath: chosen });
            expect(launchSpawn.mock.calls[0][0]).toBe(chosen);
            expect(dialog.showOpenDialog.mock.calls[0][1]).toMatchObject({ properties: ['openFile'] });
        });

        test('a cancelled picker does nothing', async () => {
            const dialog = { showOpenDialog: jest.fn(async () => ({ canceled: true, filePaths: [] })) };
            const { loader } = setup({ dialog });

            expect(await loader.findAndOpen()).toEqual({ cancelled: true });
            expect(fs.existsSync(settingsFile)).toBe(false);
        });

        test('a folder is refused and not remembered', async () => {
            const dialog = { showOpenDialog: jest.fn(async () => ({ canceled: false, filePaths: [dir] })) };
            const { loader } = setup({ dialog, finder: undefined, platform: 'linux' });

            expect(await loader.findAndOpen()).toEqual({ ok: false, opener: 'find', error: "That file can't be started. Choose RuneLite itself." });
            expect(fs.existsSync(settingsFile)).toBe(false);
        });

        test('unreadable launcher settings are not overwritten by the chosen path', async () => {
            const chosen = path.join(dir, 'RuneLite.AppImage');
            fs.writeFileSync(chosen, '');
            fs.writeFileSync(settingsFile, '{ broken');
            const { launchSpawn } = launchable();
            const dialog = { showOpenDialog: jest.fn(async () => ({ canceled: false, filePaths: [chosen] })) };
            const { loader } = setup({ spawn: launchSpawn, dialog, finder: undefined, platform: 'linux' });

            expect((await loader.findAndOpen()).ok).toBe(true);
            expect(fs.readFileSync(settingsFile, 'utf8')).toBe('{ broken');
        });

        test('the remembered path is used next time', async () => {
            const chosen = path.join(dir, 'RuneLite.AppImage');
            fs.writeFileSync(chosen, '');
            fs.writeFileSync(settingsFile, JSON.stringify({ runelitePath: chosen }));
            fs.mkdirSync(path.dirname(agentJar), { recursive: true });
            fs.writeFileSync(agentJar, JAR);
            const emptyHome = path.join(dir, 'home');
            const options = { finder: undefined, platform: 'linux', home: emptyHome, env: { PATH: '' } };

            expect(await setup(options).loader.state()).toMatchObject({ state: 'added', opener: 'open' });
        });
    });

    describe('switched off, and which RuneLite starts', () => {
        const installed = (fields) => {
            fs.mkdirSync(path.dirname(agentJar), { recursive: true });
            fs.writeFileSync(agentJar, JAR);
            cli.status.stdout = JSON.stringify({ installed: true, signedIn: true, willLoad: true, agentVersion: '1.0.0', agentSha256: JAR_SHA, ...fields });
        };
        const appImageSpec = (home) => ({ command: path.join(home, 'Downloads', 'RuneLite.AppImage'), args: [], source: 'appimage', label: path.join(home, 'Downloads', 'RuneLite.AppImage') });
        const startsLabel = ['~', 'Downloads', 'RuneLite.AppImage'].join(path.sep);

        test('enabled false shows the switched-off state, with Open RuneLite still there', async () => {
            installed({ enabled: false, lastStart: { code: 'switched-off', at: '2026-11-08T07:00:00Z', message: null } });
            const { loader } = setup({ finder: { find: () => appImageSpec(dir), fromPath: () => null } });

            expect(await loader.state()).toEqual({ visible: true, state: 'switched-off', opener: 'open', starts: startsLabel, version: '1.0.0', mode: 'client' });
        });

        test('a missing enabled reads as on', async () => {
            installed({});

            expect(await setup().loader.state()).toMatchObject({ state: 'added' });
            expect(parseStatus('{"installed":true}').enabled).toBe(true);
            expect(parseStatus('{"installed":true,"enabled":"no"}').enabled).toBe(true);
            expect(parseStatus('{"installed":true,"enabled":false}').enabled).toBe(false);
        });

        test('a newer release still comes first', async () => {
            installed({ enabled: false });
            access.agent.sha256 = OTHER_SHA;

            expect(await setup().loader.state()).toMatchObject({ state: 'update', reason: 'new-version' });
        });

        test('Turn Microbot on runs the same install', async () => {
            installed({ enabled: false });
            const { loader } = setup();
            expect((await loader.state()).state).toBe('switched-off');
            cli.status.stdout = JSON.stringify({ installed: true, signedIn: true, enabled: true, agentSha256: JAR_SHA });

            const result = await loader.install();

            expect(runsOf('--install')).toHaveLength(1);
            expect(runsOf('--install')[0].args).toEqual(['-jar', path.join(downloadsDir, 'agent-1.0.0.jar'), '--install', '--token-stdin']);
            expect(result.state).toBe('added');
        });

        test('Added says which RuneLite it starts, with the home folder as ~', async () => {
            installed({});
            const { loader } = setup({ finder: { find: () => appImageSpec(dir), fromPath: () => null } });

            expect(await loader.state()).toMatchObject({ state: 'added', opener: 'open', starts: startsLabel });
        });

        test('a start error logs only the OS error code, no path', async () => {
            const secretHome = path.join(dir, 'token-mbc_SECRET');
            const failing = jest.fn(() => {
                const child = new EventEmitter();
                child.unref = jest.fn();
                setImmediate(() => child.emit('error', Object.assign(new Error(`spawn ${secretHome}/Downloads/RuneLite.AppImage EACCES`), { code: 'EACCES' })));
                return child;
            });
            const { loader } = setup({ spawn: failing, home: secretHome, finder: { find: () => appImageSpec(secretHome), fromPath: () => null } });

            expect((await loader.openRuneLite()).error).toBe('RuneLite could not be started. Try opening it the usual way.');
            expect(log.warn).toHaveBeenCalledWith('Could not start RuneLite (appimage): error code EACCES.');
            expect(logged()).not.toContain(secretHome);
            expect(logged()).not.toContain('Downloads');
        });

        test('an error without a code logs unknown', async () => {
            const failing = jest.fn(() => {
                throw new Error('weird /home/someone/path');
            });
            const { loader } = setup({ spawn: failing, finder: { find: () => appImageSpec(dir), fromPath: () => null } });

            await loader.openRuneLite();

            expect(log.warn).toHaveBeenCalledWith('Could not start RuneLite (appimage): error code unknown.');
        });

        test('RuneLite closing right after it started is logged with its exit code', async () => {
            let child;
            const launching = jest.fn(() => {
                child = new EventEmitter();
                child.unref = jest.fn();
                setImmediate(() => child.emit('spawn'));
                return child;
            });
            const { loader } = setup({ spawn: launching, finder: { find: () => appImageSpec(dir), fromPath: () => null } });

            expect((await loader.openRuneLite()).ok).toBe(true);
            child.emit('exit', 127, null);

            expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/^RuneLite \(appimage\) closed \d+\.\d s after starting, exit code 127\.$/));
            expect(logged()).not.toContain('Downloads');
        });
    });
});
