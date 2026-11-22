// The theme editor (libs/theme-editor.js) against a hand-rolled DOM: just the calls the editor makes.
const CustomTheme = require('../libs/custom-theme');

describe('formToTheme', () => {
    const { formToTheme } = require('../libs/theme-editor');
    const form = (extra) => ({
        name: 'Mine', base: 'slate', changed: [],
        colors: { accent: '#111111', background: '#222222', panel: '#333333', text: '#eeeeee' },
        client: Object.fromEntries(CustomTheme.CLIENT_KEYS.map((k) => [k, '#444444'])),
        launcher: Object.fromEntries(CustomTheme.LAUNCHER_VARS.map((k) => [k, '#555555'])),
        corners: 0, roundScrollbars: false, scrollbarWidth: 10, image: '', strength: 30,
        ...extra,
    });

    test('untouched advanced colours are left out', () => {
        const theme = formToTheme(form({ changed: ['colors.text', 'client.darkHover', 'launcher.surface-2'] }));
        expect(theme.colors).toEqual({ text: '#eeeeee' });
        expect(theme.client).toEqual({ darkHover: '#444444' });
        expect(theme.launcher).toEqual({ 'surface-2': '#555555' });
        expect(theme.style).toEqual({});
    });

    test('corner rounding Off leaves style.corners unset', () => {
        expect(formToTheme(form({ corners: 0 })).style).toEqual({});
        expect(formToTheme(form({ corners: 6, changed: ['style.scrollbarWidth'] })).style).toEqual({ corners: 6, scrollbarWidth: 10 });
    });

    test('background None leaves background unset', () => {
        expect(formToTheme(form({ image: '' })).background).toBeNull();
        expect(formToTheme(form({ image: 'sky.png', strength: 20 })).background).toEqual({ image: 'sky.png', strength: 20 });
    });
});

