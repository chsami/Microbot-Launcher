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
            action: 'install',
            secondary: null,
            secondaryAction: null,
            starts: '',
            change: false,
            remove: false,
            error: '',
            note: ''
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

    test('added says how to use it, offers Open RuneLite and removal', () => {
        expect(cardView({ visible: true, state: 'added', opener: 'open' })).toMatchObject({
            hint: 'Added. Open RuneLite the usual way; Microbot is in the sidebar.',
            button: 'Open RuneLite',
            action: 'open',
            remove: true
        });
    });

    test('added without a RuneLite found offers Find RuneLite…', () => {
        expect(cardView({ visible: true, state: 'added', opener: 'find' })).toMatchObject({ button: 'Find RuneLite…', action: 'find', remove: true });
    });

    test('after opening, the hint says RuneLite is starting', () => {
        expect(cardView({ visible: true, state: 'added', opener: 'open', flash: 'RuneLite is starting. Microbot will be in the sidebar.' }).hint).toBe(
            'RuneLite is starting. Microbot will be in the sidebar.'
        );
    });

    test('added while waiting for a RuneLite update shows a quiet note', () => {
        expect(cardView({ visible: true, state: 'added', note: 'not-ready' })).toMatchObject({
            hint: TEXT.added,
            note: 'Microbot is waiting for an update for the latest RuneLite.',
            button: 'Open RuneLite',
            remove: true
        });
        expect(cardView({ visible: true, state: 'added' }).note).toBe('');
    });

    test('Added names the RuneLite it starts and offers Change…', () => {
        expect(cardView({ visible: true, state: 'added', opener: 'open', starts: '~/Downloads/RuneLite.AppImage' })).toMatchObject({
            starts: 'Starts ~/Downloads/RuneLite.AppImage',
            change: true
        });
        expect(cardView({ visible: true, state: 'added', opener: 'find' })).toMatchObject({ starts: '', change: false });
    });

    test('switched off offers Turn Microbot on, Open RuneLite and Remove', () => {
        expect(cardView({ visible: true, state: 'switched-off', opener: 'open', starts: '~/Downloads/RuneLite.AppImage' })).toEqual({
            hidden: false,
            hint: 'Microbot is switched off in your RuneLite.',
            note: '',
            button: 'Turn Microbot on',
            action: 'install',
            secondary: 'Open RuneLite',
            secondaryAction: 'open',
            starts: 'Starts ~/Downloads/RuneLite.AppImage',
            change: true,
            remove: true,
            error: ''
        });
        expect(cardView({ visible: true, state: 'switched-off', opener: 'find' })).toMatchObject({ secondary: 'Find RuneLite…', secondaryAction: 'find' });
    });

    test('update offers Update and removal', () => {
        expect(cardView({ visible: true, state: 'update', reason: 'new-version' })).toMatchObject({ button: 'Update', remove: true, hint: TEXT.newVersion });
        expect(cardView({ visible: true, state: 'update', reason: 'signed-out' })).toMatchObject({ button: 'Update', hint: TEXT.signedOut });
    });

    test('Update explains when RuneLite will not load Microbot', () => {
        expect(cardView({ visible: true, state: 'update', reason: 'not-loading' })).toMatchObject({
            button: 'Update',
            hint: "RuneLite won't load Microbot right now. Press Update to fix it."
        });
    });

    test('without access but still installed, only Remove is offered', () => {
        expect(cardView({ visible: true, state: 'remove-only' })).toEqual({
            hidden: false,
            hint: 'Microbot is still in your RuneLite.',
            button: null,
            action: null,
            secondary: null,
            secondaryAction: null,
            starts: '',
            change: false,
            remove: true,
            error: '',
            note: ''
        });
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

    let openResult;
    let findResult;

    function loadCard(states) {
        const ids = ['launcher-mode', 'runelite-view', 'runelite-loader', 'runelite-loader-hint', 'runelite-loader-note', 'runelite-loader-starts', 'runelite-loader-starts-label', 'runelite-loader-change', 'runelite-loader-open', 'runelite-loader-error', 'runelite-loader-action', 'runelite-loader-remove'];
        const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
        const options = [fakeElement({ dataset: { mode: 'client' } }), fakeElement({ dataset: { mode: 'runelite' } })];
        const sidebar = fakeElement();
        let onAuthChanged = null;
        const runeliteLoader = {
            state: jest.fn(async () => states.shift()),
            install: jest.fn(),
            remove: jest.fn(),
            open: jest.fn(async () => openResult),
            find: jest.fn(async () => findResult),
            setMode: jest.fn(async (mode) => ({ mode })),
            onProgress: jest.fn()
        };
        const context = vm.createContext({
            setTimeout: (...args) => setTimeout(...args),
            clearTimeout: (...args) => clearTimeout(...args),
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

    test('remove-only opens the RuneLite view by itself', async () => {
        const card = loadCard([{ visible: true, state: 'remove-only', mode: 'runelite' }]);
        await flush();

        expect(card.elements['launcher-mode'].hidden).toBe(false);
        expect(card.pressed()).toBe('runelite');
        expect(card.elements['runelite-view'].hidden).toBe(false);
        expect(card.sidebar.classList.contains('mode-runelite')).toBe(true);
        expect(card.elements['runelite-loader-remove'].hidden).toBe(false);
        expect(card.elements['runelite-loader-action'].hidden).toBe(true);
        expect(card.runeliteLoader.setMode).not.toHaveBeenCalled();
    });

    test('Open RuneLite starts it and says so for a while', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
        try {
            openResult = { ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.' };
            const card = loadCard([{ visible: true, state: 'added', opener: 'open', mode: 'runelite' }]);
            await flush();
            const button = card.elements['runelite-loader-action'];
            expect(button.textContent).toBe('Open RuneLite');

            button.click();
            await flush();

            expect(card.runeliteLoader.open).toHaveBeenCalledTimes(1);
            expect(card.runeliteLoader.install).not.toHaveBeenCalled();
            expect(card.elements['runelite-loader-hint'].textContent).toBe('RuneLite is starting. Microbot will be in the sidebar.');
            expect(button.disabled).toBe(true);

            jest.advanceTimersByTime(6000);

            expect(card.elements['runelite-loader-hint'].textContent).toBe(TEXT.added);
            expect(button.disabled).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    test('Find RuneLite… opens the picker, and a failed start shows one sentence', async () => {
        findResult = { ok: false, opener: 'find', error: "That file can't be started. Choose RuneLite itself." };
        const card = loadCard([{ visible: true, state: 'added', opener: 'find', mode: 'runelite' }]);
        await flush();
        expect(card.elements['runelite-loader-action'].textContent).toBe('Find RuneLite…');

        card.elements['runelite-loader-action'].click();
        await flush();

        expect(card.runeliteLoader.find).toHaveBeenCalledTimes(1);
        expect(card.elements['runelite-loader-error'].textContent).toBe("That file can't be started. Choose RuneLite itself.");
    });

    test('when the found RuneLite is gone, the button turns into Find RuneLite…', async () => {
        openResult = { ok: false, opener: 'find', error: "RuneLite wasn't found on this PC. Press Find RuneLite… to choose it." };
        const card = loadCard([{ visible: true, state: 'added', opener: 'open', mode: 'runelite' }]);
        await flush();

        card.elements['runelite-loader-action'].click();
        await flush();

        expect(card.elements['runelite-loader-action'].textContent).toBe('Find RuneLite…');
        expect(card.elements['runelite-loader-error'].textContent).toBe("RuneLite wasn't found on this PC. Press Find RuneLite… to choose it.");
    });

    test('switched off: Turn Microbot on installs, the second button opens RuneLite', async () => {
        openResult = { ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.' };
        const card = loadCard([{ visible: true, state: 'switched-off', opener: 'open', starts: '~/Downloads/RuneLite.AppImage', mode: 'runelite' }]);
        card.runeliteLoader.install.mockResolvedValue({ visible: true, state: 'added', opener: 'open', starts: '~/Downloads/RuneLite.AppImage', mode: 'runelite' });
        await flush();
        expect(card.elements['runelite-loader-action'].textContent).toBe('Turn Microbot on');
        expect(card.elements['runelite-loader-open'].textContent).toBe('Open RuneLite');
        expect(card.elements['runelite-loader-starts'].hidden).toBe(false);
        expect(card.elements['runelite-loader-starts-label'].textContent).toBe('Starts ~/Downloads/RuneLite.AppImage');

        card.elements['runelite-loader-open'].click();
        await flush();
        expect(card.runeliteLoader.open).toHaveBeenCalledTimes(1);

        card.elements['runelite-loader-action'].click();
        await flush();
        expect(card.runeliteLoader.install).toHaveBeenCalledTimes(1);
    });

    test('Change… opens the picker and shows the new choice', async () => {
        findResult = { ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.', opener: 'open', starts: '~/Games/RuneLite.AppImage' };
        const card = loadCard([{ visible: true, state: 'added', opener: 'open', starts: '~/Downloads/RuneLite.AppImage', mode: 'runelite' }]);
        await flush();
        expect(card.elements['runelite-loader-change'].hidden).toBe(false);

        card.elements['runelite-loader-change'].click();
        await flush();

        expect(card.runeliteLoader.find).toHaveBeenCalledTimes(1);
        expect(card.elements['runelite-loader-starts-label'].textContent).toBe('Starts ~/Games/RuneLite.AppImage');
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
