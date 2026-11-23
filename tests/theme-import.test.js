// The theme import dialog (libs/theme-import.js) against a hand-rolled DOM: just the calls it makes.
const CustomTheme = require('../libs/custom-theme');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const midnight = CustomTheme.clean({ name: 'Midnight', base: 'slate', colors: { accent: '#3399ff' } }).theme;
const picked = CustomTheme.selection('midnight', midnight);
const UNREADABLE = "This theme's text is too hard to read, so it cannot be saved. Change Text or Background in the theme file, or ask for a fixed code, then preview it again.";

function load({ saveReply = (theme) => ({ id: 'imported', theme: { ...theme, name: theme.name + ' (2)' } }), clipboard = () => Promise.resolve() } = {}) {
    const make = (tag) => {
        const classes = new Set();
        const props = {};
        return {
            tag, value: '', children: [], listeners: {}, dataset: {}, attributes: {}, textContent: '', hidden: false, selected: false,
            classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
            style: { setProperty: (k, v) => (props[k] = v), removeProperty: (k) => delete props[k] },
            props,
            append(...kids) { this.children.push(...kids); },
            replaceChildren(...kids) { this.children = kids; },
            setAttribute(k, v) { this.attributes[k] = v; },
            addEventListener(type, fn) { this.listeners[type] = fn; },
            querySelectorAll: () => [],
            focus() {},
            select() { this.selected = true; },
            set innerHTML(v) { throw new Error('innerHTML used: ' + v); },
        };
    };
    const els = {};
    const docListeners = {};
    const document = {
        documentElement: make('html'),
        getElementById: (id) => (els[id] ||= Object.assign(make('div'), { id })),
        createElement: make,
        addEventListener: (type, fn) => (docListeners[type] = fn),
        activeElement: null,
    };
    document.getElementById('theme-importer').classList.add('auth-hidden');
    const saves = [];
    const refreshes = [];
    const written = [];
    const winListeners = {};
    const window = {
        addEventListener: (type, fn) => (winListeners[type] = fn),
        navigator: { clipboard: { writeText: (text) => (written.push(text), clipboard(text)) } },
        electron: {
            themes: {
                save: (theme, id) => (saves.push([theme, id]), Promise.resolve(saveReply(theme, id))),
                image: () => Promise.resolve({ error: 'not here' }),
            },
        },
        ThemePicker: { current: () => picked, refresh: () => (refreshes.push(1), Promise.resolve()) },
    };
    global.window = window;
    global.document = document;
    jest.isolateModules(() => {
        require('../libs/custom-theme.js');
        require('../libs/theme-apply.js');
        require('../libs/theme-import.js');
    });
    docListeners.DOMContentLoaded();
    const $ = document.getElementById;
    const click = (id) => $(id).listeners.click();
    return { window, $, click, dialog: $('theme-importer'), vars: document.documentElement.props, saves, refreshes, written, winListeners };
}

afterEach(() => {
    delete global.window;
    delete global.document;
});

describe('readDrop', () => {
    const { readDrop } = require('../libs/theme-import');
    const drop = (name, size) => ({ name, size, text: () => Promise.resolve('{"name":"x"}') });

    test('readDrop accepts small json only', async () => {
        expect(await readDrop(drop('mine.JSON', 100))).toEqual({ text: '{"name":"x"}' });
        expect(await readDrop(drop('mine.png', 100))).toEqual({ error: 'Drop a theme .json file.' });
        expect(await readDrop(undefined)).toEqual({ error: 'Drop a theme .json file.' });
        expect(await readDrop(drop('big.json', 64 * 1024 + 1))).toEqual({ error: 'This file is too big to be a theme.' });
    });
});

