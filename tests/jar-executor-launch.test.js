const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const JDKS = {
    8: process.env.M07_JAVA8_HOME,
    11: process.env.M07_JAVA11_HOME || path.join(os.userInfo().homedir, '.jdks', 'temurin-11.0.28'),
    17: process.env.M07_JAVA17_HOME || '/usr/lib/jvm/java-17-openjdk-amd64'
};
const hasJdk = (major) => Boolean(JDKS[major]) && fs.existsSync(path.join(JDKS[major], 'bin', 'java'));
const withJdk = (major) => (hasJdk(major) ? test : test.skip);
const VERSION = '9.9.9';
const HOMES = [...new Set([os.homedir(), os.userInfo().homedir])];

let workDir;
let microbotDir;
let originalPath;
let originalMode;

function buildTestJar() {
    const javac = path.join(JDKS[17], 'bin', 'javac');
    const jar = path.join(JDKS[17], 'bin', 'jar');
    const classes = path.join(workDir, 'classes');
    fs.mkdirSync(classes, { recursive: true });
    childProcess.execFileSync(javac, [
        '--release', '8', '-d', classes,
        path.join(__dirname, '__fixtures__', 'launch-jar', 'Main.java')
    ]);
    childProcess.execFileSync(jar, [
        '--create', '--file', path.join(microbotDir, `microbot-${VERSION}.jar`),
        '--main-class', 'Main', '-C', classes, '.'
    ]);
}

function createHarness({ clipboard = true, response = 0, startupWindowMs = 2500, installManagedJdk } = {}) {
    const handlers = {};
    const spawnCalls = [];
    const dialogs = [];
    let resolveDialog;
    const dialogShown = new Promise((resolve) => {
        resolveDialog = resolve;
    });
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const deps = {
        spawn: (command, args, options) => {
            spawnCalls.push({ command, args, options });
            return childProcess.spawn(command, args, { ...options, env: { ...process.env } });
        },
        path,
        fs,
        log,
        microbotDir,
        startupWindowMs,
        packageJson: { version: '3.2.8-test' },
        installManagedJdk,
        ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
        shell: { openExternal: jest.fn() },
        clipboard: clipboard ? { writeText: jest.fn() } : undefined,
        dialog: {
            showMessageBox: jest.fn((options) => {
                dialogs.push(options);
                resolveDialog(options);
                return Promise.resolve({ response });
            }),
            showErrorBox: jest.fn()
        }
    };
    return { deps, handlers, spawnCalls, dialogs, dialogShown, log };
}

async function launch(harness, { ram = '', proxy = null, profile, displayName } = {}) {
    await require('../libs/jar-executor')(harness.deps);
    const account = profile || displayName ? { profile, displayName } : null;
    return harness.handlers['open-client']({}, VERSION, proxy, account, ram);
}

function useJava(major) {
    process.env.PATH = `${path.join(JDKS[major], 'bin')}${path.delimiter}/usr/bin${path.delimiter}/bin`;
}

const within = (promise, ms) =>
    Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const waitFor = async (predicate) => {
    for (let i = 0; i < 200 && !predicate(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
};

beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm07-launch-'));
    microbotDir = path.join(workDir, '.microbot');
    fs.mkdirSync(microbotDir);
    if (hasJdk(17)) buildTestJar();
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
    originalPath = process.env.PATH;
    originalMode = process.env.M07_MODE;
    delete process.env.DEBUG;
    jest.resetModules();
});

afterEach(() => {
    process.env.PATH = originalPath;
    if (originalMode === undefined) delete process.env.M07_MODE;
    else process.env.M07_MODE = originalMode;
});

