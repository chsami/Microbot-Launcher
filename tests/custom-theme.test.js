const fs = require('fs');
const path = require('path');
const T = require('../libs/custom-theme');

const theme = (extra) => T.clean({ name: 'Test', ...extra }).theme;
const basics = (b) => ({
    accent: T.BASES[b].client.accent,
    background: T.BASES[b].client.dark,
    panel: T.BASES[b].client.darker,
    text: T.BASES[b].client.text,
});

test('BASES.launcher matches styles.css', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
    const block = (selector) => {
        const body = css.match(new RegExp(selector + '\\s*\\{([^}]*)\\}'))[1];
        return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    };
    const root = block(':root');
    const css3 = {
        gold: root,
        slate: { ...root, ...block(':root\\[data-theme="slate"\\]') },
        classic: { ...root, ...block(':root\\[data-theme="classic"\\]') },
    };
    for (const b of T.BUILT_IN) {
        for (const v of T.LAUNCHER_VARS) expect([b, v, css3[b][v]]).toEqual([b, v, T.BASES[b].launcher[v]]);
    }
    expect(T.LAUNCHER_VARS).toHaveLength(19);
    expect(T.CLIENT_KEYS).toHaveLength(11);
});

test('cleans hostile values field by field', () => {
    const { theme: t } = T.clean({
        name: 'X',
        colors: { accent: 'red;}body{x', text: '#ABCDEF' },
        client: { nope: '#000000', dark: '#00000' },
        launcher: { gold: '#ffffff', evil: '#000000' },
        style: { corners: '6', scrollbarWidth: 99 },
        background: { image: '../../x.png', strength: 5 },
    });
    expect(t.colors).toEqual({ text: '#abcdef' });
    expect(t.client).toEqual({});
    expect(t.launcher).toEqual({ gold: '#ffffff' });
    expect(t.style).toEqual({ scrollbarWidth: 17 });
    expect(T.cleanStyle({ scrollbarWidth: 1 })).toEqual({ scrollbarWidth: 4 });
    expect(t.background).toBeNull();
    expect(t.format).toBe(1);
});

test('rejects non-objects and nameless themes', () => {
    for (const raw of [null, [], {}, { name: '   ' }, 'x']) expect(T.clean(raw).error).toEqual(expect.any(String));
    expect(T.clean({ name: 'x'.repeat(50000) }).theme.name).toHaveLength(40);
    expect(T.clean({ name: ' a\x00b\nc ' }).theme.name).toBe('abc');
    const bidi = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((c) => String.fromCharCode(c)).join('');
    expect(T.clean({ name: 'a' + bidi + 'b' }).theme.name).toBe('ab');
    expect(T.clean({ name: 'n', colors: { constructor: '#000000' }, client: { toString: '#000000' } }).theme.colors).toEqual({});
});

test('background images must be plain allowed file names', () => {
    expect(T.cleanBackground({ image: 'midnight.png', strength: 99 })).toEqual({ image: 'midnight.png', strength: 60 });
    expect(T.cleanBackground({ image: 'a.webp' })).toEqual({ image: 'a.webp', strength: 30 });
    for (const image of ['con.png', 'COM1.jpg', 'a/b.png', 'a\\b.png', 'x.gif', 'x.png.exe']) expect(T.cleanBackground({ image })).toBeNull();
});

test('unknown base falls back to classic', () => {
    expect(theme({ base: 'neon' }).base).toBe('classic');
    expect(theme({ base: 'constructor' }).base).toBe('classic');
    expect(theme({ base: 'slate' }).base).toBe('slate');
});

test('every base fed its own basics resolves to exactly itself', () => {
    for (const b of T.BUILT_IN) {
        const r = T.resolve(theme({ base: b, colors: basics(b) }));
        expect(r.client).toEqual(T.BASES[b].client);
        expect(r.launcher).toEqual(T.BASES[b].launcher);
    }
});

test('gold with background moved by 1 keeps every launcher and client key within 2 of the base', () => {
    const nudge = (c) => '#' + c.slice(1).match(/../g).map((h) => Math.min(255, parseInt(h, 16) + 1).toString(16).padStart(2, '0')).join('');
    const channels = (c) => c.slice(1).match(/../g).map((h) => parseInt(h, 16));
    for (const b of ['gold', 'slate']) {
        for (const key of ['background', 'text', 'panel', 'accent']) {
            const r = T.resolve(theme({ base: b, colors: { [key]: nudge(basics(b)[key]) } }));
            for (const side of ['client', 'launcher']) {
                for (const [k, v] of Object.entries(r[side])) {
                    const drift = Math.max(...channels(v).map((x, i) => Math.abs(x - channels(T.BASES[b][side][k])[i])));
                    expect([b, key, side, k, drift <= 2]).toEqual([b, key, side, k, true]);
                }
            }
        }
    }
});

