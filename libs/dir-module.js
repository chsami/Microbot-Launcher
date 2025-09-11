const os = require('os');
const path = require('path');

// shell is only required lazily to avoid cyclic requires when this file is imported early.
let _shell = null;
function getShell() {
    if (!_shell) {
        _shell = require('electron').shell;
    }
    return _shell;
}

// commonly used internal locations (create if missing on demand)
const homeDir = os.homedir();
const microbotDir = path.join(homeDir, '.microbot');
const runeliteDir = path.join(homeDir, '.runelite');
const clientLogs = path.join(runeliteDir, 'logs', 'client.log');
const launcherLogs = () => {
    switch (process.platform) {
        case 'win32':
            return path.join(
                homeDir,
                'AppData',
                'Roaming',
                'microbot-launcher',
                'logs',
                'main.log'
            );
        case 'darwin':
            return path.join(
                homeDir,
                'Library',
                'Logs',
                'microbot-launcher',
                'main.log'
            );
        case 'linux':
            return path.join(
                homeDir,
                '.config',
                'microbot-launcher',
                'logs',
                'main.log'
            );
    }
    return null;
};

/**
 * Uses electron shell to open a path based on the logical key.
 * Shell automatically determines if the path is a file or directory.
 * @param {string} key Logical location key
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function openLocation(key) {
    try {
        const mapping = {
            'launcher-logs': launcherLogs(),
            'client-logs': clientLogs,
            'runelite-folder': runeliteDir,
            'microbot-folder': microbotDir
        };
        const target = mapping[key];
        if (!target) {
            return { success: false, error: 'Unknown folder key: ' + key };
        }
        const shell = getShell();
        const err = await shell.openPath(target);
        if (err) {
            return { success: false, error: err };
        }
        return { success: true, path: target };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Check for the existence of the clients_jar_ttl.json file in the microbot directory.
 * Creating with an empty object if it does not exist.
 * @return {Object} The parsed JSON object from the file.
 */
async function getClientsJarTTL() {
    const fs = require('fs').promises;
    const filePath = path.join(microbotDir, 'clients_jar_ttl.json');
    try {
        await fs.mkdir(microbotDir, { recursive: true });
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return { success: true, data: JSON.parse(data) };
        } catch (readErr) {
            if (readErr.code === 'ENOENT') {
                await fs.writeFile(filePath, JSON.stringify({}));
                return { success: true, data: {} };
            }
            return { success: false, error: readErr.message };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Cleanup routines for clients jar using the TTL data.
 * Delete any jar files that haven't been used in the past 3 days, with the exception
 * of the latest version.
 * @param {string} latestVersion The latest version string to exclude from deletion.
 * @return {Promise<{success: boolean, error?: string}>} Result object indicating success or failure.
 */
async function cleanupUnusedClientsJar(latestVersion) {
    const fs = require('fs').promises;
    const result = await getClientsJarTTL();
    if (!result.success) {
        return { success: false, error: result.error };
    }

    if (!latestVersion) {
        return { success: false, error: 'Latest version not provided' };
    }

    let ttlData = result.data || {};
    let updated = false;
    try {
        const files = await fs.readdir(microbotDir);
        const jarFiles = files.filter(
            (f) =>
                f.endsWith('.jar') &&
                f.startsWith('microbot-') &&
                !f.includes('launcher')
        );
        const now = Date.now();
        for (const jarFile of jarFiles) {
            let version = jarFile.replace('.jar', '');
            version = version.replace('microbot-', '');
            if (!(version in ttlData)) {
                ttlData[version] = now;
                updated = true;
            }
        }
    } catch (err) {
        return { success: false, error: err.message };
    }

    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    let deletedAny = false;

    for (const [version, lastUsed] of Object.entries(ttlData)) {
        if (version === latestVersion) {
            continue;
        }
        if (now - lastUsed > threeDays) {
            const jarPath = path.join(microbotDir, `microbot-${version}.jar`);
            try {
                await fs.unlink(jarPath);
                delete ttlData[version];
                deletedAny = true;
                updated = true;
            } catch (err) {
                if (err.code === 'ENOENT') {
                    // File already gone: drop TTL entry and continue.
                    delete ttlData[version];
                    updated = true;
                    continue;
                }
                return { success: false, error: err.message };
            }
        }
    }

    // we return if nothing changed
    if (!updated) {
        return { success: true };
    }

    const filePath = path.join(microbotDir, 'clients_jar_ttl.json');
    try {
        await fs.writeFile(filePath, JSON.stringify(ttlData, null, 2), 'utf8');
    } catch (err) {
        return { success: false, error: err.message };
    }

    return { success: true };
}

/**
 * Update the last used timestamp for a specific client version.
 * @param {string} version The client version to update.
 * @return {Promise<{success: boolean, error?: string}>} Result object indicating success or failure.
 */
async function updateClientJarTTL(version) {
    const fs = require('fs').promises;
    if (!version) {
        return { success: false, error: 'Version not provided' };
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(version)) {
        return { success: false, error: 'Invalid version format' };
    }

    const jarPath = path.join(microbotDir, `microbot-${version}.jar`);
    try {
        await fs.stat(jarPath);
    } catch (e) {
        if (e.code === 'ENOENT') {
            return {
                success: false,
                error: `Jar not found for version: ${version}`
            };
        }
        return { success: false, error: e.message };
    }

    const result = await getClientsJarTTL();
    if (!result.success) {
        return { success: false, error: result.error };
    }

    const ttlData = result.data;
    ttlData[version] = Date.now();

    const filePath = path.join(microbotDir, 'clients_jar_ttl.json');
    try {
        await fs.writeFile(filePath, JSON.stringify(ttlData, null, 2), 'utf8');
    } catch (err) {
        return { success: false, error: err.message };
    }

    return { success: true };
}

module.exports = {
    microbotDir,
    openLocation,
    getClientsJarTTL,
    cleanupUnusedClientsJar,
    updateClientJarTTL
};
