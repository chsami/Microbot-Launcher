const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cheerio = require('cheerio');
const { TEXT, characterView, offersCharacters, cardView } = require('../runelite-loader-card.js');

const CHARACTERS = {
    characters: [
        { accountId: 'char-new', displayName: 'Lynx Titan', proxy: '203.0.113.7' },
        { accountId: 'char-old', displayName: 'Zezima', proxy: null }
    ],
    chosen: null
};

describe('character picker data', () => {
    test('None comes first, then the characters in the order the launcher sends them', () => {
        expect(characterView(CHARACTERS)).toEqual({
            options: [
                { value: '', label: 'None: log in inside RuneLite' },
                { value: 'char-new', label: 'Lynx Titan' },
                { value: 'char-old', label: 'Zezima' }
            ],
            value: '',
            name: null,
            warning: '',
            addLabel: 'Add Jagex account'
        });
    });

    test('without characters only None is offered', () => {
        expect(characterView(null).options).toEqual([{ value: '', label: TEXT.none }]);
        expect(characterView({ characters: [], chosen: 'char-old' }).value).toBe('');
    });

    test('a chosen character with a proxy warns that RuneLite starts without it', () => {
        const view = characterView({ ...CHARACTERS, chosen: 'char-new' });

        expect(view.value).toBe('char-new');
        expect(view.warning).toBe('Lynx Titan is set to play from 203.0.113.7; Microbot in RuneLite starts RuneLite without that proxy.');
        expect(characterView({ ...CHARACTERS, chosen: 'char-old' }).warning).toBe('');
    });

    test('after an expired login the add button offers to log in again', () => {
        expect(characterView(CHARACTERS, { relogin: true }).addLabel).toBe('Log in again');
    });

    test('the picker is offered only where the card can open RuneLite', () => {
        expect(offersCharacters(cardView({ visible: true, state: 'added', opener: 'open' }))).toBe(true);
        expect(offersCharacters(cardView({ visible: true, state: 'added', opener: 'find' }))).toBe(true);
        expect(offersCharacters(cardView({ visible: true, state: 'switched-off', opener: 'open' }))).toBe(true);
        expect(offersCharacters(cardView({ visible: true, state: 'not-added' }))).toBe(false);
        expect(offersCharacters(cardView({ visible: true, state: 'update', reason: 'new-version' }))).toBe(false);
        expect(offersCharacters(cardView({ visible: true, state: 'remove-only' }))).toBe(false);
        expect(offersCharacters(cardView({ visible: true, state: 'working' }))).toBe(false);
        expect(offersCharacters(cardView({ visible: false }))).toBe(false);
    });
});