test('only colours depending on a changed basic move', () => {
    const r = T.resolve(theme({ base: 'gold', colors: { accent: '#7aa2f7' } }));
    const moved = { client: ['accent'], launcher: ['gold', 'gold-hover', 'gold-soft'] };
    for (const side of ['client', 'launcher']) {
        for (const [k, v] of Object.entries(r[side])) {
            if (moved[side].includes(k)) expect([k, v]).not.toEqual([k, T.BASES.gold[side][k]]);
            else expect([k, v]).toEqual([k, T.BASES.gold[side][k]]);
        }
    }
    expect(r.client.accent).toBe('#7aa2f7');
});

test('background and panel move the launcher surface with the same role as the client colour', () => {
    for (const b of T.BUILT_IN) {
        const base = T.BASES[b];
        const roles = ['surface', 'surface-2'];
        const same = roles.find((k) => base.launcher[k] === base.client.dark); // the launcher surface playing client dark's role
        const other = roles.find((k) => k !== same);
        expect([b, same, base.launcher[other]]).toEqual([b, same, base.client.darker]);
        const r = T.resolve(theme({ base: b, colors: { background: '#302010' } }));
        expect([b, r.client.dark, r.launcher[same], r.launcher[other]]).toEqual([b, '#302010', '#302010', base.launcher[other]]);
        const p = T.resolve(theme({ base: b, colors: { panel: '#302010' } }));
        expect([b, p.client.darker, p.launcher[other], p.launcher[same]]).toEqual([b, '#302010', '#302010', base.launcher[same]]);
    }
});

test('on gold and slate, text sets launcher headings like client text', () => {
    for (const b of ['gold', 'slate']) {
        const r = T.resolve(theme({ base: b, colors: { text: '#e0e0e0' } }));
        const step = (k) => parseInt(r.launcher[k].slice(1, 3), 16) - parseInt(T.BASES[b].launcher[k].slice(1, 3), 16);
        const clientStep = 0xe0 - parseInt(T.BASES[b].client.text.slice(1, 3), 16);
        expect([b, step('text-strong')]).toEqual([b, clientStep]); // direct key, delta rule
        expect([b, Math.sign(step('text'))]).toEqual([b, Math.sign(clientStep)]); // body text follows
    }
});

test('explicit client and launcher entries win', () => {
    const r = T.resolve(theme({ base: 'slate', colors: { accent: '#7aa2f7' }, client: { accent: '#010203' }, launcher: { red: '#040506' } }));
    expect(r.client.accent).toBe('#010203');
    expect(r.launcher.red).toBe('#040506');
    expect(r.launcher.gold).toBe('#7aa2f7');
});

test('a white background keeps headings and button text readable', () => {
    const r = T.resolve(theme({ base: 'gold', colors: { background: '#ffffff', panel: '#f2f2f2', text: '#1a1a1a' } }));
    expect(T.contrast(r.launcher['text-strong'], r.launcher['surface-2'])).toBeGreaterThanOrEqual(4.5);
    expect(T.contrast(r.launcher['on-gold'], r.launcher.gold)).toBeGreaterThanOrEqual(4.5);
    const dim = T.resolve(theme({ base: 'gold', colors: { accent: '#202020' } }));
    expect(T.contrast(dim.launcher['on-gold'], dim.launcher.gold)).toBeGreaterThanOrEqual(4.5);
});

