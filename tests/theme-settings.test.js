const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('../libs/theme-settings');
const { selection } = require('../libs/custom-theme');

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

    test('a custom pick too hard to read is refused on write and ignored on read', () => {
        settings.write({ theme: 'slate' }, home);
        const bad = selection('grey', { name: 'Grey', base: 'slate' });
        bad.custom.colors.text = bad.custom.colors.dark;
        expect(settings.write(bad, home)).toEqual({ error: 'That theme is incomplete or too hard to read.' });
        expect(settings.read(home)).toEqual({ theme: 'slate' });
        fs.writeFileSync(settings.settingsFile(home), JSON.stringify(bad));
        expect(settings.read(home)).toEqual({});
        const good = selection('blue', { name: 'Blue', base: 'slate', colors: { accent: '#3399ff' } });
        expect(settings.write(good, home)).toEqual(good);
    });

    test('replaces the file without leaving temp files behind', () => {
        settings.write({ theme: 'gold' }, home);
        settings.write({ theme: 'classic' }, home);
        expect(fs.readdirSync(path.join(home, '.microbot'))).toEqual(['theme.json']);
        expect(settings.read(home).theme).toBe('classic');
    });

    test('launcher colours follow the picked theme, none when nothing or garbage is picked', () => {
        expect(settings.launcherColors(home)).toBeNull();
        settings.write({ theme: 'slate' }, home);
        expect(settings.launcherColors(home)).toEqual({ bg: '#15171c', surface: '#15171c', text: '#c9cdd6', textStrong: '#e3e6ec', accent: '#f5a524', onAccent: '#15171c', line: '#262a33', red: '#c2231f' });
        settings.write({ theme: 'classic' }, home);
        expect(settings.launcherColors(home)).toEqual({ bg: '#181818', surface: '#1e1e1e', text: '#c6c6c6', textStrong: '#ebebeb', accent: '#dc8a00', onAccent: '#141414', line: '#323232', red: '#c2231f' });
        fs.writeFileSync(settings.settingsFile(home), '{"theme":"</style><script>"}');
        expect(settings.launcherColors(home)).toBeNull();
    });

    test('Gold is a picked theme too', () => {
        settings.write({ theme: 'gold' }, home);
        expect(settings.launcherColors(home)).toMatchObject({ bg: '#0c0a08', accent: '#ffb13b' });
    });

    test('launcher colours match the palettes in styles.css', () => {
        const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
        const block = (selector) => {
            const start = css.indexOf(`${selector} {`);
            expect(start).toBeGreaterThan(-1);
            return css.slice(start, css.indexOf('}', start));
        };
        const gold = block(':root');
        const vars = { gold, slate: gold + block(':root[data-theme="slate"]'), classic: gold + block(':root[data-theme="classic"]') };
        const names = { bg: '--bg', surface: '--surface', text: '--text', textStrong: '--text-strong', accent: '--gold', onAccent: '--on-gold', line: '--line' };
        for (const theme of settings.THEMES) {
            settings.write({ theme }, home);
            const colors = settings.launcherColors(home);
            for (const [key, name] of Object.entries(names)) {
                // a later declaration wins, like the cascade
                const found = [...vars[theme].matchAll(new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6});`, 'gm'))].pop();
                expect([theme, key, found?.[1]]).toEqual([theme, key, colors[key]]);
            }
        }
    });

    test('keeps a full custom selection', () => {
        const pick = selection('midnight', { name: 'Midnight', base: 'slate', colors: { accent: '#123456' },
            style: { corners: 6 }, background: { image: 'bg.png', strength: 20 } });
        settings.write(pick, home);
        expect(settings.read(home)).toEqual(pick);
    });

    test('drops a custom selection with a bad id or missing colours', () => {
        const pick = selection('midnight', { name: 'Midnight', base: 'slate' });
        expect(settings.clean({ ...pick, id: '../x' })).toEqual({});
        const { accent, ...fewer } = pick.custom.colors;
        expect(settings.clean({ ...pick, custom: { ...pick.custom, colors: fewer } })).toEqual({});
        expect(settings.clean({ ...pick, custom: { ...pick.custom, colors: { ...pick.custom.colors, accent: 'red' } } })).toEqual({});
        expect(settings.clean({ ...pick, custom: { ...pick.custom, base: 'pink' } })).toEqual({});
    });

    test('custom then gold leaves exactly {theme:"gold"}', () => {
        settings.write(selection('midnight', { name: 'Midnight', base: 'slate' }), home);
        settings.write({ theme: 'gold' }, home);
        expect(JSON.parse(fs.readFileSync(settings.settingsFile(home), 'utf8'))).toEqual({ theme: 'gold' });
    });

    test('launcher colours of a custom pick are its own launcher colours', () => {
        const pick = selection('midnight', { name: 'Midnight', base: 'slate', colors: { accent: '#123456' } });
        settings.write(pick, home);
        const l = pick.custom.launcher;
        expect(settings.launcherColors(home)).toEqual({ bg: l.bg, surface: l.surface, text: l.text, textStrong: l['text-strong'], accent: '#123456', onAccent: l['on-gold'], line: l.line, red: l.red });
    });

    test('registers read and write handlers', async () => {
        const handlers = {};
        settings.register({ removeHandler: jest.fn(), handle: (name, fn) => (handlers[name] = fn) });
        expect(Object.keys(handlers).sort()).toEqual(['theme:read', 'theme:write']);
    });
});
