const fs = require('fs');
const path = require('path');
const javaRuntime = require('../libs/java-runtime');

const fixtureDir = path.join(__dirname, '__fixtures__', 'java-probe');
const fixture = (name) => fs.readFileSync(path.join(fixtureDir, `${name}.txt`), 'utf8');

describe('parseJavaMajor', () => {
    test.each([
        ['1.8.0_401', 8],
        ['1.8.0_504', 8],
        ['1.7.0', 7],
        ['9', 9],
        ['11.0.28', 11],
        ['11.0.20.1', 11],
        ['17', 17],
        ['17.0.8+7', 17],
        ['21-ea', 21],
        ['21.0.4', 21],
        ['25.0.4.1', 25],
        ['24.0.1', 24]
    ])('%s -> %i', (version, major) => {
        expect(javaRuntime.parseJavaMajor(version)).toBe(major);
    });

    test.each([null, undefined, '', 'unknown', 'abc.1'])('rejects %p', (value) => {
        expect(javaRuntime.parseJavaMajor(value)).toBeNull();
    });
});

describe('parseJavaSettings with real and synthetic probe output', () => {
    test.each([
        ['linux-temurin-8', { major: 8, vendor: 'Temurin', dataModel: 64, osArch: 'amd64' }],
        ['linux-temurin-11.0.28', { major: 11, vendor: 'Eclipse Adoptium', dataModel: 64 }],
        ['linux-ms-11.0.28', { major: 11, vendor: 'Microsoft', dataModel: 64 }],
        ['linux-java-17-openjdk-amd64', { major: 17, version: '17.0.20', home: '/usr/lib/jvm/java-17-openjdk-amd64' }],
        ['linux-java-21-openjdk-amd64', { major: 21 }],
        ['linux-openjdk-24.0.1', { major: 24, vendor: 'Oracle Corporation' }],
        ['linux-java-25-openjdk-amd64', { major: 25, version: '25.0.4.1' }],
        ['synthetic-windows-oracle-8-x86', { major: 8, dataModel: 32, osArch: 'x86', home: 'C:\\Program Files (x86)\\Java\\jre1.8.0_401' }],
        ['synthetic-windows-temurin-17-x86', { major: 17, dataModel: 32 }],
        ['synthetic-mac-zulu-21-aarch64', { major: 21, osArch: 'aarch64', vendor: 'Azul Systems, Inc.' }]
    ])('%s', (name, expected) => {
        expect(javaRuntime.parseJavaSettings(fixture(name))).toMatchObject(expected);
    });

    test('falls back to the version banner when properties are missing', () => {
        const info = javaRuntime.parseJavaSettings(
            'java version "1.8.0_401"\nJava HotSpot(TM) Client VM (build 25.401-b10, mixed mode)\n'
        );
        expect(info).toMatchObject({ version: '1.8.0_401', major: 8, dataModel: 32, home: null });
    });

    test('returns unknown values for unrelated output', () => {
        expect(javaRuntime.parseJavaSettings('garbage')).toMatchObject({ major: null, version: null });
    });
});

describe('evaluateRuntime', () => {
    const info = (name) => javaRuntime.parseJavaSettings(fixture(name));

    test('accepts Java 11 and newer 64-bit runtimes', () => {
        for (const name of ['linux-temurin-11.0.28', 'linux-java-17-openjdk-amd64', 'linux-java-25-openjdk-amd64', 'synthetic-mac-zulu-21-aarch64']) {
            expect(javaRuntime.evaluateRuntime(info(name), { heapMb: 4096 })).toEqual({ compatible: true, problems: [] });
        }
    });

    test('rejects Java 8 with a specific recovery action', () => {
        const result = javaRuntime.evaluateRuntime(info('linux-temurin-8'), { heapMb: 600 });
        expect(result.compatible).toBe(false);
        expect(result.problems[0]).toMatchObject({ code: 'too-old' });
        expect(result.problems[0].message).toContain('Java 8 is too old');
        expect(result.problems[0].recovery).toContain('Java 17');
    });

    test('allows 32-bit Java with the default heap but rejects large heaps', () => {
        const x86 = info('synthetic-windows-temurin-17-x86');
        expect(javaRuntime.evaluateRuntime(x86, { heapMb: 600 }).compatible).toBe(true);
        const result = javaRuntime.evaluateRuntime(x86, { heapMb: 2048 });
        expect(result.compatible).toBe(false);
        expect(result.problems.map((p) => p.code)).toEqual(['32-bit-heap']);
    });

    test('reports both problems for old 32-bit Java with a large heap', () => {
        const result = javaRuntime.evaluateRuntime(info('synthetic-windows-oracle-8-x86'), { heapMb: 4096 });
        expect(result.problems.map((p) => p.code)).toEqual(['too-old', '32-bit-heap']);
    });

    test('rejects an undetermined version', () => {
        expect(javaRuntime.evaluateRuntime({ major: null }).problems[0].code).toBe('unknown-version');
    });
});

