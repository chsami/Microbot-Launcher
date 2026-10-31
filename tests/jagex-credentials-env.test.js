const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeCredentialProperties, credentialEnv } = require('../libs/overwrite-credential-properties');

const VERSION = '9.9.9';
const PROBE_OUTPUT = 'openjdk version "17.0.12"\n    java.version = 17.0.12\n    sun.arch.data.model = 64\n';
const ZEZIMA = { accountId: '1001', sessionId: 'session-zezima', displayName: 'Zezima', profile: 'Main' };
const LYNX = { accountId: '1002', sessionId: 'session-lynx', displayName: 'Lynx', profile: 'Alt' };
const JX_KEYS = ['JX_CHARACTER_ID', 'JX_SESSION_ID', 'JX_REFRESH_TOKEN', 'JX_DISPLAY_NAME', 'JX_ACCESS_TOKEN'];

const fakeProcess = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.destroy = jest.fn();
    child.unref = jest.fn();
    child.kill = jest.fn();
    return child;
};

const waitFor = async (predicate) => {
    for (let i = 0; i < 200 && !predicate(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
};

const characterOf = (env) => ({
    JX_CHARACTER_ID: env.JX_CHARACTER_ID,
    JX_SESSION_ID: env.JX_SESSION_ID,
    JX_DISPLAY_NAME: env.JX_DISPLAY_NAME
});

describe('Jagex character in the client environment', () => {
    let harness;
    let originalDebug;
    const inheritedKeys = [];

    const inherit = (values) => {
        Object.entries(values).forEach(([key, value]) => {
            inheritedKeys.push(key);
            process.env[key] = value;
        });
    };

    const createHarness = async () => {
        const handlers = {};
        const launches = [];
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jagex-env-home-'));
        const microbotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jagex-env-'));
        const spawn = jest.fn((command, args, options) => {
            const child = fakeProcess();
            if (args.includes('-version')) {
                setImmediate(() => {
                    child.stdout.emit('data', PROBE_OUTPUT);
                    child.emit('close', 0);
                });
            } else {
                launches.push({ command, args, options });
            }
            return child;
        });
        const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const deps = {
            spawn,
            path,
            fs,
            log,
            microbotDir,
            startupWindowMs: 5,
            packageJson: { version: '3.2.27-test' },
            ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
            shell: { openExternal: jest.fn() },
            dialog: { showMessageBox: jest.fn(() => Promise.resolve({ response: 0 })) },
            writeCredentials: (account) => writeCredentialProperties({ fs, path, homeDir }, account)
        };
        const executor = await require('../libs/jar-executor')(deps);
        const credentialsFile = path.join(homeDir, '.runelite', 'credentials.properties');
        return { handlers, launches, log, executor, credentialsFile, dirs: [homeDir, microbotDir] };
    };

    const openClient = async (account) => {
        const count = harness.launches.length;
        await harness.handlers['open-client']({}, VERSION, null, account, '');
        await waitFor(() => harness.launches.length > count);
        return harness.launches[count].options.env;
    };

    beforeEach(async () => {
        originalDebug = process.env.DEBUG;
        delete process.env.DEBUG;
        harness = await createHarness();
    });

    afterEach(() => {
        if (originalDebug === undefined) delete process.env.DEBUG;
        else process.env.DEBUG = originalDebug;
        inheritedKeys.splice(0).forEach((key) => delete process.env[key]);
        harness.dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
    });

    test('two Jagex accounts each start with their own character, while the file holds the last one', async () => {
        const first = await openClient(ZEZIMA);
        const second = await openClient(LYNX);

        expect(characterOf(first)).toEqual({ JX_CHARACTER_ID: '1001', JX_SESSION_ID: 'session-zezima', JX_DISPLAY_NAME: 'Zezima' });
        expect(characterOf(second)).toEqual({ JX_CHARACTER_ID: '1002', JX_SESSION_ID: 'session-lynx', JX_DISPLAY_NAME: 'Lynx' });
        expect(first.JX_ACCESS_TOKEN).toBe('');
        expect(first.JX_REFRESH_TOKEN).toBe('');
        expect(first.PATH).toBe(process.env.PATH);

        const file = fs.readFileSync(harness.credentialsFile, 'utf8');
        expect(file).toContain('JX_CHARACTER_ID=1002\n');
        expect(file).toContain('JX_SESSION_ID=session-lynx\n');
        expect(file).toContain('JX_DISPLAY_NAME=Lynx\n');
    });

    test('the client environment carries exactly the keys written to credentials.properties', async () => {
        const env = await openClient(ZEZIMA);
        const fileEntries = fs
            .readFileSync(harness.credentialsFile, 'utf8')
            .split('\n')
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => line.split('='));

        expect(Object.fromEntries(fileEntries)).toEqual(credentialEnv(ZEZIMA));
        expect(Object.keys(credentialEnv(ZEZIMA)).sort()).toEqual([...JX_KEYS].sort());
        expect(Object.fromEntries(JX_KEYS.map((key) => [key, env[key]]))).toEqual(credentialEnv(ZEZIMA));
    });

    test('a launcher started with a Jagex character in its own environment still gives each client its own', async () => {
        inherit({ JX_CHARACTER_ID: '9999', JX_SESSION_ID: 'session-parent', JX_DISPLAY_NAME: 'Parent', JX_ACCESS_TOKEN: 'parent-access' });

        const env = await openClient(LYNX);

        expect(characterOf(env)).toEqual({ JX_CHARACTER_ID: '1002', JX_SESSION_ID: 'session-lynx', JX_DISPLAY_NAME: 'Lynx' });
        expect(env.JX_ACCESS_TOKEN).toBe('');
    });

    test('the dashboard start passes the chosen account the same way', async () => {
        const started = harness.executor.launch({ version: VERSION, account: ZEZIMA, ramPreference: '' });
        await waitFor(() => harness.launches.length > 0);

        expect(characterOf(harness.launches[0].options.env)).toEqual({
            JX_CHARACTER_ID: '1001',
            JX_SESSION_ID: 'session-zezima',
            JX_DISPLAY_NAME: 'Zezima'
        });
        await started;
    });

    test('a non-Jagex start never inherits a Jagex character from the launcher', async () => {
        inherit({ JX_CHARACTER_ID: '9999', JX_SESSION_ID: 'session-parent', JX_DISPLAY_NAME: 'Parent', JX_REFRESH_TOKEN: 'r', jx_access_token: 'a' });

        await harness.handlers['play-no-jagex-account']({}, VERSION, null, '');
        await waitFor(() => harness.launches.length > 0);
        const dashboard = harness.executor.launch({ version: VERSION, noJagexProfile: 'Ironman', ramPreference: '' });
        await waitFor(() => harness.launches.length > 1);
        await dashboard;

        for (const { options } of harness.launches) {
            expect(Object.keys(options.env).filter((key) => key.toUpperCase().startsWith('JX_'))).toEqual([]);
            expect(options.env.PATH).toBe(process.env.PATH);
        }
        expect(fs.existsSync(harness.credentialsFile)).toBe(false);
    });

    test('an account without a game session does not pass an inherited character', async () => {
        inherit({ JX_CHARACTER_ID: '9999', JX_SESSION_ID: 'session-parent', JX_DISPLAY_NAME: 'Parent' });

        const env = await openClient({ accountId: '1003', displayName: 'NoSession', profile: 'Main' });

        expect(Object.keys(env).filter((key) => key.startsWith('JX_'))).toEqual([]);
    });

    test('the session id never reaches the launcher log', async () => {
        await openClient(ZEZIMA);
        await harness.executor.launch({ version: VERSION, account: LYNX, ramPreference: '' });

        const logged = JSON.stringify([harness.log.info.mock.calls, harness.log.warn.mock.calls, harness.log.error.mock.calls]);
        expect(logged).not.toContain('session-zezima');
        expect(logged).not.toContain('session-lynx');
    });
});
