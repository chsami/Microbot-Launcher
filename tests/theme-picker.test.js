
// theme-picker.js runs in the renderer; give it just enough of a DOM to drive it
function load({ deferWrites = false, failFirstWrite = false, saved = {} } = {}) {
    const listeners = {};
    const on = (key) => (type, fn) => { listeners[key + ':' + type] = fn; };
    const classes = {};
    const element = (key) => ({
        classList: { add: (c) => (classes[key + ':' + c] = true), remove: (c) => delete classes[key + ':' + c] },
        addEventListener: on(key),
        textContent: '',
    });
    // two radios per group, none checked unless a read says so
    const radios = ['theme'].flatMap((name) => [0, 1].map((i) => ({ name, value: name + i, type: 'radio', checked: false, focus() { focused.el = this; } })));
    const focused = {};
    const els = { 'theme-modal': element('modal'), 'theme-close': element('close'), 'theme-error': element('error'), 'app-menu': element('menu'), 'menu-btn': { focus: () => (focused.menu = true) } };
    els['theme-modal'].querySelector = (sel) => {
        const name = sel.match(/name="(\w+)"/)[1];
        return radios.find((r) => r.name === name && (!sel.includes(':checked') || r.checked)) || null;
    };
    els['theme-modal'].querySelectorAll = () => [];
    const root = { dataset: {} };
    const reads = [];
    const writes = [];
    const pending = [];
    const document = {
        documentElement: root,
        getElementById: (id) => els[id] || null,
        querySelector: (sel) => (sel.includes('data-action') ? element('themes') : null),
        querySelectorAll: () => [],
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
    const dispatched = [];
    const window = { electron, addEventListener: on('window'), dispatchEvent: (e) => dispatched.push(e.type) };
    // load through Jest's module system so coverage counts the picker
    global.window = window;
    global.document = document;
    jest.isolateModules(() => require('../libs/theme-picker.js'));
    listeners['document:DOMContentLoaded']();
    const change = (name, value) => listeners['modal:change']({ target: { name, value } });
    return { dispatched, root, reads, writes, pending, change, focus: () => listeners['window:focus'](), errors: () => els['theme-error'].textContent, classes, focused, open: () => listeners['themes:click'](), key: (key) => listeners['modal:keydown']({ key }) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

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

    test('opening with nothing picked focuses the first colour, and Escape closes', async () => {
        const p = load();
        await flush();
        p.reads[0]({});
        await flush();
        p.open();
        expect(p.focused.el).toMatchObject({ name: 'theme', value: 'theme0' });
        expect(p.classes['modal:auth-hidden']).toBeUndefined();
        p.key('Escape');
        expect(p.classes['modal:auth-hidden']).toBe(true);
    });
});
