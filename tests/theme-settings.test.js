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

    test('nothing is picked when the file is missing, broken or holds unknown values', () => {
        expect(settings.read(home)).toEqual({});
        fs.mkdirSync(path.join(home, '.microbot'));
        fs.writeFileSync(settings.settingsFile(home), '{oops');
        expect(settings.read(home)).toEqual({});
        fs.writeFileSync(settings.settingsFile(home), '{"theme":"pink","font":7}');
        expect(settings.read(home)).toEqual({});
    });

    test('keeps a key that was picked without inventing the other', () => {
        fs.mkdirSync(path.join(home, '.microbot'));
        fs.writeFileSync(settings.settingsFile(home), '{"theme":" Slate "}');
        expect(settings.read(home)).toEqual({ theme: 'slate' });
    });

    test('writes only known values, in the shape the client reads', () => {
        expect(settings.write({ theme: 'Slate', font: 'evil', extra: 1 }, home)).toEqual({ theme: 'slate' });
        expect(JSON.parse(fs.readFileSync(settings.settingsFile(home), 'utf8'))).toEqual({ theme: 'slate' });
        expect(settings.write({ theme: ' Classic ' }, home)).toEqual({ theme: 'classic' });
        expect(settings.read(home)).toEqual({ theme: 'classic' });
    });

    test('a write without a theme keeps the saved one, and an old font key is dropped', () => {
        fs.mkdirSync(path.join(home, '.microbot'));
        fs.writeFileSync(settings.settingsFile(home), '{"theme":"slate","font":"inter"}');
        expect(settings.read(home)).toEqual({ theme: 'slate' });
        expect(settings.write({ font: 'inter' }, home)).toEqual({ theme: 'slate' });
        expect(settings.read(home)).toEqual({ theme: 'slate' });
    });

    test('replaces the file without leaving temp files behind', () => {
        settings.write({ theme: 'gold' }, home);
        settings.write({ theme: 'classic' }, home);
        expect(fs.readdirSync(path.join(home, '.microbot'))).toEqual(['theme.json']);
        expect(settings.read(home).theme).toBe('classic');
    });

    test('registers read and write handlers', async () => {
        const handlers = {};
        settings.register({ removeHandler: jest.fn(), handle: (name, fn) => (handlers[name] = fn) });
        expect(Object.keys(handlers).sort()).toEqual(['theme:read', 'theme:write']);
    });
});