describe('character picker on the card', () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
    afterEach(() => jest.useRealTimers());

    const flush = async () => {
        for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    };

    function fakeElement(extra = {}) {
        const listeners = {};
        const classes = new Set();
        const attributes = {};
        const element = {
            hidden: true,
            disabled: false,
            textContent: '',
            value: '',
            dataset: {},
            children: [],
            classList: {
                toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
                contains: (name) => classes.has(name)
            },
            setAttribute: (name, value) => (attributes[name] = value),
            getAttribute: (name) => attributes[name],
            addEventListener: (type, fn) => (listeners[type] = fn),
            replaceChildren: (...children) => (element.children = children),
            click() {
                return listeners.click?.();
            },
            change(value) {
                element.value = value;
                return listeners.change?.({ target: element });
            },
            ...extra
        };
        return element;
    }

    function loadCard({ state, characters = CHARACTERS, openResult = { ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.' }, runJagexLogin, characterApi = true } = {}) {
        const ids = [
            'launcher-mode',
            'runelite-view',
            'runelite-loader',
            'runelite-loader-hint',
            'runelite-loader-note',
            'runelite-loader-starts',
            'runelite-loader-starts-label',
            'runelite-loader-change',
            'runelite-loader-open',
            'runelite-loader-error',
            'runelite-loader-action',
            'runelite-loader-remove',
            'runelite-loader-character',
            'runelite-loader-character-select',
            'runelite-loader-add-account',
            'runelite-loader-character-warning'
        ];
        const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
        let data = JSON.parse(JSON.stringify(characters));
        const hints = [];
        const runeliteLoader = {
            state: jest.fn(async () => state || { visible: true, state: 'added', opener: 'open', mode: 'runelite' }),
            install: jest.fn(),
            remove: jest.fn(),
            open: jest.fn(async () => {
                hints.push(elements['runelite-loader-hint'].textContent);
                return openResult;
            }),
            find: jest.fn(async () => ({ cancelled: true })),
            setMode: jest.fn(async (mode) => ({ mode })),
            characters: jest.fn(async () => data),
            setCharacter: jest.fn(async (accountId) => {
                data = { ...data, chosen: accountId };
                return data;
            }),
            onProgress: jest.fn()
        };
        if (!characterApi) {
            delete runeliteLoader.characters;
            delete runeliteLoader.setCharacter;
        }
        const window = {
            electron: { runeliteLoader, logError: jest.fn(), ipcRenderer: { receive: () => {} } },
            runJagexLogin
        };
        const context = vm.createContext({
            setTimeout: (...args) => setTimeout(...args),
            clearTimeout: (...args) => clearTimeout(...args),
            URL,
            window,
            document: {
                getElementById: (id) => elements[id] || null,
                querySelector: () => null,
                querySelectorAll: () => [],
                createElement: () => fakeElement()
            }
        });
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'runelite-loader-card.js'), 'utf8'), context);
        return {
            elements,
            runeliteLoader,
            hints,
            setData: (next) => (data = next),
            labels: () => elements['runelite-loader-character-select'].children.map((option) => option.textContent)
        };
    }

    test('shows None and the characters when RuneLite can be opened', async () => {
        const card = loadCard();
        await flush();

        expect(card.elements['runelite-loader-character'].hidden).toBe(false);
        expect(card.labels()).toEqual(['None: log in inside RuneLite', 'Lynx Titan', 'Zezima']);
        expect(card.elements['runelite-loader-character-select'].value).toBe('');
        expect(card.elements['runelite-loader-add-account'].textContent).toBe('Add Jagex account');
    });

    test('stays hidden before Microbot is added to RuneLite', async () => {
        const card = loadCard({ state: { visible: true, state: 'not-added', mode: 'runelite' } });
        await flush();

        expect(card.elements['runelite-loader-character'].hidden).toBe(true);
    });

    test('the remembered choice is selected', async () => {
        const card = loadCard({ characters: { ...CHARACTERS, chosen: 'char-old' } });
        await flush();

        expect(card.elements['runelite-loader-character-select'].value).toBe('char-old');
        expect(card.elements['runelite-loader-character-warning'].textContent).toBe('');
    });

    test('picking a character saves it and shows the proxy warning, and RuneLite can still be opened', async () => {
        const card = loadCard();
        await flush();

        card.elements['runelite-loader-character-select'].change('char-new');
        await flush();

        expect(card.runeliteLoader.setCharacter).toHaveBeenCalledWith('char-new');
        expect(card.elements['runelite-loader-character-warning'].textContent).toBe(
            'Lynx Titan is set to play from 203.0.113.7; Microbot in RuneLite starts RuneLite without that proxy.'
        );
        expect(card.elements['runelite-loader-action'].disabled).toBe(false);

        card.elements['runelite-loader-action'].click();
        await flush();

        expect(card.runeliteLoader.open).toHaveBeenCalledTimes(1);
        expect(card.hints).toEqual(["Checking Lynx Titan's Jagex login..."]);
    });

    test('picking None saves null', async () => {
        const card = loadCard({ characters: { ...CHARACTERS, chosen: 'char-old' } });
        await flush();

        card.elements['runelite-loader-character-select'].change('');
        await flush();

        expect(card.runeliteLoader.setCharacter).toHaveBeenCalledWith(null);
        expect(card.elements['runelite-loader-character-select'].value).toBe('');
    });

    test('Open RuneLite waits for a choice that is still being saved', async () => {
        const card = loadCard();
        await flush();
        let release;
        card.runeliteLoader.setCharacter.mockImplementation(
            (accountId) => new Promise((resolve) => (release = () => resolve({ ...CHARACTERS, chosen: accountId })))
        );

        card.elements['runelite-loader-character-select'].change('char-old');
        card.elements['runelite-loader-action'].click();
        await flush();
        expect(card.runeliteLoader.open).not.toHaveBeenCalled();

        release();
        await flush();
        expect(card.runeliteLoader.open).toHaveBeenCalledTimes(1);
    });

    test('an expired login shows the message and turns the add button into Log in again', async () => {
        const error = "Zezima's Jagex login has expired. Press Log in again, then open RuneLite.";
        const card = loadCard({ characters: { ...CHARACTERS, chosen: 'char-old' }, openResult: { ok: false, error, relogin: true } });
        await flush();

        card.elements['runelite-loader-action'].click();
        await flush();

        expect(card.elements['runelite-loader-error'].textContent).toBe(error);
        expect(card.elements['runelite-loader-hint'].textContent).toBe(TEXT.added);
        expect(card.elements['runelite-loader-add-account'].textContent).toBe('Log in again');
    });

    test('Add Jagex account runs the sidebar login on this button and refreshes the picker', async () => {
        const runJagexLogin = jest.fn(async (button) => {
            button.textContent = 'Cancel login';
        });
        const card = loadCard({ runJagexLogin });
        await flush();
        card.setData({ characters: [...CHARACTERS.characters, { accountId: 'char-added', displayName: 'Woox', proxy: null }], chosen: null });

        await card.elements['runelite-loader-add-account'].click();
        await flush();

        expect(runJagexLogin).toHaveBeenCalledWith(card.elements['runelite-loader-add-account']);
        expect(card.labels()).toEqual(['None: log in inside RuneLite', 'Lynx Titan', 'Zezima', 'Woox']);
        expect(card.elements['runelite-loader-add-account'].textContent).toBe('Add Jagex account');
    });

    test('a second click on Add while logging in cancels through the same login', async () => {
        let finish;
        const runJagexLogin = jest.fn((button) => (runJagexLogin.mock.calls.length === 1 ? new Promise((resolve) => (finish = resolve)) : Promise.resolve()));
        const card = loadCard({ runJagexLogin });
        await flush();

        card.elements['runelite-loader-add-account'].click();
        await flush();
        expect(card.elements['runelite-loader-character-select'].disabled).toBe(true);
        card.elements['runelite-loader-add-account'].click();
        await flush();

        expect(runJagexLogin).toHaveBeenCalledTimes(2);
        expect(runJagexLogin.mock.calls[1][0]).toBe(card.elements['runelite-loader-add-account']);
        finish();
        await flush();
        expect(card.elements['runelite-loader-character-select'].disabled).toBe(false);
    });

    test('without the character calls (older main process) the card still works', async () => {
        const card = loadCard({ characterApi: false });
        await flush();

        expect(card.elements['runelite-loader-action'].textContent).toBe('Open RuneLite');
        expect(card.labels()).toEqual(['None: log in inside RuneLite']);
        card.elements['runelite-loader-action'].click();
        await flush();
        expect(card.runeliteLoader.open).toHaveBeenCalledTimes(1);
        expect(card.hints).toEqual([TEXT.added]);
    });
});

describe('character picker markup', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const $ = cheerio.load(html);

    test('sits inside the card, hidden until the card shows it', () => {
        expect($('#runelite-loader #runelite-loader-character').length).toBe(1);
        expect($('#runelite-loader-character').attr('hidden')).toBeDefined();
        expect($('#runelite-loader-character label').attr('for')).toBe('runelite-loader-character-select');
        expect($('#runelite-loader-character select#runelite-loader-character-select').length).toBe(1);
        expect($('#runelite-loader-add-account').text().trim()).toBe('Add Jagex account');
        expect($('#runelite-loader-add-account').attr('type')).toBe('button');
    });

    test('the preload exposes the two character calls', () => {
        const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
        expect(preload).toContain("characters: () => ipcRenderer.invoke('runelite-loader:characters')");
        expect(preload).toContain("setCharacter: (accountId) => ipcRenderer.invoke('runelite-loader:set-character', accountId)");
    });

    test('the sidebar login the card reuses is a page-wide function', () => {
        const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
        expect(renderer).toMatch(/^async function runJagexLogin\(button\)/m);
    });
});
