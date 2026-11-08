const { TEXT, cardView } = require('../runelite-loader-card.js');

describe('Microbot in RuneLite card', () => {
    test('hidden unless the launcher says it is available', () => {
        expect(cardView(null)).toEqual({ hidden: true });
        expect(cardView({ visible: false })).toEqual({ hidden: true });
        expect(cardView({ visible: false, error: 'Sign in to your Microbot account first.' })).toEqual({ hidden: true });
    });

    test('not added offers the one button', () => {
        expect(cardView({ visible: true, state: 'not-added' })).toEqual({
            hidden: false,
            hint: '',
            button: 'Add Microbot to my RuneLite',
            remove: false,
            error: ''
        });
    });

    test('working shows the progress text and no buttons', () => {
        expect(cardView({ visible: true, state: 'working', progress: 'Downloading Microbot...' })).toMatchObject({
            hint: 'Downloading Microbot...',
            button: null,
            remove: false
        });
        expect(cardView({ visible: true, state: 'working' }).hint).toBe(TEXT.working);
    });

    test('added says how to use it and offers removal', () => {
        expect(cardView({ visible: true, state: 'added' })).toMatchObject({
            hint: 'Added. Open RuneLite the usual way; Microbot is in the sidebar.',
            button: null,
            remove: true
        });
    });

    test('update offers Update and removal', () => {
        expect(cardView({ visible: true, state: 'update', reason: 'new-version' })).toMatchObject({ button: 'Update', remove: true, hint: TEXT.newVersion });
        expect(cardView({ visible: true, state: 'update', reason: 'signed-out' })).toMatchObject({ button: 'Update', hint: TEXT.signedOut });
    });

    test('errors show under the hint', () => {
        expect(cardView({ visible: true, state: 'not-added', error: 'Close RuneLite first, then try again.' }).error).toBe('Close RuneLite first, then try again.');
    });
});

