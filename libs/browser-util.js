const detect = require('detect-browsers');

const SUPPORTED_BROWSERS = [
    'Google Chrome',
    'Google Chrome Canary',
    'Chromium',
    'Microsoft Edge',
    'Brave Browser',
    'Opera',
    'Vivaldi'
];

async function getAvailableBrowsers() {
    const browsers = await detect.getAvailableBrowsers();
    return browsers.filter((b) => SUPPORTED_BROWSERS.includes(b.browser));
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
