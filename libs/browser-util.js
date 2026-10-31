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

function isOperaLauncherStub(browser) {
    return (
        browser.browser === 'Opera' &&
        path.win32.basename(browser.executable).toLowerCase() === 'launcher.exe'
    );
}

async function getAvailableBrowsers() {
    const browsers = (await detect.getAvailableBrowsers()).filter((b) =>
        SUPPORTED_BROWSERS.includes(b.browser)
    );
    const drivable = [];
    const lastResort = [];
    for (const browser of browsers) {
        if (!isOperaLauncherStub(browser)) {
            drivable.push(browser);
            continue;
        }
        const operaBinary = path.win32.join(path.win32.dirname(browser.executable), 'opera.exe');
        if (fs.existsSync(operaBinary)) {
            drivable.push({ ...browser, executable: operaBinary });
        } else {
            lastResort.push(browser);
        }
    }
    return [...drivable, ...lastResort];
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