describe('Microbot client / Microbot in RuneLite switch', () => {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const cheerio = require('cheerio');
    const { layout } = require('../runelite-loader-card.js');

    const LEGACY_CONTROLS = [
        'play',
        'play-no-jagex-account',
        'add-accounts',
        'logout',
        'channel-stable',
        'channel-nightly',
        'client',
        'load-custom-client',
        'accounts-dropdown-container',
        'refresh-accounts',
        'profile',
        'manage-profiles',
        'client-ram',
        'hwid-spoof',
        'proxy-ip',
        'manage-proxies'
    ];

    function fakeElement(extra = {}) {
        const listeners = {};
        const classes = new Set();
        const attributes = {};
        return {
            hidden: true,
            disabled: false,
            textContent: '',
            dataset: {},
            classList: {
                toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
                contains: (name) => classes.has(name)
            },
            setAttribute: (name, value) => (attributes[name] = value),
            getAttribute: (name) => attributes[name],
            addEventListener: (type, fn) => (listeners[type] = fn),
            click() {
                listeners.click?.();
            },
            ...extra
        };
    }

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    function loadCard(states) {
        const ids = ['launcher-mode', 'runelite-view', 'runelite-loader', 'runelite-loader-hint', 'runelite-loader-error', 'runelite-loader-action', 'runelite-loader-remove'];
        const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
        const options = [fakeElement({ dataset: { mode: 'client' } }), fakeElement({ dataset: { mode: 'runelite' } })];
        const sidebar = fakeElement();
        let onAuthChanged = null;
        const runeliteLoader = {
            state: jest.fn(async () => states.shift()),
            install: jest.fn(),
            remove: jest.fn(),
            setMode: jest.fn(async (mode) => ({ mode })),
            onProgress: jest.fn()
        };
        const context = vm.createContext({
            window: {
                electron: {
                    runeliteLoader,
                    logError: jest.fn(),
                    ipcRenderer: { receive: (channel, fn) => channel === 'auth:changed' && (onAuthChanged = fn) }
                }
            },
            document: {
                getElementById: (id) => elements[id] || null,
                querySelector: (selector) => (selector === '.sidebar' ? sidebar : null),
                querySelectorAll: (selector) => (selector === '.mode-option' ? options : [])
            }
        });
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'runelite-loader-card.js'), 'utf8'), context);
        const pressed = () => options.find((option) => option.getAttribute('aria-pressed') === 'true')?.dataset.mode;
        return { elements, options, sidebar, runeliteLoader, pressed, authChanged: () => onAuthChanged() };
    }

    test('layout: no switch and the Microbot client without access', () => {
        expect(layout({ visible: false }, 'runelite')).toEqual({ switchHidden: true, mode: 'client' });
        expect(layout(null, 'runelite')).toEqual({ switchHidden: true, mode: 'client' });
        expect(layout({ visible: true }, 'runelite')).toEqual({ switchHidden: false, mode: 'runelite' });
        expect(layout({ visible: true }, 'nonsense')).toEqual({ switchHidden: false, mode: 'client' });
    });

    test('without access there is no switch and the client screen stays as it is', async () => {
        const card = loadCard([{ visible: false }]);
        await flush();

        expect(card.elements['launcher-mode'].hidden).toBe(true);
        expect(card.elements['runelite-view'].hidden).toBe(true);
        expect(card.elements['runelite-loader'].hidden).toBe(true);
        expect(card.sidebar.classList.contains('mode-runelite')).toBe(false);
    });

    test('with access the switch shows, on the Microbot client by default', async () => {
        const card = loadCard([{ visible: true, state: 'not-added', mode: 'client' }]);
        await flush();

        expect(card.elements['launcher-mode'].hidden).toBe(false);
        expect(card.pressed()).toBe('client');
        expect(card.elements['runelite-view'].hidden).toBe(true);
        expect(card.sidebar.classList.contains('mode-runelite')).toBe(false);
    });

    test('the remembered choice opens on Microbot in RuneLite', async () => {
        const card = loadCard([{ visible: true, state: 'added', mode: 'runelite' }]);
        await flush();

        expect(card.pressed()).toBe('runelite');
        expect(card.elements['runelite-view'].hidden).toBe(false);
        expect(card.sidebar.classList.contains('mode-runelite')).toBe(true);
        expect(card.elements['runelite-loader-hint'].textContent).toBe(TEXT.added);
    });

    test('choosing a side saves it and switches the screen', async () => {
        const card = loadCard([{ visible: true, state: 'not-added', mode: 'client' }]);
        await flush();

        card.options[1].click();
        await flush();

        expect(card.runeliteLoader.setMode).toHaveBeenCalledWith('runelite');
        expect(card.pressed()).toBe('runelite');
        expect(card.sidebar.classList.contains('mode-runelite')).toBe(true);
        expect(card.elements['runelite-view'].hidden).toBe(false);

        card.options[0].click();
        await flush();

        expect(card.runeliteLoader.setMode).toHaveBeenLastCalledWith('client');
        expect(card.sidebar.classList.contains('mode-runelite')).toBe(false);
        expect(card.elements['runelite-view'].hidden).toBe(true);
    });

    test('when access goes away the switch disappears and the client screen comes back', async () => {
        const card = loadCard([{ visible: true, state: 'added', mode: 'runelite' }, { visible: false }]);
        await flush();
        expect(card.sidebar.classList.contains('mode-runelite')).toBe(true);

        card.authChanged();
        await flush();

        expect(card.elements['launcher-mode'].hidden).toBe(true);
        expect(card.elements['runelite-view'].hidden).toBe(true);
        expect(card.sidebar.classList.contains('mode-runelite')).toBe(false);
    });

    test('the switch cannot be used without access', async () => {
        const card = loadCard([{ visible: false }]);
        await flush();

        card.options[1].click();
        await flush();

        expect(card.runeliteLoader.setMode).not.toHaveBeenCalled();
        expect(card.sidebar.classList.contains('mode-runelite')).toBe(false);
    });

    describe('the RuneLite view hides every legacy client control', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
        const hiddenSelectors = () =>
            [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
                .filter(([, , body]) => /display:\s*none/.test(body))
                .flatMap(([, selectors]) => selectors.split(','))
                .map((selector) => selector.trim())
                .filter((selector) => selector.startsWith('.sidebar.mode-runelite'));

        const hiddenIn = (sidebarClass) => {
            const $ = cheerio.load(html);
            if (sidebarClass) $('.sidebar').addClass(sidebarClass);
            const hidden = new Set();
            hiddenSelectors().forEach((selector) => $(selector).each((_index, element) => hidden.add(element)));
            return (id) => {
                const node = $(`#${id}`);
                expect(node.length).toBe(1);
                return [node.get(0), ...node.parents().toArray()].some((element) => hidden.has(element));
            };
        };

        test('there is a rule for the RuneLite view', () => {
            expect(hiddenSelectors().length).toBeGreaterThan(0);
        });

        test.each(LEGACY_CONTROLS)('#%s is hidden in the RuneLite view', (id) => {
            expect(hiddenIn('mode-runelite')(id)).toBe(true);
        });

        test.each(LEGACY_CONTROLS)('#%s stays in the Microbot client view', (id) => {
            expect(hiddenIn(null)(id)).toBe(false);
        });

        test('the dashboard start switch is hidden in the RuneLite view and left alone in the client view', () => {
            expect(hiddenIn('mode-runelite')('remote-start-row')).toBe(true);
            expect(hiddenIn('mode-runelite')('remote-start-switch')).toBe(true);
            expect(hiddenIn(null)('remote-start-row')).toBe(false);
        });

        test('an empty card description takes no space', () => {
            expect(css).toMatch(/#runelite-loader-hint:empty\s*\{\s*display:\s*none;/);
        });

        test.each(['user-session', 'session-email', 'signout-btn', 'launcher-mode', 'runelite-view', 'runelite-loader', 'runelite-loader-action', 'launcher-update-banner'])(
            '#%s stays visible in the RuneLite view',
            (id) => {
                expect(hiddenIn('mode-runelite')(id)).toBe(false);
            }
        );

        test('the RuneLite view explains itself in one line', () => {
            const $ = cheerio.load(html);
            expect($('#runelite-view .runelite-view-intro').text().trim()).toBe(
                "Microbot runs inside the RuneLite you already use. You don't need this launcher open to play."
            );
            expect($('#runelite-view #runelite-loader').length).toBe(1);
            expect($('#launcher-mode .mode-option').map((_i, el) => $(el).text().trim()).get()).toEqual(['Microbot client', 'Microbot in RuneLite']);
            expect($('#launcher-mode').attr('hidden')).toBeDefined();
        });
    });
});
