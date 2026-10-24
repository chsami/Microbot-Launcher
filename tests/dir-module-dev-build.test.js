const os = require('os');
const path = require('path');

describe('dir-module data folder', () => {
    afterEach(() => {
        jest.dontMock('../package.json');
        jest.resetModules();
    });

    test('release builds keep ~/.microbot', () => {
        jest.resetModules();
        jest.doMock('../package.json', () => ({ name: 'microbot-launcher' }));
        const { microbotDir, microbotDirName } = require('../libs/dir-module.js');
        expect(microbotDirName).toBe('.microbot');
        expect(microbotDir).toBe(path.join(os.homedir(), '.microbot'));
    });

    test('dev builds use ~/.microbot-dev', () => {
        jest.resetModules();
        jest.doMock('../package.json', () => ({ name: 'microbot-launcher-dev' }));
        const { microbotDir, microbotDirName } = require('../libs/dir-module.js');
        expect(microbotDirName).toBe('.microbot-dev');
        expect(microbotDir).toBe(path.join(os.homedir(), '.microbot-dev'));
    });
});
