const detect = require('detect-browsers');

/**
 * Returns the browser object {browser: String, executable: String} if found.
 * @returns {Promise<detect.Browser|null>} - Returns the supported browser found on the system.
 */
async function getAvailableBrowser() {
    let browsers = await detect.getAvailableBrowsers();
    const SUPPORTED_BROWSERS = [
        'Google Chrome',
        'Google Chrome Canary',
        'Chromium',
        'Microsoft Edge',
        'Brave Browser',
        'Opera',
        'Vivaldi'
    ];

    browsers = browsers.filter((b) => SUPPORTED_BROWSERS.includes(b.browser));

    if (browsers.length === 0) {
        console.error('No supported browser executable found on the system.');
        return null;
    }

    return browsers[0];
}

async function isBrowserDownloaded() {
    try {
        const executablePath = await getAvailableBrowser();
        return executablePath !== null;
    } catch (error) {
        console.error('Error checking browser existence:', error);
        return false;
    }
}

module.exports = {
    getAvailableBrowser,
    isBrowserDownloaded
};