describe('open-client launch diagnostics with real Java runtimes', () => {
    test('missing Java offers an install and keeps the Temurin download page as the fallback', async () => {
        const empty = path.join(workDir, 'empty-bin');
        fs.mkdirSync(empty, { recursive: true });
        process.env.PATH = empty;
        const harness = createHarness({ response: 1 });
        expect(await launch(harness)).toEqual({ success: true });
        const shown = await within(harness.dialogShown, 5000);
        expect(shown).toMatchObject({ title: 'Install Java 17', buttons: ['Install Java 17', 'Open download page', 'Cancel'] });
        await flush();
        expect(harness.deps.shell.openExternal).toHaveBeenCalledWith(
            require('../libs/java-runtime').javaDownloadUrl(process.platform, process.arch)
        );
        expect(harness.spawnCalls).toHaveLength(1);
    });

    withJdk(8)('Java 8 is replaced by an install offer when no managed copy exists', async () => {
        useJava(8);
        const harness = createHarness({ response: 1 });
        await launch(harness);
        const shown = await within(harness.dialogShown, 10000);
        expect(shown.title).toBe('Install Java 17');
        await flush();
        expect(harness.deps.shell.openExternal).toHaveBeenCalledWith(expect.stringContaining('adoptium.net'));
        expect(harness.spawnCalls).toHaveLength(1);
    });

    withJdk(11)('Java 11 launches without ZGC flags from the probed runtime home', async () => {
        useJava(11);
        process.env.M07_MODE = 'sleep';
        const harness = createHarness();
        await launch(harness);
        const shown = await within(harness.dialogShown, 5000);
        expect(shown).toBeNull();
        const [, launchCall] = harness.spawnCalls;
        expect(launchCall.command).toBe(path.join(fs.realpathSync(JDKS[11]), 'bin', 'java'));
        expect(launchCall.args).not.toContain('-XX:+UseZGC');
        expect(launchCall.args).toContain('-Xmx600m');
        expect(launchCall.options.stdio).toEqual(['ignore', 'ignore', 'pipe']);
        expect(harness.log.info).toHaveBeenCalledWith(expect.stringMatching(/^Java 11\.0\.28 .* cannot use ZGC; launching without ZGC flags\.$/));
    }, 15000);

    withJdk(11)('Java 11 VM startup failure is reported with stderr and a specific fix', async () => {
        useJava(11);
        fs.renameSync(path.join(microbotDir, `microbot-${VERSION}.jar`), path.join(workDir, 'hidden.jar'));
        try {
            const harness = createHarness({ response: 1 });
            await launch(harness);
            const shown = await within(harness.dialogShown, 10000);
            expect(shown.title).toBe('Java Could Not Start The Client');
            expect(shown.detail).toContain('(vm-failure)');
            expect(shown.detail).toContain('Error: Unable to access jarfile');
            expect(shown.detail).toContain('Delete it from the .microbot folder');
            for (const home of HOMES) expect(shown.detail).not.toContain(home);
        } finally {
            fs.renameSync(path.join(workDir, 'hidden.jar'), path.join(microbotDir, `microbot-${VERSION}.jar`));
        }
    }, 15000);

    withJdk(17)('Java 17 keeps ZGC flags and succeeds without a dialog', async () => {
        useJava(17);
        process.env.M07_MODE = 'sleep';
        const harness = createHarness();
        await launch(harness);
        expect(await within(harness.dialogShown, 5000)).toBeNull();
        expect(harness.spawnCalls[1].args).toContain('-XX:+UseZGC');
    }, 15000);

    withJdk(17)('256 MB RAM setting starts on Java 17 with a soft heap target below the maximum', async () => {
        useJava(17);
        process.env.M07_MODE = 'sleep';
        const harness = createHarness();
        await launch(harness, { ram: '256m' });
        expect(await within(harness.dialogShown, 5000)).toBeNull();
        const args = harness.spawnCalls[1].args;
        expect(args).toEqual(expect.arrayContaining(['-Xms256m', '-Xmx256m', '-XX:+UseZGC', '-XX:SoftMaxHeapSize=204m']));
        expect(args).not.toContain('-XX:SoftMaxHeapSize=500m');
    }, 15000);

    withJdk(17)('2 GB RAM setting keeps the maximum but no longer reserves it up front', async () => {
        useJava(17);
        process.env.M07_MODE = 'sleep';
        const harness = createHarness();
        await launch(harness, { ram: '2g' });
        expect(await within(harness.dialogShown, 5000)).toBeNull();
        const args = harness.spawnCalls[1].args;
        expect(args).toEqual(expect.arrayContaining(['-Xms256m', '-Xmx2g', '-XX:SoftMaxHeapSize=1638m']));
        expect(args).not.toContain('-Xms2g');
    }, 15000);

    withJdk(17)('rejected heap setting is explained as a VM memory failure', async () => {
        useJava(17);
        const harness = createHarness({ response: 1 });
        await launch(harness, { ram: '0.5m' });
        const shown = await within(harness.dialogShown, 15000);
        expect(shown.title).toBe('Java Could Not Start The Client');
        expect(shown.detail).toContain('Lower the client RAM setting');
        expect(shown.detail).toContain('Invalid initial heap size: -Xms0.5m');
        expect(shown.buttons).toEqual(['Copy details', 'Cancel']);
    }, 20000);

    withJdk(17)('client crash during startup is distinguished from VM failure', async () => {
        useJava(17);
        process.env.M07_MODE = 'crash';
        const harness = createHarness({ response: 1 });
        await launch(harness);
        const shown = await within(harness.dialogShown, 10000);
        expect(shown.title).toBe('Client Closed During Startup');
        expect(shown.detail).toContain('(client-startup)');
        expect(shown.detail).toContain('plugin manager failed');
    }, 15000);

    withJdk(17)('stderr in dialogs is redacted and bounded', async () => {
        useJava(17);
        process.env.M07_MODE = 'secrets';
        const harness = createHarness({ response: 1 });
        await launch(harness, {
            proxy: { proxyIp: '10.0.0.5:1080:bob:hunter2' },
            profile: 'MainAccount',
            displayName: 'Zezima the Great'
        });
        const shown = await within(harness.dialogShown, 10000);
        expect(shown.detail).toContain('logged in as ***');
        for (const secret of ['hunter2', 'abc123', 'MainAccount', 'bob@example.com', 'Zezima', ...HOMES]) {
            expect(shown.detail).not.toContain(secret);
        }
        expect(shown.detail).toContain('-proxy=***');
        expect(shown.detail).toContain('~/.microbot');

        jest.resetModules();
        process.env.M07_MODE = 'spam';
        const spam = createHarness({ response: 1 });
        await launch(spam);
        const spamShown = await within(spam.dialogShown, 10000);
        const output = spamShown.detail.split('Java output:\n')[1];
        expect(output.split('\n')).toHaveLength(21);
        expect(output).toContain('noise line 499');
        expect(output).not.toContain('noise line 100\n');
    }, 25000);

    function fakeRuntimeHarness(probeOutput) {
        const { EventEmitter } = require('events');
        const harness = createHarness({ response: 1 });
        harness.deps.spawn = (command, args) => {
            harness.spawnCalls.push({ command, args });
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stderr.destroy = jest.fn();
            proc.unref = jest.fn();
            proc.kill = jest.fn();
            setImmediate(() => {
                if (args[0] === '-XshowSettings:properties') {
                    proc.stderr.emit('data', Buffer.from(probeOutput));
                    proc.emit('close', 0);
                }
            });
            return proc;
        };
        return harness;
    }

    test('an unparseable Java version warns and still launches', async () => {
        const harness = fakeRuntimeHarness('    java.vendor = Mystery\n    sun.arch.data.model = 64\nmystery version "banana"\n');
        await launch(harness, { ram: '1g' });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(harness.deps.dialog.showMessageBox).not.toHaveBeenCalled();
        expect(harness.spawnCalls).toHaveLength(2);
        expect(harness.spawnCalls[1].args).not.toContain('-XX:+UseZGC');
        expect(harness.log.warn).toHaveBeenCalledWith('The Java version could not be determined; launching anyway.');
    });

    test('32-bit Java 17 launches without ZGC flags', async () => {
        const harness = fakeRuntimeHarness(
            fs.readFileSync(path.join(__dirname, '__fixtures__', 'java-probe', 'synthetic-windows-temurin-17-x86.txt'), 'utf8')
        );
        await launch(harness, { ram: '512m' });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(harness.deps.dialog.showMessageBox).not.toHaveBeenCalled();
        const args = harness.spawnCalls[1].args;
        expect(args).toEqual(expect.arrayContaining(['-Xms256m', '-Xmx512m']));
        expect(args.some((arg) => /ZGC|SoftMaxHeapSize|ZUncommit/.test(arg))).toBe(false);
    });

    test('multibyte characters split across stderr chunks are still redacted', async () => {
        const { EventEmitter } = require('events');
        const { PassThrough } = require('stream');
        const probe = '    java.version = 17.0.1\n    sun.arch.data.model = 64\nopenjdk version "17.0.1"\n';
        const harness = createHarness({ response: 1 });
        harness.deps.spawn = (command, args) => {
            harness.spawnCalls.push({ command, args });
            const proc = new EventEmitter();
            proc.stdout = new PassThrough();
            proc.stderr = new PassThrough();
            proc.unref = jest.fn();
            proc.kill = jest.fn();
            setImmediate(() => {
                if (args[0] === '-XshowSettings:properties') {
                    proc.stderr.end(probe);
                    setImmediate(() => proc.emit('close', 0));
                    return;
                }
                const line = Buffer.from('logged in as Zézima\n', 'utf8');
                const split = line.indexOf(0xc3) + 1;
                proc.stderr.write(line.subarray(0, split));
                setImmediate(() => {
                    proc.stderr.end(line.subarray(split));
                    setImmediate(() => proc.emit('close', 1, null));
                });
            });
            return proc;
        };
        await launch(harness, { displayName: 'Zézima' });
        const shown = await within(harness.dialogShown, 5000);
        expect(shown.detail).toContain('logged in as ***');
        expect(shown.detail).not.toContain('ima');
        expect(shown.detail).not.toContain('\ufffd');
    });

    withJdk(17)('launch log hides a profile name that contains spaces', async () => {
        useJava(17);
        process.env.M07_MODE = 'sleep';
        const harness = createHarness();
        await launch(harness, { profile: 'secret name' });
        const launchLine = () => harness.log.info.mock.calls.map((call) => String(call[0])).find((line) => line.includes('-jar'));
        for (let i = 0; i < 200 && !launchLine(); i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(launchLine()).toContain('-profile=***');
        expect(launchLine()).not.toContain('secret');
        expect(launchLine()).not.toContain('name');
    }, 15000);

    withJdk(17)('accepting the install offer launches the freshly installed Java', async () => {
        const empty = path.join(workDir, 'empty-bin');
        fs.mkdirSync(empty, { recursive: true });
        process.env.PATH = empty;
        process.env.M07_MODE = 'sleep';
        const installed = path.join(fs.realpathSync(JDKS[17]), 'bin', 'java');
        const harness = createHarness({ response: 0, installManagedJdk: jest.fn(async () => installed) });
        await launch(harness);
        await waitFor(() => harness.spawnCalls.length >= 3);
        expect(harness.deps.installManagedJdk).toHaveBeenCalledWith(
            expect.objectContaining({ platform: process.platform, microbotDir })
        );
        expect(harness.spawnCalls[1].command).toBe(installed);
        expect(harness.spawnCalls[2].command).toBe(installed);
    }, 15000);

    withJdk(17)('an installed managed copy is used when Java is not on PATH', async () => {
        const empty = path.join(workDir, 'empty-bin');
        fs.mkdirSync(empty, { recursive: true });
        process.env.PATH = empty;
        process.env.M07_MODE = 'sleep';
        const managed = path.join(microbotDir, 'jdk', 'temurin-17');
        fs.mkdirSync(path.dirname(managed), { recursive: true });
        fs.symlinkSync(JDKS[17], managed, 'dir');
        try {
            const harness = createHarness();
            await launch(harness);
            expect(await within(harness.dialogShown, 3000)).toBeNull();
            await waitFor(() => harness.spawnCalls.length >= 3);
            expect(harness.spawnCalls[0].command).toBe('java');
            expect(harness.spawnCalls[1].command).toBe(path.join(managed, 'bin', 'java'));
            expect(harness.spawnCalls[2].command).toBe(path.join(fs.realpathSync(JDKS[17]), 'bin', 'java'));
        } finally {
            fs.rmSync(path.join(microbotDir, 'jdk'), { recursive: true, force: true });
        }
    }, 15000);

    withJdk(17)('two launch requests while Java is missing share one install prompt', async () => {
        const empty = path.join(workDir, 'empty-bin');
        fs.mkdirSync(empty, { recursive: true });
        process.env.PATH = empty;
        process.env.M07_MODE = 'sleep';
        const installed = path.join(fs.realpathSync(JDKS[17]), 'bin', 'java');
        const harness = createHarness({ response: 0, installManagedJdk: jest.fn(async () => installed) });
        await require('../libs/jar-executor')(harness.deps);
        await Promise.all([
            harness.handlers['open-client']({}, VERSION, null, null, ''),
            harness.handlers['open-client']({}, VERSION, null, null, '')
        ]);
        await waitFor(() => harness.spawnCalls.filter((call) => call.command === installed).length >= 3);
        expect(harness.dialogs).toHaveLength(1);
        expect(harness.deps.installManagedJdk).toHaveBeenCalledTimes(1);
    }, 15000);

    withJdk(17)('a failed Java install is reported to the user', async () => {
        const empty = path.join(workDir, 'empty-bin');
        fs.mkdirSync(empty, { recursive: true });
        process.env.PATH = empty;
        const harness = createHarness({
            response: 0,
            installManagedJdk: jest.fn(async () => {
                throw new Error('network unreachable');
            })
        });
        await launch(harness);
        await waitFor(() => harness.dialogs.length >= 2);
        expect(harness.dialogs[1]).toMatchObject({ title: 'Java Could Not Be Installed' });
        expect(harness.dialogs[1].detail).toContain('network unreachable');
    }, 15000);

    test('spawn failures of the resolved executable are process-launch problems', async () => {
        const fakeRuntime = [
            '    java.home = /opt/fake-jdk',
            '    java.version = 17.0.1',
            '    sun.arch.data.model = 64',
            'openjdk version "17.0.1"'
        ].join('\n');
        const { EventEmitter } = require('events');
        const harness = createHarness({ response: 1, clipboard: false });
        harness.deps.spawn = (command, args) => {
            harness.spawnCalls.push({ command, args });
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stderr.destroy = jest.fn();
            proc.unref = jest.fn();
            proc.kill = jest.fn();
            setImmediate(() => {
                if (args[0] === '-XshowSettings:properties') {
                    proc.stderr.emit('data', Buffer.from(fakeRuntime));
                    proc.emit('close', 0);
                } else {
                    proc.emit('error', Object.assign(new Error(`spawn ${command} EACCES`), { code: 'EACCES' }));
                    proc.emit('close', -13, null);
                }
            });
            return proc;
        };
        await launch(harness);
        const shown = await within(harness.dialogShown, 5000);
        expect(shown.title).toBe('Client Could Not Be Started');
        expect(shown.detail).toContain('(process-launch)');
        expect(shown.buttons).toEqual(['Cancel']);
        expect(harness.deps.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    });
});
