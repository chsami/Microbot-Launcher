jest.mock('detect-browsers', () => ({ getAvailableBrowsers: jest.fn() }));

const detect = require('detect-browsers');
const { getAvailableBrowser, getAvailableBrowsers } = require('../libs/browser-util.js');

const brave = { browser: 'Brave Browser', executable: 'brave.exe' };
const edge = { browser: 'Microsoft Edge', executable: 'msedge.exe' };
const firefox = { browser: 'Firefox', executable: 'firefox.exe' };

describe('browser-util', () => {
    beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
    afterEach(() => jest.restoreAllMocks());

    test('returns every supported browser in detection order', async () => {
        detect.getAvailableBrowsers.mockResolvedValue([brave, firefox, edge]);

        await expect(getAvailableBrowsers()).resolves.toEqual([brave, edge]);
    });

    test('still returns only the first supported browser for single-browser callers', async () => {
        detect.getAvailableBrowsers.mockResolvedValue([firefox, brave, edge]);

        await expect(getAvailableBrowser()).resolves.toEqual(brave);
    });

    test('returns no browsers when none are supported', async () => {
        detect.getAvailableBrowsers.mockResolvedValue([firefox]);

        await expect(getAvailableBrowsers()).resolves.toEqual([]);
        await expect(getAvailableBrowser()).resolves.toBeNull();
    });
});
