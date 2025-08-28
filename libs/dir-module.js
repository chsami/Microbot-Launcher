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
 * @returns {{success: boolean, path?: string, error?: string}}
 */
function openLocation(key) {
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
        shell.openPath(target);
        return { success: true, path: target };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    microbotDir,
    openLocation
};