describe('theme import', () => {
    test('import previews before saving and saves without an id', async () => {
        const e = load();
        const code = CustomTheme.encode(midnight);
        e.window.ThemeImport.open();
        expect(e.dialog.classList.contains('auth-hidden')).toBe(false);
        expect(e.$('theme-modal').classList.contains('auth-hidden')).toBe(true);
        e.$('theme-import-text').value = code;
        e.click('theme-import-preview');
        expect(e.$('theme-import-name').textContent).toBe('Midnight');
        expect(e.vars['--gold']).toBe('#3399ff');
        expect(e.saves).toEqual([]);
        e.click('theme-import-save');
        await flush();
        await flush();
        expect(e.saves).toEqual([[midnight, undefined]]);
        expect(e.refreshes).toHaveLength(1);
        expect(e.$('theme-import-status').textContent).toBe('Saved as Midnight (2). Press Done, then pick it in Your themes to use it.');
    });

    test('after a save, Save stays off and Cancel reads Done until the text changes', async () => {
        const e = load();
        e.window.ThemeImport.open(CustomTheme.encode(midnight));
        e.click('theme-import-save');
        await flush();
        await flush();
        expect(e.$('theme-import-save').disabled).toBe(true);
        expect(e.$('theme-import-cancel').textContent).toBe('Done');
        e.click('theme-import-preview'); // the same text again is still the saved theme
        expect(e.$('theme-import-save').disabled).toBe(true);
        e.$('theme-import-text').listeners.input();
        expect(e.$('theme-import-cancel').textContent).toBe('Cancel');
        e.click('theme-import-preview');
        expect(e.$('theme-import-save').disabled).toBe(false);
    });

    test('an unreadable theme cannot be saved and says why', async () => {
        const e = load();
        const murky = CustomTheme.clean({ name: 'Murky', base: 'slate', colors: { background: '#202020', text: '#252525' } }).theme;
        e.window.ThemeImport.open(JSON.stringify(murky));
        expect(e.$('theme-import-save').disabled).toBe(true);
        expect(e.$('theme-import-status').textContent).toBe(UNREADABLE);
        e.click('theme-import-save');
        await flush();
        expect(e.saves).toEqual([]);
    });

    test('a theme file with an image names the image to put in the themes folder', () => {
        const e = load();
        e.window.ThemeImport.open(JSON.stringify({ ...midnight, background: { image: 'sky.png', strength: 20 } }));
        expect(e.$('theme-import-note').textContent).toBe('This theme uses the image sky.png. Put that file in your themes folder.');
    });

    test('a code never mentions an image file', () => {
        const e = load();
        e.window.ThemeImport.open(CustomTheme.encode({ ...midnight, background: { image: 'sky.png', strength: 20 } }));
        expect(e.$('theme-import-note').textContent).toBe('');
    });

    test('a preview shows three colour chips and the readability line like the editor', () => {
        const e = load();
        e.window.ThemeImport.open(CustomTheme.encode(midnight));
        const resolved = CustomTheme.resolve(midnight);
        expect(e.$('theme-import-chips').children.map((c) => c.props['--chip'])).toEqual([resolved.launcher.bg, resolved.launcher['surface-2'], resolved.launcher.gold]);
        expect(e.$('theme-import-check').hidden).toBe(false);
        expect(e.$('theme-import-check').dataset.state).toBe('ok');
        expect(e.$('theme-import-check-title').textContent).toBe('Text is easy to read');
        expect(e.$('theme-import-warnings').children).toEqual([]);
        e.$('theme-import-text').value = 'mbtheme1.<script>';
        e.click('theme-import-preview');
        expect(e.$('theme-import-chips').children).toEqual([]);
        expect(e.$('theme-import-check').hidden).toBe(true);
    });

    test('an unreadable theme lists its warnings under Hard to read', () => {
        const e = load();
        const murky = CustomTheme.clean({ name: 'Murky', base: 'slate', colors: { background: '#202020', text: '#252525' } }).theme;
        expect(CustomTheme.readable(CustomTheme.resolve(murky))).toBe(false);
        e.window.ThemeImport.open(JSON.stringify(murky));
        expect(e.$('theme-import-check').dataset.state).toBe('warn');
        expect(e.$('theme-import-check-title').textContent).toBe('Hard to read');
        expect(e.$('theme-import-warnings').children.map((n) => n.textContent)).toEqual(CustomTheme.warnings(CustomTheme.resolve(murky)));
    });

    test('a theme file whose image is missing shows no red error, only the note', async () => {
        const e = load();
        e.window.ThemeImport.open(JSON.stringify({ ...midnight, background: { image: 'sky.png', strength: 20 } }));
        await flush();
        await flush();
        expect(e.$('theme-import-error').textContent).toBe('');
    });

    test('a bad code shows the error and saves nothing', async () => {
        const e = load();
        e.window.ThemeImport.open('mbtheme1.<script>');
        expect(e.$('theme-import-error').textContent).toBe('That is not a theme code.');
        expect(e.vars['--gold']).toBe('#3399ff'); // the picked theme stays painted
        e.click('theme-import-save');
        await flush();
        expect(e.saves).toEqual([]);
    });

    test('cancel repaints the picked theme', () => {
        const e = load();
        e.window.ThemeImport.open(CustomTheme.encode({ ...midnight, colors: { accent: '#00ff00' } }));
        expect(e.vars['--gold']).toBe('#00ff00');
        e.click('theme-import-cancel');
        expect(e.dialog.classList.contains('auth-hidden')).toBe(true);
        expect(e.vars['--gold']).toBe('#3399ff');
    });

    test('a dropped theme file opens the preview', async () => {
        const e = load();
        const event = { preventDefault: jest.fn(), dataTransfer: { files: [{ name: 'm.json', size: 10, text: () => Promise.resolve(JSON.stringify(midnight)) }] } };
        e.$('theme-modal').listeners.drop(event);
        await flush();
        expect(event.preventDefault).toHaveBeenCalled();
        expect(e.$('theme-import-name').textContent).toBe('Midnight');
        const stray = { preventDefault: jest.fn() };
        e.winListeners.drop(stray);
        expect(stray.preventDefault).toHaveBeenCalled();
    });

    test('a text drop is left to the text box', async () => {
        const e = load();
        const event = { preventDefault: jest.fn(), target: { id: 'theme-import-text' }, dataTransfer: { files: [] } };
        e.$('theme-importer').listeners.drop(event);
        e.winListeners.drop(event);
        await flush();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(e.dialog.classList.contains('auth-hidden')).toBe(true);
    });
});

