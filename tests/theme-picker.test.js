
// theme-picker.js runs in the renderer; give it just enough of a DOM to drive it
function load({ deferWrites = false, failFirstWrite = false, saved = {}, themes = [], editorOpen = false } = {}) {
    const listeners = {};
    const on = (key) => (type, fn) => { listeners[key + ':' + type] = fn; };
    const classes = {};
    const element = (key) => ({
        classList: { add: (c) => (classes[key + ':' + c] = true), remove: (c) => delete classes[key + ':' + c] },
        addEventListener: on(key),
        textContent: '',
    });
    const focused = {};
    const els = { 'theme-modal': element('modal'), 'theme-close': element('close'), 'theme-error': element('error'), 'app-menu': element('menu'), 'menu-btn': { focus: () => (focused.menu = true) } };
    // created nodes: setting innerHTML would throw, so text from a theme can only arrive as textContent
    const inputs = [];
    const make = (tag) => {
        const names = new Set();
        const node = {
            tag, children: [], props: {}, attributes: {}, listeners: {}, textContent: '', parentElement: null,
            style: { setProperty: (k, v) => (node.props[k] = v) },
            classList: { add: (c) => names.add(c), remove: (c) => names.delete(c), toggle: (c, on) => (on ? names.add(c) : names.delete(c)), contains: (c) => names.has(c) },
            set className(v) { names.clear(); v.split(' ').forEach((c) => names.add(c)); },
            get className() { return [...names].join(' '); },
            append(...kids) { for (const kid of kids) { if (typeof kid === 'object') kid.parentElement = this; this.children.push(kid); } },
            setAttribute(k, v) { this.attributes[k] = v; },
            addEventListener(type, fn) { this.listeners[type] = fn; },
            closest(sel) { let n = this; while (n && !n.classList.contains(sel.slice(1))) n = n.parentElement; return n; },
            focus() { focused.el = this; },
            set innerHTML(v) { throw new Error('innerHTML used: ' + v); },
        };
        if (tag === 'input') inputs.push(node);
        return node;
    };
    const live = () => inputs.filter((i) => i.name === 'theme');
    els['theme-modal'].querySelector = (sel) => live().find((r) => !sel.includes(':checked') || r.checked) || null;
    els['theme-modal'].querySelectorAll = () => [];
    els['theme-builtin-list'] = { children: [], replaceChildren(...kids) { this.children = kids; } };
    els['theme-custom-list'] = { children: [], replaceChildren(...kids) { this.children = kids; } };
    els['theme-empty'] = { hidden: true };
    els['theme-title'] = { id: 'theme-title', focus() { focused.el = this; } };
    els['theme-missing'] = { hidden: true };
    if (editorOpen) els['theme-editor'] = { classList: { contains: () => false } };
    const vars = {};
    const root = { dataset: {}, style: { setProperty: (k, v) => (vars[k] = v), removeProperty: (k) => delete vars[k] } };
    const reads = [];
    const writes = [];
    const pending = [];
    const document = {
        documentElement: root,
        getElementById: (id) => els[id] || null,
        querySelector: (sel) => (sel.includes('data-action') ? element('themes') : null),
        querySelectorAll: () => live(),
        createElement: make,
        createElementNS: (ns, tag) => make(tag),
        addEventListener: on('document'),
        activeElement: null,
    };
    const electron = {
        theme: {
            read: () => new Promise((resolve) => reads.push(resolve)),
            // like the main process: merge the change into the saved file and return the result
            write: (value) => {
                writes.push(value);
                if (failFirstWrite && writes.length === 1) return Promise.reject(new Error('ipc gone'));
                const save = () => ({ ...Object.assign(saved, value) });
                return deferWrites ? new Promise((resolve) => pending.push(() => resolve(save()))) : Promise.resolve(save());
            },
        },
    };
    const removed = [];
    const opened = [];
    const ThemeEditor = { open: (...args) => opened.push(args) };
    electron.themes = {
        list: () => Promise.resolve(themes.filter((e) => !removed.includes(e.id))),
        image: () => Promise.resolve({ error: 'That image is not in the themes folder.' }),
        remove: (id) => (removed.push(id), Promise.resolve({ ok: true })),
    };
    const confirms = [];
    electron.showConfirmationDialog = (...args) => (confirms.push(args), Promise.resolve(true));
    const dispatched = [];
    const window = { electron, ThemeEditor, addEventListener: on('window'), dispatchEvent: (e) => dispatched.push(e.type) };
    // load through Jest's module system so coverage counts the picker
    global.window = window;
    global.document = document;
    jest.isolateModules(() => {
        require('../libs/custom-theme.js'); // each sets its window.<Name>, as the page's script tags do
        require('../libs/theme-apply.js');
        require('../libs/theme-picker.js');
    });
    listeners['document:DOMContentLoaded']();
    const change = (name, value) => listeners['modal:change']({ target: { name, value } });
    const rows = () => els['theme-custom-list'].children;
    // the custom theme cards, after the New theme card
    const cards = () => rows().slice(1);
    return { dispatched, root, vars, rows, cards, builtIns: () => els['theme-builtin-list'].children, empty: els['theme-empty'], opened, removed, confirms, missing: els['theme-missing'], reads, writes, pending, change, focus: () => listeners['window:focus'](), errors: () => els['theme-error'].textContent, classes, focused, open: () => listeners['themes:click'](), key: (key) => listeners['modal:keydown']({ key }), keydown: (e) => listeners['modal:keydown'](e), modal: els['theme-modal'], document, window };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const CustomTheme = require('../libs/custom-theme');
const midnight = { id: 'midnight', theme: CustomTheme.clean({ name: 'Midnight', base: 'slate', colors: { accent: '#3399ff' } }).theme };
// every node under a card, depth first
const nodes = (el) => [el, ...(el.children || []).flatMap(nodes)];
// a custom card's icon button, by the start of its aria-label
const action = (card, name) => nodes(card).find((n) => n.tag === 'button' && n.attributes['aria-label']?.startsWith(name));
const HEX = /^#[0-9a-f]{6}$/i;

afterEach(() => {
    delete global.window;
    delete global.document;
});

describe('theme picker', () => {
    test('announces each applied theme so other views can restyle', async () => {
        const p = load();
        await flush();
        const before = p.dispatched.length;
        p.change('theme', 'slate');
        expect(p.dispatched.slice(before)).toEqual(['theme-changed']);
    });

    test('re-applying the same theme does not announce a change', async () => {
        const p = load();
        await flush();
        p.change('theme', 'slate');
        const before = p.dispatched.length;
        p.change('theme', 'slate');
        expect(p.dispatched.slice(before)).toEqual([]);
    });

    test('a read that started before a change does not undo it', async () => {
        const p = load();
        await flush();
        p.change('theme', 'slate');
        p.reads[0]({ theme: 'gold' }); // the startup read lands late
        await flush();
        expect(p.root.dataset.theme).toBe('slate');
    });

    test('quick changes save in order and the last one wins', async () => {
        const p = load();
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        p.change('theme', 'slate');
        p.change('theme', 'classic');
        await flush();
        await flush();
        expect(p.writes).toEqual([{ theme: 'slate' }, { theme: 'classic' }]);
        expect(p.root.dataset).toEqual({ theme: 'classic' });
    });

    test('a focus read waits for queued saves before reading', async () => {
        const p = load({ deferWrites: true });
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        p.change('theme', 'slate');
        p.change('theme', 'classic');
        p.focus();
        await flush();
        expect(p.reads.length).toBe(1); // no read while saves are in flight
        while (p.pending.length) {
            p.pending.shift()();
            await flush();
            await flush();
        }
        expect(p.writes).toEqual([{ theme: 'slate' }, { theme: 'classic' }]);
        expect(p.reads.length).toBe(2);
        p.reads[1]({ theme: 'classic' });
        await flush();
        expect(p.root.dataset).toEqual({ theme: 'classic' });
    });

    test('with nothing picked the launcher stays Gold until a theme is picked', async () => {
        const p = load();
        await flush();
        p.reads[0]({});
        await flush();
        expect(p.root.dataset).toEqual({ theme: 'gold' });
        p.change('theme', 'slate');
        await flush();
        expect(p.writes).toEqual([{ theme: 'slate' }]);
        expect(p.root.dataset).toEqual({ theme: 'slate' });
    });

    test('a failed save does not block the next one', async () => {
        const p = load({ failFirstWrite: true });
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        p.change('theme', 'slate');
        p.change('theme', 'classic');
        await flush();
        await flush();
        await flush();
        expect(p.writes).toEqual([{ theme: 'slate' }, { theme: 'classic' }]);
        expect(p.errors()).toBe('');
    });

    test('closing returns focus to the menu button', async () => {
        const p = load();
        await flush();
        p.open();
        p.key('Escape');
        expect(p.focused.menu).toBe(true);
    });

    test('a read leaves the open editor\'s preview alone', async () => {
        const p = load({ editorOpen: true });
        await flush();
        p.reads[0]({ theme: 'classic' });
        await flush();
        expect(p.root.dataset).toEqual({});
    });

    test('a focus read applies a change made elsewhere', async () => {
        const p = load();
        await flush();
        p.reads[0]({ theme: 'gold' });
        p.focus();
        await flush();
        p.reads[1]({ theme: 'classic' });
        await flush();
        expect(p.root.dataset).toEqual({ theme: 'classic' });
    });

    test('opening focuses the dialog heading, not a card, and Escape closes', async () => {
        const p = load();
        await flush();
        p.reads[0]({});
        await flush();
        p.open();
        expect(p.focused.el).toMatchObject({ id: 'theme-title' });
        expect(p.classes['modal:auth-hidden']).toBeUndefined();
        p.key('Escape');
        expect(p.classes['modal:auth-hidden']).toBe(true);
    });

    test('lists custom themes as cards with text only', async () => {
        const evil = '<img src=x onerror=alert(1)>';
        const p = load({ themes: [{ id: 'evil', theme: CustomTheme.clean({ name: evil, base: 'slate' }).theme }] });
        await flush();
        p.open();
        await flush();
        const [card] = p.cards();
        expect(card.classList.contains('theme-card')).toBe(true);
        expect(nodes(card).some((n) => n.textContent === evil)).toBe(true);
        expect(nodes(card).some((n) => n.textContent === 'Based on Slate')).toBe(true);
        expect(nodes(card).find((n) => n.tag === 'input')).toMatchObject({ type: 'radio', name: 'theme', value: 'custom:evil' });
        expect(nodes(card).filter((n) => n.tag === 'button').map((n) => [n.attributes['aria-label'], n.attributes.title])).toEqual([
            ['Edit ' + evil, 'Edit'], ['Delete ' + evil, 'Delete'],
        ]);
    });

    test('built-in cards keep their radio values and say Built-in', async () => {
        const p = load();
        await flush();
        const cards = p.builtIns();
        expect(cards.map((c) => nodes(c).find((n) => n.tag === 'input').value)).toEqual(['gold', 'slate', 'classic']);
        expect(cards.map((c) => nodes(c).find((n) => n.classList.contains('theme-card-name')).textContent)).toEqual(['Gold', 'Slate', 'Classic RuneLite']);
        for (const c of cards) expect(nodes(c).some((n) => n.textContent === 'Built-in')).toBe(true);
    });

    test('the card in use is marked and says In use', async () => {
        const p = load({ themes: [midnight] });
        await flush();
        p.reads[0]({ theme: 'slate' });
        await flush();
        await flush();
        const marked = () => [...p.builtIns(), ...p.cards()].map((c) => c.classList.contains('is-current'));
        expect(marked()).toEqual([false, true, false, false]);
        expect(nodes(p.builtIns()[1]).some((n) => n.textContent === 'In use')).toBe(true);
        p.change('theme', 'custom:midnight');
        await flush();
        expect(marked()).toEqual([false, false, false, true]);
    });

    test('thumbnails get only #rrggbb colours, through setProperty', async () => {
        const p = load({ themes: [midnight] });
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        await flush();
        const thumbs = [...p.builtIns(), ...p.cards()].map((c) => nodes(c).find((n) => n.classList.contains('theme-thumb')));
        expect(thumbs.map((t) => t.attributes['aria-hidden'])).toEqual(['true', 'true', 'true', 'true']);
        for (const t of thumbs) expect(Object.keys(t.props).sort()).toEqual(['--thumb-bg', '--thumb-gold', '--thumb-line', '--thumb-muted', '--thumb-surface', '--thumb-surface-2', '--thumb-text', '--thumb-text-strong']);
        expect(thumbs[1].props['--thumb-gold']).toBe(CustomTheme.BASES.slate.launcher.gold);
        expect(thumbs[3].props['--thumb-gold']).toBe('#3399ff');
        const all = [...p.builtIns(), ...p.rows()].flatMap(nodes);
        for (const n of all) for (const v of Object.values(n.props)) expect(v).toMatch(HEX);
        expect(all.every((n) => !n.style.background)).toBe(true);
    });

    test('a broken theme file is a muted card with text only', async () => {
        const p = load({ themes: [{ id: 'broken', error: 'This file is not valid theme JSON.' }] });
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        await flush();
        const [card] = p.cards();
        expect(card.classList.contains('theme-card-broken')).toBe(true);
        expect(nodes(card).some((n) => n.tag === 'input' || n.tag === 'button')).toBe(false);
        expect(nodes(card).map((n) => n.textContent).filter(Boolean)).toEqual(['broken.json', 'This file is not valid theme JSON.']);
    });

    test('the New theme card comes first and opens the editor; the empty note shows only with no themes', async () => {
        const p = load();
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        await flush();
        const [first] = p.rows();
        expect(first).toMatchObject({ tag: 'button', type: 'button', textContent: '+ New theme' });
        expect(p.empty.hidden).toBe(false);
        first.listeners.click();
        expect(p.opened).toEqual([[]]);
        const q = load({ themes: [midnight] });
        await flush();
        q.reads[0]({ theme: 'gold' });
        await flush();
        await flush();
        expect(q.empty.hidden).toBe(true);
    });

    test('Edit opens the editor for that theme', async () => {
        const p = load({ themes: [midnight] });
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        await flush();
        action(p.cards()[0], 'Edit').listeners.click();
        expect(p.opened).toEqual([['midnight', midnight.theme]]);
    });

    test('picking a custom theme saves its selection', async () => {
        const p = load({ themes: [midnight] });
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        p.change('theme', 'custom:midnight');
        await flush();
        await flush();
        const picked = CustomTheme.selection('midnight', midnight.theme);
        expect(p.writes).toEqual([picked]);
        expect(p.root.dataset.theme).toBe('slate');
        expect(p.vars['--gold']).toBe('#3399ff');
    });

    test('a saved custom theme whose file is gone still paints and shows the note', async () => {
        const p = load();
        await flush();
        p.reads[0](CustomTheme.selection('gone', midnight.theme));
        await flush();
        await flush();
        expect(p.vars['--gold']).toBe('#3399ff');
        expect(p.missing.hidden).toBe(false);
        expect(p.writes).toEqual([]);
    });

    test('a theme too hard to read is refused', async () => {
        const grey = { id: 'grey', theme: CustomTheme.clean({ name: 'Grey', colors: { background: '#777777', panel: '#777777', text: '#888888' } }).theme };
        const p = load({ themes: [grey] });
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        p.change('theme', 'custom:grey');
        await flush();
        expect(p.writes).toEqual([]);
        expect(p.root.dataset).toEqual({ theme: 'gold' });
        expect(p.errors()).toMatch(/too hard to read/);
    });

    test('a hand-edited picked theme is saved again on list load', async () => {
        const p = load({ themes: [midnight] });
        await flush();
        p.reads[0](CustomTheme.selection('midnight', { ...midnight.theme, colors: { accent: '#00ff00' } }));
        await flush();
        await flush();
        expect(p.writes).toEqual([CustomTheme.selection('midnight', midnight.theme)]);
        expect(p.vars['--gold']).toBe('#3399ff');
    });

    test('a hand-edited picked theme that is now unreadable says why instead of skipping', async () => {
        const grey = CustomTheme.clean({ name: 'Midnight', colors: { background: '#777777', panel: '#777777', text: '#888888' } }).theme;
        const p = load({ themes: [{ id: 'midnight', theme: grey }] });
        await flush();
        p.reads[0](CustomTheme.selection('midnight', midnight.theme));
        await flush();
        await flush();
        expect(p.writes).toEqual([]);
        expect(p.vars['--gold']).toBe('#3399ff'); // the last good colours stay
        expect(p.errors()).toMatch(/^This theme was not applied because its text is too hard to read\./);
    });

    test('deleting the picked theme keeps the file when switching away fails', async () => {
        const p = load({ themes: [midnight], failFirstWrite: true });
        await flush();
        p.reads[0](CustomTheme.selection('midnight', midnight.theme));
        await flush();
        await flush();
        action(p.cards()[0], 'Delete').listeners.click();
        await flush();
        await flush();
        await flush();
        expect(p.writes).toEqual([{ theme: 'slate' }]);
        expect(p.removed).toEqual([]);
        expect(p.errors()).toBe('Could not save the theme: ipc gone');
        // the selection is still midnight, so a second delete switches again first
        action(p.cards()[0], 'Delete').listeners.click();
        for (let i = 0; i < 5; i++) await flush();
        expect(p.writes).toEqual([{ theme: 'slate' }, { theme: 'slate' }]);
        expect(p.removed).toEqual(['midnight']);
    });

    test('a failed save puts back the last saved theme', async () => {
        const p = load({ failFirstWrite: true });
        await flush();
        p.reads[0]({ theme: 'slate' });
        await flush();
        p.change('theme', 'gold');
        await flush();
        await flush();
        expect(p.root.dataset.theme).toBe('slate');
        const checked = p.builtIns().map((c) => nodes(c).find((n) => n.tag === 'input').checked);
        expect(checked).toEqual([false, true, false]);
        expect(p.errors()).toBe('Could not save the theme: ipc gone');
    });

    test('deleting the picked theme while its switch is pending waits for the switch', async () => {
        const p = load({ themes: [midnight], deferWrites: true });
        await flush();
        p.reads[0](CustomTheme.selection('midnight', midnight.theme));
        await flush();
        await flush();
        const del = action(p.cards()[0], 'Delete');
        del.listeners.click();
        await flush();
        await flush();
        del.listeners.click();
        await flush();
        await flush();
        expect(p.writes).toEqual([{ theme: 'slate' }]);
        expect(p.removed).toEqual([]); // theme.json still points at midnight
        p.pending.shift()();
        for (let i = 0; i < 5; i++) await flush();
        expect(p.writes).toEqual([{ theme: 'slate' }]);
        expect(p.removed[0]).toBe('midnight');
    });

    test('Tab wraps at the dialog\'s first and last controls, the radio group being one stop', async () => {
        const p = load();
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        const control = (name) => ({ tag: 'button', name, focus() { p.focused.el = this; } });
        const [close, done] = [control('close'), control('done')];
        const radios = p.builtIns().map((c) => nodes(c).find((n) => n.tag === 'input'));
        p.modal.querySelectorAll = () => [close, ...radios, done];
        const tab = (from, shiftKey) => {
            p.document.activeElement = from;
            p.focused.el = null;
            const e = { key: 'Tab', shiftKey, preventDefault: jest.fn() };
            p.keydown(e);
            return [e.preventDefault.mock.calls.length, p.focused.el];
        };
        expect(tab(close, true)).toEqual([1, done]);
        expect(tab(done, false)).toEqual([1, close]);
        expect(tab(radios[0], true)).toEqual([0, null]); // back to Close, by the browser
        expect(tab(radios[0], false)).toEqual([0, null]);
    });

    test('a list refresh keeps keyboard focus on the same control, or the New theme card if it went', async () => {
        const p = load({ themes: [midnight] });
        await flush();
        p.reads[0]({ theme: 'gold' });
        await flush();
        await flush();
        p.document.activeElement = action(p.cards()[0], 'Edit');
        await p.window.ThemePicker.refresh();
        const edit = action(p.cards()[0], 'Edit');
        expect(edit).not.toBe(p.document.activeElement);
        expect(p.focused.el).toBe(edit);
        p.document.activeElement = edit;
        p.removed.push('midnight');
        await p.window.ThemePicker.refresh();
        expect(p.focused.el).toBe(p.rows()[0]);
    });

    test('opening Themes reloads the background image', async () => {
        const p = load();
        await flush();
        p.window.ThemeApply.forget = jest.fn();
        p.open();
        expect(p.window.ThemeApply.forget).toHaveBeenCalled();
    });

    test('deleting the picked theme asks, then switches to its base first', async () => {
        const p = load({ themes: [midnight] });
        await flush();
        p.reads[0](CustomTheme.selection('midnight', midnight.theme));
        await flush();
        await flush();
        action(p.cards()[0], 'Delete').listeners.click();
        await flush();
        await flush();
        expect(p.confirms[0][0]).toBe('Delete the theme "Midnight"?');
        expect(p.writes).toEqual([{ theme: 'slate' }]);
        expect(p.removed).toEqual(['midnight']);
        expect(p.vars).toEqual({});
        expect(p.cards()).toEqual([]);
    });
});