describe('heapMbFromArgs', () => {
    test.each([
        [['-Xms512m', '-Xmx600m'], 600],
        [['-Xmx2g'], 2048],
        [['-Xmx1.5g'], 1536],
        [['-Xmx1g', '-Xmx4G'], 4096],
        [['-Xmx1048576k'], 1024],
        [['-jar', 'x.jar'], null]
    ])('%p -> %p', (args, expected) => {
        expect(javaRuntime.heapMbFromArgs(args)).toBe(expected);
    });
});

describe('supportedVmArgs', () => {
    const args = [
        '-Xms512m', '-Xmx600m', '-XX:+UseZGC', '-XX:SoftMaxHeapSize=500m', '-XX:+ZUncommit',
        '-XX:ZUncommitDelay=30', '-XX:+UseStringDedup', '-Xss512k', '-XX:+IgnoreUnrecognizedVMOptions',
        '-jar', 'microbot.jar'
    ];

    test('keeps ZGC flags on Java 15 and newer', () => {
        expect(javaRuntime.supportedVmArgs(15, args)).toEqual(args);
        expect(javaRuntime.supportedVmArgs(21, args)).toEqual(args);
    });

    test('drops only ZGC flags before Java 15', () => {
        expect(javaRuntime.supportedVmArgs(11, args)).toEqual([
            '-Xms512m', '-Xmx600m', '-XX:+UseStringDedup', '-Xss512k',
            '-XX:+IgnoreUnrecognizedVMOptions', '-jar', 'microbot.jar'
        ]);
    });
});

describe('redactText and boundedTail', () => {
    test('removes credentials, account identifiers and the home directory', () => {
        const text = [
            'java -jar c.jar -proxy=socks5://bob:hunter2@10.0.0.5:1080 -profile=MainAccount',
            'proxy socks5://bob:hunter2@10.0.0.5:1080 password=hunter2 JX_SESSION_ID=abc123 sessionId: xyz',
            'mail bob@example.com at /home/alice/.microbot/logs'
        ].join('\n');
        const redacted = javaRuntime.redactText(text, { homeDir: '/home/alice' });
        for (const secret of ['hunter2', 'abc123', 'xyz', 'MainAccount', 'bob@example.com', '/home/alice', 'bob:']) {
            expect(redacted).not.toContain(secret);
        }
        expect(redacted).toContain('~/.microbot/logs');
        expect(redacted).toContain('10.0.0.5:1080');
    });

    test('keeps useful JVM errors intact', () => {
        const text = 'Error: Could not create the Java Virtual Machine.\nError: A fatal exception has occurred. Program will exit.';
        expect(javaRuntime.redactText(text)).toBe(text);
    });

    test('bounds output by lines and characters', () => {
        const lines = Array.from({ length: 500 }, (_, i) => `noise line ${i}`).join('\n');
        const tail = javaRuntime.boundedTail(lines);
        expect(tail.split('\n')).toHaveLength(21);
        expect(tail.startsWith('…\n')).toBe(true);
        expect(tail).toContain('noise line 499');
        const long = javaRuntime.boundedTail('x'.repeat(10000), { maxChars: 100 });
        expect(long.length).toBeLessThanOrEqual(102);
        expect(javaRuntime.boundedTail('   ')).toBe('');
    });
});

describe('classifyProbeFailure', () => {
    test('missing java command', () => {
        const err = Object.assign(new Error('spawn java ENOENT'), { code: 'ENOENT' });
        expect(javaRuntime.classifyProbeFailure({ error: err })).toMatchObject({ kind: 'missing-java', offerDownload: true });
    });

    test('permission failure is a process-launch problem', () => {
        const err = Object.assign(new Error('spawn java EACCES'), { code: 'EACCES' });
        expect(javaRuntime.classifyProbeFailure({ error: err })).toMatchObject({ kind: 'process-launch' });
    });

    test('timeout and non-zero exit are incompatible runtimes', () => {
        expect(javaRuntime.classifyProbeFailure({ timedOut: true }).kind).toBe('incompatible-java');
        const failed = javaRuntime.classifyProbeFailure({ code: 1, stderr: 'Error: could not open jvm.cfg' });
        expect(failed).toMatchObject({ kind: 'incompatible-java', stderr: 'Error: could not open jvm.cfg' });
    });
});