describe('too long', () => {
    test('the text box holds at most 70000 characters', () => {
        const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
        expect(html).toMatch(/<textarea id="theme-import-text"[^>]*maxlength="70000"/);
    });

    test('a paste over 70000 characters is refused with the too-long message', () => {
        const e = load();
        e.window.ThemeImport.open();
        const paste = (text) => {
            const event = { clipboardData: { getData: () => text }, prevented: false, preventDefault() { this.prevented = true; } };
            e.$('theme-import-text').listeners.paste(event);
            return event.prevented;
        };
        expect(paste('x'.repeat(70000))).toBe(false);
        expect(e.$('theme-import-error').textContent).toBe('');
        expect(paste('x'.repeat(70001))).toBe(true);
        expect(e.$('theme-import-error').textContent).toBe('This theme code is too long.');
    });
});

describe('save as new theme', () => {
    test('stays off until the text in the box has previewed', () => {
        const e = load();
        e.window.ThemeImport.open();
        expect(e.$('theme-import-save').disabled).toBe(true);
        e.$('theme-import-text').value = 'mbtheme1.nope';
        e.click('theme-import-preview');
        expect(e.$('theme-import-save').disabled).toBe(true);
        e.$('theme-import-text').value = CustomTheme.encode(midnight);
        e.click('theme-import-preview');
        expect(e.$('theme-import-save').disabled).toBe(false);
        e.$('theme-import-text').listeners.input();
        expect(e.$('theme-import-save').disabled).toBe(true);
    });

    test('stays off when the text changes while a save is pending', async () => {
        let finish;
        const e = load({ saveReply: (theme) => new Promise((resolve) => (finish = () => resolve({ id: 'x', theme }))) });
        e.window.ThemeImport.open(CustomTheme.encode(midnight));
        e.click('theme-import-save');
        e.$('theme-import-text').listeners.input();
        finish();
        await flush();
        expect(e.$('theme-import-save').disabled).toBe(true);
    });

    test('comes back after a failed save of unchanged text so it can be retried', async () => {
        const e = load({ saveReply: () => ({ error: 'disk full' }) });
        e.window.ThemeImport.open(CustomTheme.encode(midnight));
        e.click('theme-import-save');
        await flush();
        expect(e.$('theme-import-save').disabled).toBe(false);
    });

    test('a code opened straight into the dialog can be saved at once', () => {
        const e = load();
        e.window.ThemeImport.open(CustomTheme.encode(midnight));
        expect(e.$('theme-import-save').disabled).toBe(false);
    });

    test('is the primary button', () => {
        const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
        expect(html).toContain('<button id="theme-import-save" class="theme-button theme-button-primary" type="button" disabled>Save as new theme</button>');
    });
});

