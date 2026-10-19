const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const AdmZip = require('adm-zip');
const { RECOMMENDED_JAVA_MAJOR } = require('./java-runtime.js');

const ADOPTIUM_ASSETS = `https://api.adoptium.net/v3/assets/latest/${RECOMMENDED_JAVA_MAJOR}/hotspot`;
const OS_NAMES = { win32: 'windows', darwin: 'mac', linux: 'linux' };
const ARCH_NAMES = { x64: 'x64', arm64: 'aarch64' };

function installDir(microbotDir) {
    return path.join(microbotDir, 'jdk', `temurin-${RECOMMENDED_JAVA_MAJOR}`);
}

function javaExecutable(platform) {
    return platform === 'win32' ? 'java.exe' : 'java';
}

function javaPath(microbotDir, platform) {
    return path.join(installDir(microbotDir), 'bin', javaExecutable(platform));
}

function findJavaHome(root, platform) {
    const homes = [root, path.join(root, 'Contents', 'Home')];
    return homes.find((home) => fs.existsSync(path.join(home, 'bin', javaExecutable(platform)))) || null;
}

function findExtractedHome(stagingDir, platform) {
    for (const entry of fs.readdirSync(stagingDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const home = findJavaHome(path.join(stagingDir, entry.name), platform);
        if (home) return home;
    }
    return null;
}

async function fetchAsset(axios, platform, arch) {
    const os = OS_NAMES[platform];
    const architecture = ARCH_NAMES[arch];
    if (!os || !architecture) {
        throw new Error(`No Temurin Java ${RECOMMENDED_JAVA_MAJOR} build exists for ${platform} ${arch}.`);
    }
    const { data } = await axios.get(ADOPTIUM_ASSETS, {
        params: { architecture, image_type: 'jdk', os, vendor: 'eclipse' },
        timeout: 30000
    });
    const pkg = Array.isArray(data) && data[0] && data[0].binary && data[0].binary.package;
    if (!pkg || !pkg.link || !pkg.checksum || !pkg.name) {
        throw new Error('Adoptium returned no JDK package.');
    }
    return {
        url: pkg.link,
        checksum: String(pkg.checksum).toLowerCase(),
        name: path.basename(pkg.name),
        size: Number(pkg.size) || 0
    };
}

async function downloadVerified(axios, asset, target, onProgress) {
    const response = await axios.get(asset.url, { responseType: 'stream', timeout: 60000 });
    const total = Number(response.headers['content-length']) || asset.size;
    const hash = crypto.createHash('sha256');
    let received = 0;
    let reportedPercent = -1;
    response.data.on('data', (chunk) => {
        hash.update(chunk);
        received += chunk.length;
        if (!total) return;
        const percent = Math.floor((received / total) * 100);
        if (percent === reportedPercent) return;
        reportedPercent = percent;
        onProgress(received / total);
    });
    await pipeline(response.data, fs.createWriteStream(target));
    if (hash.digest('hex') !== asset.checksum) {
        fs.rmSync(target, { force: true });
        throw new Error('The downloaded Java package failed its checksum check.');
    }
}

function extractArchive(archive, destination) {
    if (archive.endsWith('.zip')) {
        new AdmZip(archive).extractAllTo(destination, true);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        execFile('tar', ['-xzf', archive, '-C', destination], (error) => (error ? reject(error) : resolve()));
    });
}

async function install({ axios, microbotDir, platform, arch, onProgress = () => {} }) {
    const asset = await fetchAsset(axios, platform, arch);
    const jdkRoot = path.join(microbotDir, 'jdk');
    fs.mkdirSync(jdkRoot, { recursive: true });
    const archive = path.join(jdkRoot, asset.name);
    const staging = fs.mkdtempSync(path.join(jdkRoot, 'extract-'));
    try {
        onProgress(0, `Downloading Java ${RECOMMENDED_JAVA_MAJOR}...`);
        await downloadVerified(axios, asset, archive, (fraction) => {
            onProgress(Math.round(fraction * 85), `Downloading Java ${RECOMMENDED_JAVA_MAJOR}...`);
        });
        onProgress(90, `Unpacking Java ${RECOMMENDED_JAVA_MAJOR}...`);
        await extractArchive(archive, staging);
        const home = findExtractedHome(staging, platform);
        if (!home) throw new Error('The downloaded Java package did not contain a runtime.');
        const target = installDir(microbotDir);
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(home, target);
        if (platform !== 'win32') {
            const bin = path.join(target, 'bin');
            for (const file of fs.readdirSync(bin)) fs.chmodSync(path.join(bin, file), 0o755);
        }
        return javaPath(microbotDir, platform);
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        fs.rmSync(archive, { force: true });
    }
}

module.exports = {
    install,
    javaPath,
    fetchAsset,
    findJavaHome,
    findExtractedHome,
    installDir
};
