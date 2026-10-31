jest.mock('detect-browsers', () => ({ getAvailableBrowsers: jest.fn() }));

const fs = require('fs');
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

    test('drives the Opera binary next to its launcher.exe stub', async () => {
        const operaLauncher = { browser: 'Opera', executable: 'C:\\Users\\bob\\AppData\\Local\\Programs\\Opera\\launcher.exe' };
        const operaBinary = 'C:\\Users\\bob\\AppData\\Local\\Programs\\Opera\\opera.exe';
        jest.spyOn(fs, 'existsSync').mockImplementation((file) => file === operaBinary);
        detect.getAvailableBrowsers.mockResolvedValue([edge, operaLauncher]);

        await expect(getAvailableBrowsers()).resolves.toEqual([edge, { browser: 'Opera', executable: operaBinary }]);
    });

    test('tries the Opera launcher.exe stub last when there is no opera.exe next to it', async () => {
        const operaLauncher = { browser: 'Opera', executable: 'C:\\Users\\bob\\AppData\\Local\\Programs\\Opera\\launcher.exe' };
        jest.spyOn(fs, 'existsSync').mockReturnValue(false);
        detect.getAvailableBrowsers.mockResolvedValue([operaLauncher, edge]);

        await expect(getAvailableBrowsers()).resolves.toEqual([edge, operaLauncher]);
    });

    test('keeps the Opera launcher.exe stub for an Opera-only player', async () => {
        const operaLauncher = { browser: 'Opera', executable: 'C:\\Users\\bob\\AppData\\Local\\Programs\\Opera\\launcher.exe' };
        jest.spyOn(fs, 'existsSync').mockReturnValue(false);
        detect.getAvailableBrowsers.mockResolvedValue([operaLauncher]);

        await expect(getAvailableBrowsers()).resolves.toEqual([operaLauncher]);
        await expect(getAvailableBrowser()).resolves.toEqual(operaLauncher);
    });

    test('leaves a launcher.exe that does not belong to Opera alone', async () => {
        const vivaldi = { browser: 'Vivaldi', executable: 'C:\\Programs\\Vivaldi\\launcher.exe' };
        const existsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        detect.getAvailableBrowsers.mockResolvedValue([vivaldi, edge]);

        await expect(getAvailableBrowsers()).resolves.toEqual([vivaldi, edge]);
        expect(existsSync).not.toHaveBeenCalled();
    });
});