describe('file drops', () => {
    const drop = (e, text) => {
        let finish;
        const file = { name: 't.json', size: 10, text: () => new Promise((resolve) => (finish = () => resolve(text))) };
        const pending = e.dialog.listeners.drop({ dataTransfer: { files: [file] }, preventDefault() {} });
        return { finish: () => (finish(), pending) };
    };

    test('a drop finishing after Cancel does not reopen the dialog', async () => {
        const e = load();
        e.window.ThemeImport.open();
        const d1 = drop(e, CustomTheme.encode(midnight));
        e.click('theme-import-cancel');
        await d1.finish();
        expect(e.dialog.classList.contains('auth-hidden')).toBe(true);
    });

    test('an older drop finishing last does not replace the newer one', async () => {
        const e = load();
        const other = CustomTheme.clean({ name: 'Other', base: 'slate' }).theme;
        const older = drop(e, CustomTheme.encode(midnight));
        const newer = drop(e, CustomTheme.encode(other));
        await newer.finish();
        await older.finish();
        expect(e.$('theme-import-name').textContent).toBe('Other');
    });
});

describe('copy code', () => {
    test('copy writes an mbtheme1 code', async () => {
        jest.useFakeTimers();
        try {
            const e = load();
            const button = { textContent: 'Copy code' };
            await e.window.ThemeImport.copy(midnight, button);
            expect(e.written).toEqual([CustomTheme.encode(midnight)]);
            expect(e.written[0].startsWith('mbtheme1.')).toBe(true);
            expect(button.textContent).toBe('Copied');
            jest.advanceTimersByTime(2000);
            expect(button.textContent).toBe('Copy code');
            expect(e.$('theme-share-note').textContent).toBe('');
            await e.window.ThemeImport.copy({ ...midnight, background: { image: 'sky.png', strength: 20 } }, button);
            expect(e.written[1]).toBe(e.written[0]); // the image never travels in the code
            expect(e.$('theme-share-note').textContent).toBe('Background images are not included in codes. Send the image file too.');
        } finally {
            jest.useRealTimers();
        }
    });

    test('copying twice within 2 s does not leave the button on Copied', async () => {
        jest.useFakeTimers();
        try {
            const e = load();
            const button = { textContent: 'Copy code' };
            await e.window.ThemeImport.copy(midnight, button);
            jest.advanceTimersByTime(1000);
            await e.window.ThemeImport.copy(midnight, button);
            jest.advanceTimersByTime(2000);
            expect(button.textContent).toBe('Copy code');
        } finally {
            jest.useRealTimers();
        }
    });

    test('clipboard failure falls back to showing the code', async () => {
        const e = load({ clipboard: () => Promise.reject(new Error('denied')) });
        const withImage = { ...midnight, background: { image: 'sky.png', strength: 20 } };
        await e.window.ThemeImport.copy(withImage, { textContent: 'Copy code' });
        expect(e.dialog.classList.contains('auth-hidden')).toBe(false);
        expect(e.$('theme-import-text').value).toBe(CustomTheme.encode(midnight));
        expect(e.$('theme-import-text').selected).toBe(true);
        expect(e.$('theme-import-status').textContent).toMatch('Background images are not included in codes. Send the image file too.');
    });

    test('the clipboard fallback only shows the code: no preview, no Save, Cancel reads Done', async () => {
        const e = load({ clipboard: () => Promise.reject(new Error('denied')) });
        await e.window.ThemeImport.copy(midnight, { textContent: 'Copy code' });
        expect(e.$('theme-import-save').disabled).toBe(true);
        expect(e.$('theme-import-cancel').textContent).toBe('Done');
        expect(e.$('theme-import-name').textContent).toBe('');
        expect(e.vars['--theme-image']).toBeUndefined();
        expect(e.saves).toEqual([]);
    });
});