test('contrast matches WCAG', () => {
    expect(T.contrast('#000000', '#ffffff')).toBe(21);
    expect(T.contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
});

test('built-in palettes raise no warnings; white-on-white raises the text one', () => {
    for (const b of T.BUILT_IN) expect(T.warnings(T.resolve(theme({ base: b })))).toEqual([]);
    const w = T.warnings(T.resolve(theme({ base: 'gold', colors: { text: '#ffffff', background: '#ffffff' } })));
    expect(w).toContain('Text is hard to read on the background (1.0:1, aim for 4.5:1).');
});

test('readable also needs launcher text to stand out from the page, sidebar and cards', () => {
    for (const launcher of [{ text: '#1b1612' }, { text: '#2a2119' }, { 'text-strong': '#1b1612' }, { bg: '#d6cfc2' }, { surface: '#d6cfc2' }]) {
        expect([launcher, T.readable(T.resolve(theme({ base: 'gold', launcher })))]).toEqual([launcher, false]);
    }
});

test('launcher text and light themes raise their own warnings', () => {
    const w = T.warnings(T.resolve(theme({ base: 'gold', launcher: { text: '#6f685d' } })));
    expect(w).toEqual([
        expect.stringMatching(/^Launcher text is hard to read on the page \(\d\.\d:1, aim for 4\.5:1\)\.$/),
        expect.stringMatching(/^Launcher text is hard to read on cards \(\d\.\d:1, aim for 4\.5:1\)\.$/),
    ]);
    const light = T.warnings(T.resolve(theme({ base: 'gold', colors: { background: '#ffffff', panel: '#f2f2f2', text: '#1a1a1a' } })));
    expect(light).toContain('Light themes can be hard to read in parts of the client, where some panels use white text.');
});

test('readable needs button text to stand out from the accent hover too', () => {
    const t = T.resolve(theme({ base: 'slate', launcher: { 'gold-hover': '#15171c' } }));
    expect(T.readable(t)).toBe(false);
    expect(T.warnings(t)).toContainEqual(expect.stringMatching(/^Button text is hard to read on the accent hover /));
});

test('readable is false for white text on white', () => {
    for (const b of T.BUILT_IN) expect(T.readable(T.resolve(theme({ base: b })))).toBe(true);
    expect(T.readable(T.resolve(theme({ colors: { text: '#ffffff', background: '#ffffff' } })))).toBe(false);
    expect(T.readable(T.resolve(theme({ colors: { text: '#ffffff', panel: '#ffffff' } })))).toBe(false);
});

test('readable needs button text to stand out from the accent, after explicit overrides', () => {
    expect(T.readable(T.resolve(theme({ base: 'slate', launcher: { gold: '#ffffff', 'on-gold': '#ffffff' } })))).toBe(false);
});

test('Gold headings on cards and the Play label on red are checked', () => {
    const heading = T.resolve(theme({ base: 'gold', launcher: { 'text-strong': '#1b1612' } }));
    expect(T.readable(heading)).toBe(false);
    expect(T.warnings(heading)).toContainEqual(expect.stringMatching(/^Launcher headings are hard to read on cards \(\d\.\d:1, aim for 4\.5:1\)\.$/));
    // Gold's Play button is red with heading-coloured text
    const play = T.resolve(theme({ base: 'gold', launcher: { red: '#f5efe4' } }));
    expect(T.readable(play)).toBe(false);
    expect(T.warnings(play)).toContainEqual(expect.stringMatching(/^The Play button text is hard to read on red /));
    // the other bases' Play uses the accent pair
    const slate = T.resolve(theme({ base: 'slate', launcher: { red: T.BASES.slate.launcher['text-strong'] } }));
    expect(T.readable(slate)).toBe(true);
    expect(T.warnings(slate)).toEqual([]);
});

test('slug', () => {
    expect(T.slug('Midnight Blue!')).toBe('midnight-blue');
    expect(T.slug('Gold')).toBe('gold-theme');
    expect(T.slug('LPT1')).toBe('lpt1-theme');
    expect(T.slug('???')).toBe('theme');
    expect(T.slug('a'.repeat(60))).toHaveLength(40);
});

test('uniqueName adds (n) and stays within 40', () => {
    expect(T.uniqueName('Night', [])).toBe('Night');
    expect(T.uniqueName('Night', ['night', 'Night (2)'])).toBe('Night (3)');
    const long = 'x'.repeat(40);
    expect(T.uniqueName(long, [long])).toBe('x'.repeat(36) + ' (2)');
    // a two-digit suffix cuts the name one more, so the result never passes 40
    const taken = [long, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'x'.repeat(36) + ' (' + n + ')')];
    expect(T.uniqueName(long, taken)).toBe('x'.repeat(35) + ' (10)');
});

test('selection carries resolved colours', () => {
    const t = theme({ base: 'slate', style: { corners: 4 }, background: { image: 'm.png', strength: 10 } });
    const s = T.selection('test', t);
    expect(s.theme).toBe('custom');
    expect(s.id).toBe('test');
    expect(s.custom.base).toBe('slate');
    expect(T.selection('x', { ...t, base: 'constructor' }).custom.base).toBe('classic');
    expect(Object.keys(s.custom.colors)).toEqual(T.CLIENT_KEYS);
    expect(Object.keys(s.custom.launcher)).toEqual(T.LAUNCHER_VARS);
    expect(s.custom.style).toEqual({ corners: 4 });
    expect(s.custom.background).toEqual({ image: 'm.png', strength: 10 });
});
