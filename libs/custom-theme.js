// Custom themes, format 1: cleaning a theme file, working out every colour from the four basics,
// contrast warnings. Pure; loaded by the main process (require) and the renderer (window.CustomTheme).
(function () {
    const CLIENT_KEYS = ['accent', 'darker', 'dark', 'medium', 'light', 'text', 'control', 'border', 'darkerHover', 'darkHover', 'scrollTrack'];
    const LAUNCHER_VARS = ['bg', 'surface', 'surface-2', 'surface-3', 'line', 'line-strong', 'line-mid', 'shade', 'text', 'text-strong',
        'muted', 'faint', 'gold', 'gold-hover', 'gold-soft', 'on-gold', 'red', 'red-text', 'green'];
    const BASIC_KEYS = ['accent', 'background', 'panel', 'text'];
    const BUILT_IN = ['gold', 'slate', 'classic'];

    const HEX = /^#[0-9a-f]{6}$/i;
    const IMAGE = /^[\w .-]{1,80}\.(png|jpe?g|webp)$/i;
    const RESERVED = ['gold', 'slate', 'classic', 'custom', 'con', 'prn', 'aux', 'nul',
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => ['com' + n, 'lpt' + n])];

    // client values from ClientTheme.Palette, in CLIENT_KEYS order; launcher values from css/styles.css
    const palette = (hex) => Object.fromEntries(CLIENT_KEYS.map((k, i) => [k, '#' + hex[i].toString(16).padStart(6, '0')]));
    const ROOT = {
        bg: '#0c0a08', surface: '#15110d', 'surface-2': '#1b1612', 'surface-3': '#2a2119', line: '#2e261c', 'line-strong': '#4a3a2a',
        'line-mid': '#3a2e22', shade: '#0a0806', text: '#d6cfc2', 'text-strong': '#f5efe4', muted: '#9b9384', faint: '#6f685d',
        gold: '#ffb13b', 'gold-hover': '#ffc35c', 'gold-soft': '#e9c98f', 'on-gold': '#1a1714', red: '#c2231f', 'red-text': '#ff7a6e', green: '#9fd98a',
    };
    const BASES = {
        gold: {
            client: palette([0xFFB13B, 0x1B1612, 0x15110D, 0x514030, 0x9B9384, 0xE6DFD2, 0x1B1612, 0x2E261C, 0x3F3226, 0x19140F, 0x15110D]),
            launcher: ROOT,
        },
        slate: {
            client: palette([0xF5A524, 0x1C1F26, 0x15171C, 0x41485B, 0x8B93A3, 0xE3E6EC, 0x1C1F26, 0x262A33, 0x343A49, 0x1A1D23, 0x15171C]),
            launcher: {
                ...ROOT, bg: '#15171c', surface: '#15171c', 'surface-2': '#1c1f26', 'surface-3': '#242833', line: '#262a33', 'line-strong': '#2e3340',
                'line-mid': '#2e3340', shade: '#15171c', text: '#c9cdd6', 'text-strong': '#e3e6ec', muted: '#8b93a3', faint: '#626a7a',
                gold: '#f5a524', 'gold-hover': '#f7b445', 'gold-soft': '#f9cd87', 'on-gold': '#15171c',
            },
        },
        classic: {
            client: palette([0xDC8A00, 0x1E1E1E, 0x282828, 0x4D4D4D, 0xA5A5A5, 0xC6C6C6, 0x1E1E1E, 0x171717, 0x3C3C3C, 0x232323, 0x191919]),
            launcher: {
                ...ROOT, bg: '#181818', surface: '#1e1e1e', 'surface-2': '#282828', 'surface-3': '#3c3c3c', line: '#323232', 'line-strong': '#4d4d4d',
                'line-mid': '#4d4d4d', shade: '#181818', text: '#c6c6c6', 'text-strong': '#ebebeb', muted: '#a5a5a5', faint: '#737373',
                gold: '#dc8a00', 'gold-hover': '#f0a01e', 'gold-soft': '#e6be78', 'on-gold': '#141414',
            },
        },
    };

    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const hex = (c) => '#' + c.map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('');
    const mix = (a, b, t) => {
        const x = rgb(a), y = rgb(b);
        return hex(x.map((v, i) => Math.round(v + (y[i] - v) * t)));
    };
    const BLACK = '#000000', WHITE = '#ffffff';

    function luminance(color) {
        const [r, g, b] = rgb(color).map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function contrast(a, b) {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    }

    // [side, key, basics it reads, formula]
    const basic = (name) => (b) => b[name];
    const DERIVED = [
        ['client', 'accent', ['accent'], basic('accent')],
        ['client', 'dark', ['background'], basic('background')],
        ['client', 'darker', ['panel'], basic('panel')],
        ['client', 'control', ['panel'], basic('panel')],
        ['client', 'text', ['text'], basic('text')],
        ['client', 'light', ['panel', 'text'], (b) => mix(b.panel, b.text, 0.8)],
        ['client', 'medium', ['panel', 'text'], (b) => mix(b.panel, b.text, 0.28)],
        ['client', 'border', ['panel'], (b) => mix(b.panel, BLACK, 0.25)],
        ['client', 'darkerHover', ['panel', 'text'], (b) => mix(b.panel, b.text, 0.18)],
        ['client', 'darkHover', ['background'], (b) => mix(b.background, BLACK, 0.12)],
        ['client', 'scrollTrack', ['background'], (b) => mix(b.background, BLACK, 0.375)],
        ['launcher', 'surface-3', ['background', 'text'], (b) => mix(b.background, b.text, 0.13)],
        ['launcher', 'line', ['background', 'text'], (b) => mix(b.background, b.text, 0.06)],
        ['launcher', 'line-mid', ['background', 'text'], (b) => mix(b.background, b.text, 0.23)],
        ['launcher', 'line-strong', ['background', 'text'], (b) => mix(b.background, b.text, 0.23)],
        ['launcher', 'muted', ['background', 'text'], (b) => mix(b.background, b.text, 0.79)],
        ['launcher', 'faint', ['background', 'text'], (b) => mix(b.background, b.text, 0.47)],
        ['launcher', 'gold', ['accent'], basic('accent')],
        ['launcher', 'gold-hover', ['accent'], (b) => mix(b.accent, WHITE, 0.12)],
        ['launcher', 'gold-soft', ['accent'], (b) => mix(b.accent, WHITE, 0.45)],
    ];
    // Which launcher surfaces and text play the client's roles differs by base (see docs/theme-coverage-audit.md 1.5).
    // Classic: client dark = launcher cards, client text = launcher body text.
    const CLASSIC_ROLES = [
        ['launcher', 'surface-2', ['background'], basic('background')],
        ['launcher', 'surface', ['panel'], basic('panel')],
        ['launcher', 'bg', ['panel'], (b) => mix(b.panel, BLACK, 0.2)],
        ['launcher', 'shade', ['panel'], (b) => mix(b.panel, BLACK, 0.2)],
        ['launcher', 'text', ['text'], basic('text')],
        // light themes (text darker than the background) get darker headings, not lighter
        ['launcher', 'text-strong', ['background', 'text'],
            (b) => mix(b.text, luminance(b.text) < luminance(b.background) ? BLACK : WHITE, 0.65)],
    ];
    // Gold and Slate: client dark = launcher sidebar and page, client darker = launcher cards, client text = launcher headings.
    const THEMED_ROLES = [
        ['launcher', 'surface', ['background'], basic('background')],
        ['launcher', 'bg', ['background'], (b) => mix(b.background, BLACK, 0.2)],
        ['launcher', 'shade', ['background'], (b) => mix(b.background, BLACK, 0.2)],
        ['launcher', 'surface-2', ['panel'], basic('panel')],
        ['launcher', 'text-strong', ['text'], basic('text')],
        ['launcher', 'text', ['background', 'text'], (b) => mix(b.text, b.background, 0.13)],
    ];

    const own = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

    function cleanColors(raw, keys) {
        const out = {};
        for (const k of keys) {
            if (own(raw, k) && typeof raw[k] === 'string' && HEX.test(raw[k])) out[k] = raw[k].toLowerCase();
        }
        return out;
    }

    const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
    const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

    function cleanStyle(raw) {
        const out = {};
        if (own(raw, 'corners') && isNumber(raw.corners)) out.corners = clampInt(raw.corners, 0, 12);
        if (own(raw, 'roundScrollbars') && typeof raw.roundScrollbars === 'boolean') out.roundScrollbars = raw.roundScrollbars;
        if (own(raw, 'scrollbarWidth') && isNumber(raw.scrollbarWidth)) out.scrollbarWidth = clampInt(raw.scrollbarWidth, 4, 17);
        return out;
    }

    function cleanBackground(raw) {
        const image = own(raw, 'image') && typeof raw.image === 'string' ? raw.image : '';
        // the charset already rules out / and \, so the name is its own basename
        if (!IMAGE.test(image) || RESERVED.includes(image.split('.')[0].trim().toLowerCase())) return null;
        return { image, strength: own(raw, 'strength') && isNumber(raw.strength) ? clampInt(raw.strength, 0, 60) : 30 };
    }

    const cut = (text, max) => Array.from(text).slice(0, max).join('');

    function cleanName(raw) {
        // control characters and the bidi controls that could reorder the name on screen
        // eslint-disable-next-line no-control-regex
        return typeof raw === 'string' ? cut(raw.replace(/[\x00-\x1f\x7f-\x9f\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu, '').trim(), 40).trim() : '';
    }

    function clean(raw) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'This is not a theme.' };
        const name = cleanName(own(raw, 'name') ? raw.name : '');
        if (!name) return { error: 'A theme needs a name.' };
        return {
            theme: {
                format: 1,
                name,
                base: BUILT_IN.includes(raw.base) ? raw.base : 'classic',
                colors: cleanColors(raw.colors, BASIC_KEYS),
                client: cleanColors(raw.client, CLIENT_KEYS),
                launcher: cleanColors(raw.launcher, LAUNCHER_VARS),
                style: cleanStyle(raw.style),
                background: cleanBackground(raw.background),
            },
        };
    }

    // A derived colour moves only when one of its basics differs from the base's own, and then by the
    // difference its formula makes (delta rule, direct keys included), so a base fed its own basics stays exactly itself
    // and a small change to a basic is a small change everywhere.
    function resolve(theme) {
        const name = BUILT_IN.includes(theme.base) ? theme.base : 'classic';
        const base = BASES[name];
        const was = { accent: base.client.accent, background: base.client.dark, panel: base.client.darker, text: base.client.text };
        const now = { ...was, ...cleanColors(theme.colors, BASIC_KEYS) };
        const out = { client: { ...base.client }, launcher: { ...base.launcher } };
        for (const [side, key, inputs, f] of [...DERIVED, ...(name === 'classic' ? CLASSIC_ROLES : THEMED_ROLES)]) {
            if (!inputs.some((b) => now[b] !== was[b])) continue;
            const [k, a, b] = [rgb(base[side][key]), rgb(f(now)), rgb(f(was))];
            out[side][key] = hex(k.map((v, i) => v + a[i] - b[i]));
        }
        const gold = out.launcher.gold;
        if (contrast(out.launcher['on-gold'], gold) < 4.5) {
            out.launcher['on-gold'] = contrast(BLACK, gold) >= contrast(WHITE, gold) ? BLACK : WHITE;
        }
        Object.assign(out.client, cleanColors(theme.client, CLIENT_KEYS));
        Object.assign(out.launcher, cleanColors(theme.launcher, LAUNCHER_VARS));
        return { base: name, client: out.client, launcher: out.launcher, style: cleanStyle(theme.style), background: theme.background ? cleanBackground(theme.background) : null };
    }

    const ratio = (r) => (Math.floor(r * 10) / 10).toFixed(1);

    function warnings(resolved) {
        const { client: c, launcher: l } = resolved;
        const checks = [
            [c.text, c.dark, 4.5, 'Text is hard to read on the background'],
            [c.text, c.darker, 4.5, 'Text is hard to read on panels'],
            [c.light, c.darker, 4.5, 'Muted text is hard to read on panels'],
            [c.accent, c.dark, 3, 'The accent is hard to see on the background'],
            [l['on-gold'], l.gold, 4.5, 'Button text is hard to read on the accent'],
            [l['on-gold'], l['gold-hover'], 4.5, 'Button text is hard to read on the accent hover'],
            [l.text, l.bg, 4.5, 'Launcher text is hard to read on the page'],
            [l.text, l['surface-2'], 4.5, 'Launcher text is hard to read on cards'],
            [l['text-strong'], l['surface-2'], 4.5, 'Launcher headings are hard to read on cards'],
            ...(resolved.base === 'gold' ? [[l['text-strong'], l.red, 4.5, 'The Play button text is hard to read on red']] : []),
        ];
        const out = checks.filter(([a, b, min]) => contrast(a, b) < min)
            .map(([a, b, min, text]) => text + ' (' + ratio(contrast(a, b)) + ':1, aim for ' + min + ':1).');
        if (luminance(c.dark) > luminance(c.text)) out.push('Light themes can be hard to read in parts of the client, where some panels use white text.');
        return out;
    }

    function readable(resolved) {
        const { client: c, launcher: l } = resolved;
        return contrast(c.text, c.dark) >= 3 && contrast(c.text, c.darker) >= 3
            && [l.bg, l.surface, l['surface-2']].every((bg) => contrast(l.text, bg) >= 3) && contrast(l['text-strong'], l['surface-2']) >= 3
            && contrast(l['on-gold'], l.gold) >= 3 && contrast(l['on-gold'], l['gold-hover']) >= 3
            // Gold's Play button is red with heading-coloured text; the other bases' uses the accent pair
            && (resolved.base !== 'gold' || contrast(l['text-strong'], l.red) >= 3);
    }

    function slug(name) {
        const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
        if (!s) return 'theme';
        return RESERVED.includes(s) ? s + '-theme' : s;
    }

    // "Name (n)" for the first n from 2 not taken (case-insensitive); the name is cut so the whole result fits in 40
    function uniqueName(name, takenNames) {
        const taken = new Set(takenNames.map((n) => n.toLowerCase()));
        if (!taken.has(name.toLowerCase())) return name;
        const candidate = (n) => cut(name, 40 - (' (' + n + ')').length).trim() + ' (' + n + ')';
        let n = 2;
        while (taken.has(candidate(n).toLowerCase())) n++;
        return candidate(n);
    }

    function selection(id, theme) {
        const r = resolve(theme);
        return { theme: 'custom', id, custom: { base: BUILT_IN.includes(theme.base) ? theme.base : 'classic', colors: r.client, style: r.style, launcher: r.launcher, background: r.background } };
    }

    const api = {
        CLIENT_KEYS, LAUNCHER_VARS, BASIC_KEYS, BUILT_IN, BASES,
        clean, cleanStyle, cleanBackground, resolve, contrast, warnings, readable, slug, uniqueName, selection,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.CustomTheme = api;
})();