describe('classifyLaunchFailure', () => {
    test('missing executable and other spawn errors', () => {
        const missing = Object.assign(new Error('spawn javaw ENOENT'), { code: 'ENOENT' });
        expect(javaRuntime.classifyLaunchFailure({ error: missing }).kind).toBe('missing-java');
        const denied = Object.assign(new Error('spawn java EACCES'), { code: 'EACCES' });
        expect(javaRuntime.classifyLaunchFailure({ error: denied }).kind).toBe('process-launch');
    });

    test.each([
        ['Error: The unlock option must precede \'UseZGC\'.\nError: Could not create the Java Virtual Machine.', 'rejected a launcher option'],
        ['Error occurred during initialization of VM\nCould not reserve enough space for 2097152KB object heap', 'Lower the client RAM'],
        ['# There is insufficient memory for the Java Runtime Environment to continue.', 'Lower the client RAM'],
        ['Error: Unable to access jarfile /x/microbot-2.jar', 'client file is missing or damaged'],
        ['Exception in thread "main" java.lang.UnsupportedClassVersionError: net/runelite/client/RuneLite has been compiled by a more recent version', 'too old'],
        ['Error: Could not create the Java Virtual Machine.', 'Install Java 17']
    ])('VM failure %#', (stderr, recovery) => {
        const problem = javaRuntime.classifyLaunchFailure({ code: 1, stderr });
        expect(problem.kind).toBe('vm-failure');
        expect(problem.recovery).toContain(recovery);
    });

    test('ordinary early exit is a client startup failure', () => {
        const problem = javaRuntime.classifyLaunchFailure({ code: 1, stderr: 'java.lang.IllegalStateException: plugin manager failed' });
        expect(problem.kind).toBe('client-startup');
        expect(problem.message).toContain('exit code 1');
        expect(javaRuntime.classifyLaunchFailure({ code: null, signal: 'SIGKILL' }).message).toContain('signal SIGKILL');
    });
});

describe('launcherExecutable', () => {
    test('uses the probed runtime home when its binary exists', () => {
        const info = { home: '/usr/lib/jvm/java-17-openjdk-amd64' };
        expect(javaRuntime.launcherExecutable(info, 'linux', () => true)).toBe('/usr/lib/jvm/java-17-openjdk-amd64/bin/java');
        const win = { home: 'C:\\Program Files\\Java\\jdk-17\\' };
        expect(javaRuntime.launcherExecutable(win, 'win32', () => true)).toBe('C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe');
    });

    test('falls back to the PATH command', () => {
        expect(javaRuntime.launcherExecutable({ home: '/nope' }, 'linux', () => false)).toBe('java');
        expect(javaRuntime.launcherExecutable(null, 'win32', () => true)).toBe('javaw');
    });
});

describe('javaDownloadUrl and formatProblemDetails', () => {
    test('preserves the Temurin 17 download targets', () => {
        expect(javaRuntime.javaDownloadUrl('win32', 'x64')).toBe(
            'https://adoptium.net/temurin/releases/?os=windows&arch=x64&package=jdk&version=17&mode=filter'
        );
        expect(javaRuntime.javaDownloadUrl('darwin', 'arm64')).toContain('os=mac&arch=aarch64');
        expect(javaRuntime.javaDownloadUrl('freebsd', 'x64')).toBe('https://adoptium.net/temurin/');
    });

    test('formats a redacted, bounded report', () => {
        const runtime = javaRuntime.parseJavaSettings(fixture('linux-temurin-11.0.28'));
        const problem = javaRuntime.classifyLaunchFailure({ code: 1, stderr: 'Error: Could not create the Java Virtual Machine.' });
        const details = javaRuntime.formatProblemDetails({
            problem,
            runtime,
            executable: '/home/user/.jdks/temurin-11.0.28/bin/java',
            stderr: 'password=hunter2\nError: Could not create the Java Virtual Machine.',
            launcherVersion: '3.2.8',
            platform: 'linux',
            arch: 'x64',
            homeDir: '/home/user'
        });
        expect(details).toContain('Problem: Java Could Not Start The Client (vm-failure)');
        expect(details).toContain('Runtime: Java 11.0.28 Eclipse Adoptium (amd64, 64-bit)');
        expect(details).toContain('Java home: ~/.jdks/temurin-11.0.28');
        expect(details).toContain('Launcher: 3.2.8 on linux x64');
        expect(details).toContain('Could not create the Java Virtual Machine');
        expect(details).not.toContain('hunter2');
        expect(details).not.toContain('/home/user');
    });
});
