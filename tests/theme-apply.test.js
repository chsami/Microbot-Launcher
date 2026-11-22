const ThemeApply = require('../libs/theme-apply');
const CustomTheme = require('../libs/custom-theme');

const fakeRoot = () => {
    const vars = {};
    return {
        vars,
        dataset: {},
        style: {
            setProperty: (k, v) => (vars[k] = v),
            removeProperty: (k) => delete vars[k],
        },
    };
};
const custom = (extra = {}) => CustomTheme.selection('midnight', { name: 'Midnight', base: 'slate', colors: { accent: '#3399ff' }, ...extra });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const png = () => Promise.resolve({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type: 'image/png' });

let blobs;
beforeEach(() => {
    blobs = 0;
    jest.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:file:///b' + ++blobs);
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
    ThemeApply.clear(fakeRoot()); // forget the cached image between tests
    jest.restoreAllMocks();
});

describe('theme apply', () => {
    test('the Themes window keeps the Gold colours', () => {
        const css = require('fs').readFileSync(require('path').join(__dirname, '../css/styles.css'), 'utf8');
        const block = (selector) => {
            const body = css.match(new RegExp('^' + selector.replace(/[.:[\]"]/g, '\\$&') + ' \\{([^}]*)\\}', 'm'))[1];
            return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
        };
        // only while an unreadable custom theme is painted (an editor or import preview): built-in users and readable
        // custom themes colour the Themes window. The dialogs take the base built-in's look: all 19 colours plus the
        // variables the built-in derives.
        expect(css).not.toMatch(/^\.theme-safe/m);
        const EXTRA = ['primary', 'primary-hover', 'on-primary', 'titlebar-icon', 'select-arrow', 'tint', 'ink', 'ink-strong'];
        const builtIn = { gold: ':root', slate: ':root[data-theme="slate"]', classic: ':root[data-theme="classic"]' };
        for (const base of CustomTheme.BUILT_IN) {
            const safe = block(`:root[data-custom="on"][data-unreadable="on"][data-theme="${base}"] .theme-safe`);
            const own = block(builtIn[base]);
            expect(Object.keys(safe).sort()).toEqual([...CustomTheme.LAUNCHER_VARS, ...EXTRA].sort());
            for (const v of CustomTheme.LAUNCHER_VARS) expect([base, v, safe[v]]).toEqual([base, v, CustomTheme.BASES[base].launcher[v]]);
            for (const v of EXTRA) expect([base, v, safe[v]]).toEqual([base, v, own[v]]);
        }
        // no base named: Gold
        expect(css.replace(/\r\n/g, '\n')).toContain(':root[data-custom="on"][data-unreadable="on"]:not([data-theme]) .theme-safe,\n:root[data-custom="on"][data-unreadable="on"][data-theme="gold"] .theme-safe {');
        // every .theme-safe rule is scoped to unreadable custom themes
        for (const line of css.split(/\r?\n/).filter((l) => l.includes('.theme-safe') && !l.trim().startsWith('/*'))) expect(line).toMatch(/^:root\[data-custom="on"\]\[data-unreadable="on"\]/);
    });

    test('a custom Gold base takes its title-bar icons and washes from its own text, like Slate and Classic', () => {
        const css = require('fs').readFileSync(require('path').join(__dirname, '../css/styles.css'), 'utf8').replace(/\r\n/g, '\n');
        expect(css).toContain(':root[data-custom="on"][data-theme="gold"] {\n    --titlebar-icon: var(--text-strong);\n    --ink: var(--text);\n    --ink-strong: var(--text-strong);\n}');
    });

    test('custom sets exactly the 19 vars, the select arrow and base', async () => {
        const root = fakeRoot();
        const sel = custom();
        await ThemeApply.paint(sel, root, jest.fn());
        expect(Object.keys(root.vars).sort()).toEqual([...CustomTheme.LAUNCHER_VARS.map((v) => '--' + v), '--select-arrow'].sort());
        // the same chevron as styles.css, stroked in the theme's accent
        expect(root.vars['--select-arrow']).toBe(`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%233399ff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`);
        expect(root.vars['--gold']).toBe('#3399ff');
        expect(root.vars['--surface']).toBe(sel.custom.launcher.surface);
        expect(root.dataset).toEqual({ theme: 'slate', custom: 'on' });
    });

    test('the custom mark is set by custom paints and removed by built-in paints and clear', async () => {
        const root = fakeRoot();
        await ThemeApply.paint(custom(), root, jest.fn());
        expect(root.dataset.custom).toBe('on');
        await ThemeApply.paint({ theme: 'gold' }, root, jest.fn());
        expect(root.dataset).toEqual({ theme: 'gold' });
        await ThemeApply.paint(custom(), root, jest.fn());
        ThemeApply.clear(root);
        expect(root.dataset.custom).toBeUndefined();
        expect(root.vars).toEqual({});
    });

    test('an unreadable custom theme is marked so the dialogs keep the base colours', async () => {
        const root = fakeRoot();
        const grey = CustomTheme.selection('grey', { name: 'Grey', base: 'slate', colors: { background: '#777777', panel: '#777777', text: '#888888' } });
        await ThemeApply.paint(grey, root, jest.fn());
        expect(root.dataset).toEqual({ theme: 'slate', custom: 'on', unreadable: 'on' });
        await ThemeApply.paint(custom(), root, jest.fn());
        expect(root.dataset).toEqual({ theme: 'slate', custom: 'on' });
        await ThemeApply.paint(grey, root, jest.fn());
        await ThemeApply.paint({ theme: 'gold' }, root, jest.fn());
        expect(root.dataset).toEqual({ theme: 'gold' });
        await ThemeApply.paint(grey, root, jest.fn());
        ThemeApply.clear(root);
        expect(root.dataset.unreadable).toBeUndefined();
    });

    test('built-in after custom removes every inline var and the image', async () => {
        const root = fakeRoot();
        await ThemeApply.paint(custom({ background: { image: 'sky.png', strength: 40 } }), root, png);
        expect(root.dataset.themeImage).toBe('on');
        await ThemeApply.paint({ theme: 'classic' }, root, png);
        expect(root.vars).toEqual({});
        expect(root.dataset).toEqual({ theme: 'classic' });
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file:///b1');
    });

    test('image is only requested by name and shown as a blob url', async () => {
        const root = fakeRoot();
        const images = jest.fn(png);
        await ThemeApply.paint(custom({ background: { image: 'sky.png', strength: 40 } }), root, images);
        expect(images.mock.calls).toEqual([['sky.png']]);
        expect(URL.createObjectURL.mock.calls[0][0].type).toBe('image/png');
        expect(root.vars['--theme-image']).toBe('url("blob:file:///b1")');
        expect(root.vars['--theme-image-strength']).toBe('0.4');
        expect(root.dataset.themeImage).toBe('on');
        // new colours or strength reuse the loaded image
        await ThemeApply.paint(custom({ colors: { accent: '#ff0000' }, background: { image: 'sky.png', strength: 10 } }), root, images);
        expect(images).toHaveBeenCalledTimes(1);
        expect(root.vars['--theme-image-strength']).toBe('0.1');
    });

    test('image theme then no-image custom theme clears the image', async () => {
        const root = fakeRoot();
        await ThemeApply.paint(custom({ background: { image: 'sky.png', strength: 40 } }), root, png);
        await ThemeApply.paint(custom(), root, png);
        expect(root.vars['--theme-image']).toBeUndefined();
        expect(root.vars['--theme-image-strength']).toBeUndefined();
        expect(root.dataset.themeImage).toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file:///b1');
    });

    test('a late image reply does not paint over a newer pick', async () => {
        const root = fakeRoot();
        let reply;
        const painted = ThemeApply.paint(custom({ background: { image: 'sky.png', strength: 40 } }), root, () => new Promise((r) => (reply = r)));
        ThemeApply.paint({ theme: 'gold' }, root, png);
        await flush();
        reply({ bytes: new Uint8Array([1]), type: 'image/png' });
        await painted;
        await flush();
        expect(root.vars).toEqual({});
        expect(root.dataset).toEqual({ theme: 'gold' });
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file:///b1'); // the dropped image is not leaked
    });

    test('a paint that changes the colours tells the page so the dashboard scrollbar restyles', async () => {
        const events = [];
        const root = fakeRoot();
        global.window = { dispatchEvent: (e) => events.push(e.type) };
        try {
            await ThemeApply.paint({ theme: 'slate' }, root, png);
            await ThemeApply.paint({ theme: 'slate' }, root, png); // a focus repaint with nothing new
            await ThemeApply.paint(custom(), root, png);
            await ThemeApply.paint(custom(), root, png);
        } finally {
            delete global.window;
        }
        expect(events).toEqual(['theme-changed', 'theme-changed']);
    });

    test('the image library\'s reason is passed on', async () => {
        const message = await ThemeApply.paint(custom({ background: { image: 'big.png', strength: 40 } }), fakeRoot(), async () => ({ error: 'That image is bigger than 5 MB.' }));
        expect(message).toBe('Could not show big.png: That image is bigger than 5 MB.');
    });

    test('an image that cannot be decoded is reported and not shown', async () => {
        const root = fakeRoot();
        global.Image = class { decode() { return Promise.reject(new Error('EncodingError')); } };
        let message;
        try {
            message = await ThemeApply.paint(custom({ background: { image: 'cut.png', strength: 40 } }), root, png);
        } finally {
            delete global.Image;
        }
        expect(message).toBe('Could not show cut.png: That image is damaged or not a picture the launcher can show.');
        expect(root.dataset.themeImage).toBeUndefined();
        expect(root.vars['--theme-image']).toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file:///b1');
    });

    test('forget makes the next paint read the image again', async () => {
        const root = fakeRoot();
        const images = jest.fn(png);
        const sel = custom({ background: { image: 'sky.png', strength: 40 } });
        await ThemeApply.paint(sel, root, images);
        await ThemeApply.paint(sel, root, images);
        expect(images).toHaveBeenCalledTimes(1);
        ThemeApply.forget();
        await ThemeApply.paint(sel, root, images);
        expect(images).toHaveBeenCalledTimes(2);
        expect(root.vars['--theme-image']).toBe('url("blob:file:///b2")');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file:///b1');
    });

    test('a missing image paints the colours and says so', async () => {
        const root = fakeRoot();
        const message = await ThemeApply.paint(custom({ background: { image: 'gone.png', strength: 40 } }), root, async () => ({ error: 'That image is not in the themes folder.' }));
        expect(message).toBe('Could not show gone.png: That image is not in the themes folder.');
        expect(root.vars['--gold']).toBe('#3399ff');
        expect(root.dataset.themeImage).toBeUndefined();
    });
});
