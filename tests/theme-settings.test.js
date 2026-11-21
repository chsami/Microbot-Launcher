const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('../libs/theme-settings');

describe('theme-settings', () => {
    let home;
    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-'));
    });
    afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

    test('defaults when the file is missing or broken', () => {
        expect(settings.read(home)).toEqual({ theme: 'gold', font: 'montserrat' });
        fs.mkdirSync(path.join(home, '.microbot'));
        fs.writeFileSync(settings.settingsFile(home), '{oops');
        expect(settings.read(home)).toEqual({ theme: 'gold', font: 'montserrat' });
    });

    test('writes only known values, in the shape the client reads', () => {
        expect(settings.write({ theme: 'Slate', font: 'evil', extra: 1 }, home)).toEqual({ theme: 'slate', font: 'montserrat' });
        expect(JSON.parse(fs.readFileSync(settings.settingsFile(home), 'utf8'))).toEqual({ theme: 'slate', font: 'montserrat' });
        expect(settings.read(home)).toEqual({ theme: 'slate', font: 'montserrat' });
    });

    test('registers read and write handlers', async () => {
        const handlers = {};
        settings.register({ removeHandler: jest.fn(), handle: (name, fn) => (handlers[name] = fn) });
        expect(Object.keys(handlers).sort()).toEqual(['theme:read', 'theme:write']);
    });
});
