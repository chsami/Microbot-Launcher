const detect = require('detect-browsers');
const fs = require('fs');
const path = require('path');

const SUPPORTED_BROWSERS = [
    'Google Chrome',
    'Google Chrome Canary',
    'Chromium',
    'Microsoft Edge',
    'Brave Browser',
    'Opera',
    'Vivaldi'
];

function drivableBrowser(browser) {
    if (path.win32.basename(browser.executable).toLowerCase() !== 'launcher.exe') {
        return browser;
    }
    const sibling = path.win32.join(path.win32.dirname(browser.executable), 'opera.exe');
    return fs.existsSync(sibling) ? { ...browser, executable: sibling } : null;
}

async function getAvailableBrowsers() {
    const browsers = await detect.getAvailableBrowsers();
    return browsers
        .filter((b) => SUPPORTED_BROWSERS.includes(b.browser))
        .map(drivableBrowser)
        .filter(Boolean);
}

/**
 * Returns the browser object {browser: String, executable: String} if found.
 * @returns {Promise<detect.Browser|null>} - Returns the supported browser found on the system.
 */
async function getAvailableBrowser() {
    const browsers = await getAvailableBrowsers();

    if (browsers.length === 0) {
        console.error('No supported browser executable found on the system.');
        return null;
    }

    return browsers[0];
}

module.exports = {
    getAvailableBrowser,
    getAvailableBrowsers
};
