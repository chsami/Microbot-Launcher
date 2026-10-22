const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'profiles-screen.js'), 'utf8');

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = {};
        this.dataset = {};
        this.listeners = {};
        this.className = '';
        this.text = '';
        this.parentNode = null;
        const element = this;
        this.classList = {
            add: (...names) => names.forEach((name) => element.setClass(name, true)),
            remove: (...names) => names.forEach((name) => element.setClass(name, false)),
            toggle: (name, force) => element.setClass(name, force === undefined ? !element.classList.contains(name) : Boolean(force)),
            contains: (name) => element.className.split(/\s+/).includes(name)
        };
    }

    setClass(name, on) {
        const names = this.className.split(/\s+/).filter((existing) => existing && existing !== name);
        if (on) names.push(name);
        this.className = names.join(' ');
    }

    get textContent() {
        return this.text + this.children.map((child) => child.textContent).join('');
    }

    set textContent(value) {
        this.text = String(value);
        this.children = [];
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name.startsWith('data-')) {
            this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
        }
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    append(...children) {
        children.forEach((child) => this.appendChild(child));
    }

    prepend(child) {
        child.parentNode = this;
        this.children.unshift(child);
    }

    replaceChildren(...children) {
        this.children = [];
        this.append(...children);
    }

    addEventListener(type, listener) {
        (this.listeners[type] = this.listeners[type] || []).push(listener);
    }

    removeEventListener() {}

    closest(selector) {
        let node = this;
        while (node && node.tagName !== selector) node = node.parentNode;
        return node;
    }

    focus() {}

    select() {}

    findAll(predicate, found = []) {
        if (predicate(this)) found.push(this);
        this.children.forEach((child) => child.findAll(predicate, found));
        return found;
    }
}

const textNode = (value) => Object.assign(new FakeElement('#text'), { text: String(value) });

const createScreen = (electron) => {
    const elements = new Map();
    const document = {
        getElementById: (id) => {
            if (!elements.has(id)) elements.set(id, new FakeElement(id === 'profile' ? 'select' : 'div'));
            return elements.get(id);
        },
        createElement: (tagName) => new FakeElement(tagName),
        createElementNS: (_namespace, tagName) => new FakeElement(tagName),
        createTextNode: textNode,
        querySelector: () => null,
        addEventListener: () => {},
        removeEventListener: () => {}
    };
    const context = {
        window: { electron },
        document,
        CSS: { escape: (value) => value },
        requestAnimationFrame: (callback) => callback(),
        Event: class {},
        Option: class {}
    };
    vm.runInNewContext(SOURCE, context);
    const list = document.getElementById('profiles-list');
    return {
        open: () => document.getElementById('manage-profiles').listeners.click[0](),
        hints: () => list.findAll((node) => node.className === 'profile-alerts-hint').map((node) => node.textContent),
        click: async (target) => {
            list.listeners.click[0]({ target });
            await new Promise((resolve) => setImmediate(resolve));
        },
        toggle: (name) => list.findAll((node) => node.dataset.action === 'alerts' && node.dataset.name === name)[0]
    };
};

describe('profiles screen alert name hint', () => {
    let electron;

    beforeEach(() => {
        electron = {
            listProfiles: jest.fn().mockResolvedValue(['Main', 'Ironman']),
            auth: { status: jest.fn().mockResolvedValue({ authenticated: true, user: { email: 'player@example.com' } }) },
            alerts: {
                status: jest.fn().mockResolvedValue({
                    signedIn: true,
                    available: true,
                    enabled: { default: true, Main: true, Ironman: true },
                    labels: { default: 'Microbot client', Main: 'Main PC' }
                }),
                setEnabled: jest.fn().mockResolvedValue({ enabled: false, label: 'Microbot client' })
            }
        };
    });

    test('each profile with alerts on shows the name its alerts use', async () => {
        const screen = createScreen(electron);

        await screen.open();

        expect(screen.hints()).toEqual([
            'Shows up as "Microbot client" in alerts. Rename it on the dashboard.',
            'Shows up as "Microbot client" in alerts. Rename it on the dashboard.',
            'Shows up as "Main PC" in alerts. Rename it on the dashboard.'
        ]);
    });

    test('switching alerts off hides the hint and on again shows the name its alerts use', async () => {
        const screen = createScreen(electron);
        await screen.open();

        await screen.click(screen.toggle('Main'));

        expect(electron.alerts.setEnabled).toHaveBeenCalledWith('Main', false);
        expect(screen.hints()).toEqual([
            'Shows up as "Microbot client" in alerts. Rename it on the dashboard.',
            'Shows up as "Microbot client" in alerts. Rename it on the dashboard.'
        ]);

        electron.alerts.setEnabled.mockResolvedValue({ enabled: true, label: 'Microbot client 3' });
        await screen.click(screen.toggle('Main'));

        expect(electron.alerts.setEnabled).toHaveBeenLastCalledWith('Main', true);
        expect(screen.hints()).toContain('Shows up as "Microbot client 3" in alerts. Rename it on the dashboard.');
    });

    test('signed out shows no hint', async () => {
        electron.alerts.status.mockResolvedValue({ signedIn: false, available: false, enabled: {}, labels: {} });
        const screen = createScreen(electron);

        await screen.open();

        expect(screen.hints()).toEqual([]);
    });
});
