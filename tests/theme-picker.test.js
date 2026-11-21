const fs = require('fs');
const path = require('path');
const vm = require('vm');

// theme-picker.js runs in the renderer; give it just enough of a DOM to drive it
function load({ deferWrites = false } = {}) {
    const listeners = {};
    const on = (key) => (type, fn) => { listeners[key + ':' + type] = fn; };
    const element = (key) => ({ classList: { add() {}, remove() {} }, addEventListener: on(key), textContent: '' });
    const els = { 'theme-modal': element('modal'), 'theme-close': element('close'), 'theme-error': element('error') };
    const root = { dataset: {} };
    const reads = [];
    const writes = [];
    const pending = [];
    const document = {
        documentElement: root,
        getElementById: (id) => els[id] || null,
        querySelector: () => element('menu'),
        querySelectorAll: () => [],
        addEventListener: on('document'),
        activeElement: null,
    };
    const electron = {
        theme: {
            read: () => new Promise((resolve) => reads.push(resolve)),
            write: (value) => {
                writes.push(value);
                return deferWrites ? new Promise((resolve) => pending.push(() => resolve(value))) : Promise.resolve(value);
            },
        },
    };
    const window = { electron, addEventListener: on('window') };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'libs', 'theme-picker.js'), 'utf8'), { window, document });
    listeners['document:DOMContentLoaded']();
    const change = (name, value) => listeners['modal:change']({ target: { name, value } });
    return { root, reads, writes, pending, change, focus: () => listeners['window:focus']() };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('theme picker', () => {
    test('a read that started before a change does not undo it', async () => {
        const p = load();
        await flush();
        p.change('theme', 'slate');
        p.reads[0]({ theme: 'gold', font: 'montserrat' }); // the startup read lands late
        await flush();
        expect(p.root.dataset.theme).toBe('slate');
    });

    test('quick changes keep both choices and save them in order', async () => {
        const p = load();
        await flush();
        p.reads[0]({ theme: 'gold', font: 'montserrat' });
        await flush();
        p.change('theme', 'slate');
        p.change('font', 'inter');
        await flush();
        await flush();
        expect(p.writes).toEqual([{ theme: 'slate', font: 'montserrat' }, { theme: 'slate', font: 'inter' }]);
        expect(p.root.dataset).toEqual({ theme: 'slate', font: 'inter' });
    });

    test('a focus read waits for queued saves before reading', async () => {
        const p = load({ deferWrites: true });
        await flush();
        p.reads[0]({ theme: 'gold', font: 'montserrat' });
        await flush();
        p.change('theme', 'slate');
        p.change('font', 'inter');
        p.focus();
        await flush();
        expect(p.reads.length).toBe(1); // no read while saves are in flight
        while (p.pending.length) {
            p.pending.shift()();
            await flush();
            await flush();
        }
        expect(p.writes).toEqual([{ theme: 'slate', font: 'montserrat' }, { theme: 'slate', font: 'inter' }]);
        expect(p.reads.length).toBe(2);
        p.reads[1]({ theme: 'slate', font: 'inter' });
        await flush();
        expect(p.root.dataset).toEqual({ theme: 'slate', font: 'inter' });
    });

    test('a focus read applies a change made elsewhere', async () => {
        const p = load();
        await flush();
        p.reads[0]({ theme: 'gold', font: 'montserrat' });
        p.focus();
        await flush();
        p.reads[1]({ theme: 'classic', font: 'runescape' });
        await flush();
        expect(p.root.dataset).toEqual({ theme: 'classic', font: 'runescape' });
    });
});