describe('theme editor', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const midnight = CustomTheme.clean({ name: 'Midnight', base: 'slate', colors: { accent: '#3399ff' } }).theme;
    const picked = CustomTheme.selection('midnight', midnight);

    function load({ saveReply = (theme, id) => ({ id: id || 'new', theme }), current = picked, discard = true } = {}) {
        const make = (tag) => {
            const classes = new Set();
            const props = {};
            return {
                tag, value: '', checked: false, children: [], listeners: {}, dataset: {}, attributes: {}, textContent: '',
                classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
                style: { setProperty: (k, v) => (props[k] = v), removeProperty: (k) => delete props[k] },
                props,
                append(...kids) { this.children.push(...kids); },
                replaceChildren(...kids) { this.children = kids; },
                setAttribute(k, v) { this.attributes[k] = v; },
                addEventListener(type, fn) { this.listeners[type] = fn; },
                querySelectorAll: () => [],
                focus() {},
                set innerHTML(v) { throw new Error('innerHTML used: ' + v); },
            };
        };
        const els = {};
        const document = {
            documentElement: make('html'),
            getElementById: (id) => (els[id] ||= Object.assign(make('div'), { id })),
            createElement: make,
            activeElement: null,
        };
        document.getElementById('theme-editor').classList.add('auth-hidden');
        document.getElementById('theme-editor-width').value = '10';
        document.getElementById('theme-editor-strength').value = '30';
        document.getElementById('theme-editor-corners').value = '0';
        const saves = [];
        const pickerSaves = [];
        const refreshes = [];
        const confirms = [];
        const window = {
            electron: {
                showConfirmationDialog: (...args) => (confirms.push(args), Promise.resolve(discard)),
                themes: {
                    save: (theme, id) => (saves.push([theme, id]), Promise.resolve(saveReply(theme, id))),
                    images: () => Promise.resolve(['sky.png']),
                    image: () => Promise.resolve({ error: 'not here' }),
                },
            },
            ThemePicker: {
                current: () => current,
                save: (selection) => (pickerSaves.push(selection), Promise.resolve()),
                refresh: () => (refreshes.push(1), Promise.resolve()),
            },
        };
        global.window = window;
        global.document = document;
        jest.isolateModules(() => {
            require('../libs/custom-theme.js');
            require('../libs/theme-apply.js');
            require('../libs/theme-editor.js');
        });
        const $ = document.getElementById;
        const dialog = $('theme-editor');
        // every node under an element, depth first
        const nodes = (el) => [el, ...(el.children || []).flatMap(nodes)];
        const all = () => nodes($('theme-editor')).concat(nodes($('theme-editor-basics')), nodes($('theme-editor-client-colours')), nodes($('theme-editor-launcher-colours')));
        const colour = (key) => all().find((n) => n.dataset.key === key);
        const hex = (key) => all().find((n) => n.dataset.hex === key);
        const byId = (id) => all().find((n) => n.id === id);
        const base = (name) => {
            for (const b of CustomTheme.BUILT_IN) $('theme-editor-base-' + b).checked = b === name;
            dialog.listeners.input({ target: $('theme-editor-base-' + name) });
        };
        const checkedBase = () => CustomTheme.BUILT_IN.find((b) => $('theme-editor-base-' + b).checked);
        const type = (el, value) => {
            el.value = value;
            dialog.listeners.input({ target: el });
        };
        const click = (id) => $(id).listeners.click();
        return { window, $, dialog, vars: document.documentElement.props, root: document.documentElement, saves, pickerSaves, refreshes, confirms, colour, hex, byId, base, checkedBase, type, click };
    }

    afterEach(() => {
        delete global.window;
        delete global.document;
    });

    test('cancel repaints the picked theme', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        expect(e.dialog.classList.contains('auth-hidden')).toBe(false);
        expect(e.vars['--gold']).toBe('#3399ff'); // the theme being edited is previewed
        e.type(e.colour('colors.accent'), '#00ff00');
        expect(e.vars['--gold']).toBe('#00ff00');
        expect(e.$('theme-editor-client').props['--c-accent']).toBe('#00ff00');
        e.click('theme-editor-cancel');
        await flush();
        expect(e.dialog.classList.contains('auth-hidden')).toBe(true);
        expect(e.vars['--gold']).toBe('#3399ff');
        expect(e.saves).toEqual([]);
    });

    test('opening one theme then another quickly shows and saves the second', async () => {
        const e = load();
        const sky = CustomTheme.clean({ name: 'Sky', base: 'slate', background: { image: 'a.png', strength: 50 } }).theme;
        const dawn = CustomTheme.clean({ name: 'Dawn', base: 'gold', colors: { accent: '#ff0000' } }).theme;
        const replies = [];
        e.window.electron.themes.images = () => new Promise((resolve) => replies.push(resolve));
        const first = e.window.ThemeEditor.open('sky', sky);
        const second = e.window.ThemeEditor.open('dawn', dawn);
        replies[1](['b.png']);
        await second;
        replies[0](['a.png']); // the older reply lands last
        await first;
        expect(e.$('theme-editor-name').value).toBe('Dawn');
        expect(e.$('theme-editor-image').children.map((o) => o.value)).toEqual(['', 'b.png']);
        expect(e.vars['--gold']).toBe('#ff0000');
        e.click('theme-editor-save');
        await flush();
        await flush();
        expect(e.saves).toHaveLength(1);
        expect(e.saves[0][1]).toBe('dawn');
        expect(e.saves[0][0]).toMatchObject({ name: 'Dawn', base: 'gold', background: null });
    });

    test('Tab wraps at the last enabled control: Cancel while Save is disabled', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        const [close, cancel, save] = ['theme-editor-close', 'theme-editor-cancel', 'theme-editor-save'].map(e.$);
        const focused = [];
        for (const [name, n] of [['close', close], ['cancel', cancel], ['save', save]]) n.focus = () => focused.push(name);
        e.dialog.querySelectorAll = () => [close, e.$('theme-editor-name'), cancel, save];
        e.type(e.hex('colors.accent'), '#123');
        expect(save.disabled).toBe(true);
        const tab = (from, shiftKey) => {
            global.document.activeElement = from;
            e.dialog.listeners.keydown({ key: 'Tab', shiftKey, preventDefault() {} });
        };
        tab(cancel, false);
        tab(close, true);
        expect(focused).toEqual(['close', 'cancel']);
    });

    test('Save stays disabled while a save is in flight', async () => {
        let reply;
        const e = load({ saveReply: (theme) => new Promise((resolve) => (reply = () => resolve({ id: 'dawn', theme }))) });
        await e.window.ThemeEditor.open();
        e.type(e.$('theme-editor-name'), 'Dawn');
        e.click('theme-editor-save');
        await flush();
        e.type(e.colour('colors.accent'), '#00ff00');
        expect(e.$('theme-editor-save').disabled).toBe(true);
        await e.click('theme-editor-save');
        expect(e.saves).toHaveLength(1);
        reply();
        await flush();
        await flush();
        expect(e.pickerSaves).toHaveLength(1);
    });

    test('an older save reply does not close a newer draft, and picks by its own id', async () => {
        let reply;
        const e = load({ current: { theme: 'gold' }, saveReply: (theme) => new Promise((resolve) => (reply = () => resolve({ id: 'dawn', theme }))) });
        await e.window.ThemeEditor.open();
        e.type(e.$('theme-editor-name'), 'Dawn');
        e.click('theme-editor-save');
        await flush();
        e.click('theme-editor-cancel'); // discard
        await flush();
        expect(e.dialog.classList.contains('auth-hidden')).toBe(true);
        await e.window.ThemeEditor.open('sky', { ...midnight, name: 'Sky' });
        reply();
        await flush();
        await flush();
        await flush();
        expect(e.dialog.classList.contains('auth-hidden')).toBe(false);
        expect(e.$('theme-editor-name').value).toBe('Sky');
        expect(e.pickerSaves).toEqual([CustomTheme.selection('dawn', e.saves[0][0])]); // the new Dawn is still picked
        expect(e.$('theme-editor-save').disabled).toBe(false);
    });

    test('Escape cancels', async () => {
        const e = load();
        await e.window.ThemeEditor.open();
        e.dialog.listeners.keydown({ key: 'Escape' });
        expect(e.dialog.classList.contains('auth-hidden')).toBe(true);
    });

    test('save of the picked theme rewrites the selection', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        e.type(e.colour('colors.accent'), '#00FF00');
        e.click('theme-editor-save');
        await flush();
        await flush();
        expect(e.saves).toHaveLength(1);
        const [theme, id] = e.saves[0];
        expect(id).toBe('midnight');
        expect(theme).toMatchObject({ name: 'Midnight', base: 'slate', colors: { accent: '#00ff00' }, client: {}, launcher: {}, style: {}, background: null });
        expect(e.pickerSaves).toEqual([CustomTheme.selection('midnight', theme)]);
        expect(e.refreshes).toHaveLength(1);
        expect(e.dialog.classList.contains('auth-hidden')).toBe(true);
    });

    test('saving a new theme picks it', async () => {
        const e = load();
        await e.window.ThemeEditor.open();
        e.type(e.$('theme-editor-name'), 'Dawn');
        e.click('theme-editor-save');
        await flush();
        await flush();
        expect(e.saves).toEqual([[expect.objectContaining({ name: 'Dawn', base: 'slate' }), undefined]]); // the picked Midnight's base
        expect(e.pickerSaves).toEqual([CustomTheme.selection('new', e.saves[0][0])]);
        expect(e.refreshes).toHaveLength(1);
    });

    test('saving an edit of a theme that is not picked leaves the selection alone', async () => {
        const e = load();
        await e.window.ThemeEditor.open('dawn', { ...midnight, name: 'Dawn' });
        e.click('theme-editor-save');
        await flush();
        await flush();
        expect(e.saves).toEqual([[expect.objectContaining({ name: 'Dawn' }), 'dawn']]);
        expect(e.pickerSaves).toEqual([]);
        expect(e.refreshes).toHaveLength(1);
    });

    test('a new theme starts from the picked theme: a built-in, a custom one\'s base, or Gold', async () => {
        for (const [current, base] of [[{ theme: 'classic' }, 'classic'], [picked, 'slate'], [{}, 'gold']]) {
            const e = load({ current });
            await e.window.ThemeEditor.open();
            expect([current, e.checkedBase()]).toEqual([current, base]);
        }
    });

    test('Save is the primary button, Cancel and Reset stay secondary', () => {
        const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
        expect(html).toContain('<button id="theme-editor-save" class="theme-button theme-button-primary" type="button">Save</button>');
        expect(html).toContain('<button id="theme-editor-cancel" class="theme-button" type="button">Cancel</button>');
    });

    test('the scrollbar width slider stops at 17', () => {
        const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
        expect(html).toMatch(/id="theme-editor-width" type="range" min="4" max="17"/);
    });

    test('a save error is shown and the editor stays open', async () => {
        const e = load({ saveReply: () => ({ error: 'The disk is full.' }) });
        await e.window.ThemeEditor.open('midnight', midnight);
        e.click('theme-editor-save');
        await flush();
        await flush();
        expect(e.$('theme-editor-error').textContent).toMatch('The disk is full.');
        expect(e.dialog.classList.contains('auth-hidden')).toBe(false);
        expect(e.refreshes).toEqual([]);
    });

    test('a theme too hard to read is not saved', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        e.type(e.colour('colors.text'), e.colour('colors.background').value);
        expect(e.$('theme-editor-warnings').children.length).toBeGreaterThan(0);
        e.click('theme-editor-save');
        await flush();
        expect(e.saves).toEqual([]);
        expect(e.$('theme-editor-error').textContent).toBe("This theme's text is too hard to read to use. Change Text or Background.");
    });

    test('Reset puts an advanced colour back to the worked-out one', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        const input = e.colour('client.darkHover');
        const worked = input.value;
        expect(worked).toBe(CustomTheme.resolve(midnight).client.darkHover);
        e.type(input, '#123456');
        expect(e.$('theme-editor-client').props['--c-darkHover']).toBe('#123456');
        e.dialog.listeners.click({ target: { dataset: { reset: 'client.darkHover' } } });
        expect(input.value).toBe(worked);
        expect(e.$('theme-editor-client').props['--c-darkHover']).toBe(worked);
    });

    test('advanced colours are labelled in plain words with the key as a tooltip', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        const row = (key) => [...e.$('theme-editor-client-colours').children, ...e.$('theme-editor-launcher-colours').children]
            .find((r) => r.children[0].dataset.key === key);
        const label = row('client.darker').children.find((n) => n.tag === 'label');
        expect(label.textContent).toBe('Cards and title bar');
        expect(label.attributes.title).toBe('Cards and title bar (darker)');
        expect(row('launcher.on-gold').children.find((n) => n.tag === 'label').textContent).toBe('Text on accent');
        expect(row('launcher.on-gold').children.find((n) => n.dataset.reset).attributes['aria-label']).toBe('Reset Text on accent');
    });

    test('Reset puts round scrollbars and scrollbar width back to unset', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        e.$('theme-editor-round').dataset.key = 'style.roundScrollbars';
        e.$('theme-editor-width').dataset.key = 'style.scrollbarWidth';
        e.$('theme-editor-round').checked = true;
        e.type(e.$('theme-editor-round'), true);
        e.type(e.$('theme-editor-width'), '16');
        expect(e.$('theme-editor-client').props['--c-scrollbar-radius']).toBe('999px');
        expect(e.$('theme-editor-width-value').textContent).toBe('16 px');
        e.dialog.listeners.click({ target: { dataset: { reset: 'style.scrollbarWidth' } } });
        e.dialog.listeners.click({ target: { dataset: { reset: 'style.roundScrollbars' } } });
        expect(e.$('theme-editor-width-value').textContent).toBe('Default');
        expect(e.$('theme-editor-width').value).toBe('10');
        expect(e.$('theme-editor-round').checked).toBe(false);
        expect(e.$('theme-editor-client').props['--c-scrollbar-radius']).toBe('0');
    });

    test('a name of only control characters previews as New theme', async () => {
        const e = load();
        await e.window.ThemeEditor.open();
        e.$('theme-editor-name').value = String.fromCharCode(7);
        expect(() => e.type(e.$('theme-editor-name'), String.fromCharCode(7))).not.toThrow();
        expect(e.vars['--gold']).toBeDefined();
    });
    test('a valid hex code sets the colour, with or without #', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        e.type(e.hex('colors.accent'), '#7aa2f7');
        expect(e.colour('colors.accent').value).toBe('#7aa2f7');
        expect(e.vars['--gold']).toBe('#7aa2f7');
        e.type(e.hex('colors.accent'), '7AA2F8');
        expect(e.colour('colors.accent').value).toBe('#7aa2f8');
        expect(e.vars['--gold']).toBe('#7aa2f8');
        expect(e.hex('colors.accent').value).toBe('#7aa2f8');
    });

    test('an invalid hex code shows an error and leaves the theme alone', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        const field = e.hex('colors.accent');
        e.type(field, '#7aa2');
        e.dialog.listeners.focusout({ target: field });
        expect(e.byId('theme-editor-hex-error-colors-accent').textContent).toBe('Use a colour like #7aa2f7');
        expect(field.attributes['aria-invalid']).toBe('true');
        expect(field.attributes['aria-describedby']).toBe('theme-editor-hex-error-colors-accent');
        expect(e.colour('colors.accent').value).toBe('#3399ff');
        expect(e.vars['--gold']).toBe('#3399ff');
        e.type(field, '#00ff00');
        expect(e.byId('theme-editor-hex-error-colors-accent').textContent).toBe('');
    });

    test('Save refuses while a colour code is invalid and is disabled until it is fixed', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        const field = e.hex('colors.accent');
        const focused = [];
        field.focus = () => focused.push(field);
        e.type(field, '#123');
        expect(e.$('theme-editor-save').disabled).toBe(true);
        await e.click('theme-editor-save');
        expect(e.saves).toEqual([]);
        expect(e.byId('theme-editor-hex-error-colors-accent').textContent).toBe('Use a colour like #7aa2f7');
        expect(field.attributes['aria-invalid']).toBe('true');
        expect(focused).toEqual([field]);
        e.type(field, '#00ff00');
        expect(e.$('theme-editor-save').disabled).toBe(false);
        await e.click('theme-editor-save');
        expect(e.saves).toHaveLength(1);
    });

    test('choosing Slate repaints from Slate and moves the unchanged basics with it', async () => {
        const e = load({ current: { theme: 'gold' } });
        await e.window.ThemeEditor.open();
        e.type(e.colour('colors.text'), '#eeeeee');
        e.base('slate');
        expect(e.colour('colors.accent').value).toBe(CustomTheme.BASES.slate.client.accent);
        expect(e.colour('colors.background').value).toBe(CustomTheme.BASES.slate.client.dark);
        expect(e.colour('colors.text').value).toBe('#eeeeee');
        expect(e.vars['--bg']).toBe(CustomTheme.resolve({ base: 'slate', colors: { text: '#eeeeee' } }).launcher.bg);
        expect(e.hex('colors.accent').value).toBe(CustomTheme.BASES.slate.client.accent);
    });

    test('Cancel with changes asks first and stays open when declined', async () => {
        const e = load({ discard: false });
        await e.window.ThemeEditor.open('midnight', midnight);
        e.type(e.colour('colors.accent'), '#00ff00');
        e.click('theme-editor-cancel');
        await flush();
        expect(e.confirms).toHaveLength(1);
        expect(e.confirms[0][0]).toBe('Discard your changes to this theme?');
        expect(e.dialog.classList.contains('auth-hidden')).toBe(false);
        e.click('theme-editor-close');
        await flush();
        expect(e.confirms).toHaveLength(2);
        expect(e.dialog.classList.contains('auth-hidden')).toBe(false);
    });

    test('Cancel without changes closes without asking', async () => {
        const e = load({ discard: false });
        await e.window.ThemeEditor.open('midnight', midnight);
        e.click('theme-editor-close');
        expect(e.confirms).toEqual([]);
        expect(e.dialog.classList.contains('auth-hidden')).toBe(true);
    });

    test('the status counts the changed colours', async () => {
        const e = load();
        await e.window.ThemeEditor.open();
        expect(e.$('theme-editor-status').textContent).toBe('No colours changed');
        e.type(e.colour('colors.accent'), '#00ff00');
        expect(e.$('theme-editor-status').textContent).toBe('1 colour changed');
        e.type(e.colour('client.border'), '#123456');
        e.type(e.colour('launcher.line'), '#123456');
        expect(e.$('theme-editor-status').textContent).toBe('3 colours changed');
    });

    test('the readability banner says so when the text is easy to read', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        expect(e.$('theme-editor-check').dataset.state).toBe('ok');
        expect(e.$('theme-editor-check-title').textContent).toBe('Text is easy to read');
        e.type(e.colour('colors.text'), e.colour('colors.background').value);
        expect(e.$('theme-editor-check').dataset.state).toBe('warn');
        expect(e.$('theme-editor-check-title').textContent).toBe('Hard to read');
    });
    test('the image strength is off while the image is None', async () => {
        const e = load();
        await e.window.ThemeEditor.open('midnight', midnight);
        expect(e.$('theme-editor-strength').disabled).toBe(true);
        e.type(e.$('theme-editor-image'), 'sky.png');
        expect(e.$('theme-editor-strength').disabled).toBe(false);
        e.type(e.$('theme-editor-image'), '');
        expect(e.$('theme-editor-strength').disabled).toBe(true);
    });
});
