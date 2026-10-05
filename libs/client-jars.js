const path = require('path');

const CLIENT_JAR_PATTERN = /^microbot-(.+)\.jar$/;
const OFFICIAL_VERSION_PATTERN = /^\d+(\.\d+)*$/;
const LEADING_VERSION_PATTERN = /^(\d+(?:\.\d+)*)/;
const DOWNLOADED_CLIENTS_FILE = 'downloaded_clients.json';

function isSafeClientVersion(version) {
    return (
        typeof version === 'string' &&
        version.length > 0 &&
        version.length <= 128 &&
        version.trim() === version &&
        !/[\\/:*?"<>|\u0000-\u001f]/.test(version) &&
        !version.includes('..')
    );
}

function parseClientJar(file) {
    if (typeof file !== 'string') {
        return null;
    }
    const match = CLIENT_JAR_PATTERN.exec(file);
    if (!match) {
        return null;
    }
    const version = match[1];
    if (!isSafeClientVersion(version) || /^launcher/i.test(version)) {
        return null;
    }
    return {
        file,
        version,
        kind: OFFICIAL_VERSION_PATTERN.test(version) ? 'official' : 'custom'
    };
}

function versionParts(version) {
    const match = LEADING_VERSION_PATTERN.exec(version || '');
    return match ? match[1].split('.').map(Number) : null;
}

function compareVersionParts(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const partA = a[i] || 0;
        const partB = b[i] || 0;
        if (partA !== partB) {
            return partA - partB;
        }
    }
    return 0;
}

function compareClientJars(a, b) {
    if (a.kind !== b.kind) {
        return a.kind === 'official' ? -1 : 1;
    }
    const partsA = versionParts(a.version);
    const partsB = versionParts(b.version);
    if (partsA && partsB) {
        const diff = compareVersionParts(partsB, partsA);
        if (diff !== 0) {
            return diff;
        }
    } else if (partsA || partsB) {
        return partsA ? -1 : 1;
    }
    const nameA = a.file.toLowerCase();
    const nameB = b.file.toLowerCase();
    if (nameA !== nameB) {
        return nameA < nameB ? -1 : 1;
    }
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}

function labelClientJar(entry, latestVersion) {
    if (entry.kind === 'custom') {
        return `${entry.version} (custom)`;
    }
    if (typeof latestVersion === 'string' && entry.version === latestVersion) {
        return `${entry.version} (latest)`;
    }
    if (typeof latestVersion === 'string' && versionParts(latestVersion)) {
        const diff = compareVersionParts(
            versionParts(entry.version),
            versionParts(latestVersion)
        );
        if (diff < 0) {
            return `${entry.version} (older)`;
        }
    }
    return entry.version;
}

function listClientJars(fs, dir, latestVersion) {
    let files;
    try {
        files = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
    return files
        .filter((dirent) => dirent.isFile() || dirent.isSymbolicLink())
        .map((dirent) => parseClientJar(dirent.name))
        .filter(Boolean)
        .sort(compareClientJars)
        .map((entry) => ({
            ...entry,
            label: labelClientJar(entry, latestVersion)
        }));
}

function readDownloadedClients(fs, dir) {
    try {
        const raw = fs.readFileSync(path.join(dir, DOWNLOADED_CLIENTS_FILE), 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((v) => typeof v === 'string')
            : [];
    } catch (_) {
        return [];
    }
}

function writeDownloadedClients(fs, dir, versions) {
    fs.writeFileSync(
        path.join(dir, DOWNLOADED_CLIENTS_FILE),
        JSON.stringify([...new Set(versions)].sort(), null, 2),
        'utf8'
    );
}

function markClientDownloaded(fs, dir, version) {
    if (!isSafeClientVersion(version)) {
        return;
    }
    const versions = readDownloadedClients(fs, dir);
    if (!versions.includes(version)) {
        writeDownloadedClients(fs, dir, [...versions, version]);
    }
}

module.exports = {
    DOWNLOADED_CLIENTS_FILE,
    isSafeClientVersion,
    parseClientJar,
    compareClientJars,
    labelClientJar,
    listClientJars,
    readDownloadedClients,
    writeDownloadedClients,
    markClientDownloaded
};
