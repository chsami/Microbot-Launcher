const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const AdmZip = require('adm-zip');
const managedJdk = require('../libs/managed-jdk');

let root;
let microbotDir;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-jdk-'));
    microbotDir = path.join(root, '.microbot');
    fs.mkdirSync(microbotDir);
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fakeAxios(archive, pkg) {
    return {
        get: jest.fn(async (url) => {
            if (url.includes('/v3/assets/')) {
                return { data: [{ binary: { package: pkg } }] };
            }
            return { data: fs.createReadStream(archive), headers: {} };
        })
    };
}

function packageFor(archive, overrides = {}) {
    return {
        link: 'https://example.test/download',
        checksum: sha256(archive),
        name: path.basename(archive),
        size: fs.statSync(archive).size,
        ...overrides
    };
}

function makeZip(archive, entries) {
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content));
    zip.writeZip(archive);
    return archive;
}

describe('managed JDK asset selection', () => {
    test('maps platform and architecture to Adoptium parameters', async () => {
        const axios = fakeAxios('', { link: 'x', checksum: 'x', name: 'x.zip' });
        const asset = await managedJdk.fetchAsset(axios, 'darwin', 'arm64');
        expect(axios.get).toHaveBeenCalledWith(
            expect.stringContaining('/v3/assets/latest/'),
            expect.objectContaining({
                params: { architecture: 'aarch64', image_type: 'jdk', os: 'mac', vendor: 'eclipse' }
            })
        );
        expect(asset).toMatchObject({ url: 'x', checksum: 'x', name: 'x.zip' });
    });

    test('rejects a platform with no Temurin build', async () => {
        const axios = fakeAxios('', {});
        await expect(managedJdk.fetchAsset(axios, 'freebsd', 'x64')).rejects.toThrow(/No Temurin/);
    });

    test('rejects a response without a JDK package', async () => {
        const axios = { get: jest.fn(async () => ({ data: [] })) };
        await expect(managedJdk.fetchAsset(axios, 'linux', 'x64')).rejects.toThrow(/no JDK package/);
    });
});

describe('managed JDK install', () => {
    test('installs a verified Windows zip and returns its java.exe', async () => {
        const archive = makeZip(path.join(root, 'jdk.zip'), {
            'jdk-17.0.20.1+1/bin/java.exe': 'java',
            'jdk-17.0.20.1+1/release': 'JAVA_VERSION="17"'
        });
        const axios = fakeAxios(archive, packageFor(archive, { name: 'OpenJDK17U-jdk_x64_windows.zip' }));

        const javaCommand = await managedJdk.install({ axios, microbotDir, platform: 'win32', arch: 'x64' });

        expect(javaCommand).toBe(managedJdk.javaPath(microbotDir, 'win32'));
        expect(fs.existsSync(javaCommand)).toBe(true);
        expect(fs.existsSync(path.join(microbotDir, 'jdk', 'OpenJDK17U-jdk_x64_windows.zip'))).toBe(false);
        expect(fs.readdirSync(path.join(microbotDir, 'jdk'))).toEqual(['temurin-17']);
    });

    test('rejects a package whose checksum does not match and installs nothing', async () => {
        const archive = makeZip(path.join(root, 'jdk.zip'), { 'jdk-17/bin/java.exe': 'java' });
        const axios = fakeAxios(archive, packageFor(archive, { checksum: 'deadbeef', name: 'bad.zip' }));

        await expect(managedJdk.install({ axios, microbotDir, platform: 'win32', arch: 'x64' })).rejects.toThrow(
            /checksum/
        );
        expect(fs.existsSync(managedJdk.installDir(microbotDir))).toBe(false);
        expect(fs.existsSync(path.join(microbotDir, 'jdk', 'bad.zip'))).toBe(false);
    });

    test('installs a macOS tar.gz from its Contents/Home layout', async () => {
        const source = path.join(root, 'src');
        const home = path.join(source, 'jdk-17.0.20.1+1', 'Contents', 'Home');
        fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(home, 'bin', 'java'), 'java');
        const archive = path.join(root, 'jdk.tar.gz');
        childProcess.execFileSync('tar', ['-czf', archive, '-C', source, 'jdk-17.0.20.1+1']);
        const axios = fakeAxios(archive, packageFor(archive, { name: 'OpenJDK17U-jdk_aarch64_mac.tar.gz' }));

        const javaCommand = await managedJdk.install({ axios, microbotDir, platform: 'darwin', arch: 'arm64' });

        expect(javaCommand).toBe(path.join(microbotDir, 'jdk', 'temurin-17', 'bin', 'java'));
        expect(fs.existsSync(javaCommand)).toBe(true);
        if (process.platform !== 'win32') {
            expect(fs.statSync(javaCommand).mode & 0o111).not.toBe(0);
        }
    });

    test('reports progress from zero to the unpacking stage', async () => {
        const archive = makeZip(path.join(root, 'jdk.zip'), { 'jdk/bin/java.exe': 'java' });
        const axios = fakeAxios(archive, packageFor(archive, { name: 'progress.zip' }));
        const onProgress = jest.fn();

        await managedJdk.install({ axios, microbotDir, platform: 'win32', arch: 'x64', onProgress });

        const percents = onProgress.mock.calls.map((call) => call[0]);
        expect(percents[0]).toBe(0);
        expect(percents).toContain(90);
    });
});
