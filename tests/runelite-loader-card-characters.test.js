const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cheerio = require('cheerio');
const { TEXT, characterView, offersCharacters, cardView } = require('../runelite-loader-card.js');

const CHARACTERS = {
    characters: [
        { accountId: 'char-new', displayName: 'Lynx Titan', proxy: { host: '203.0.113.7' } },
        { accountId: 'char-odd', displayName: 'Odd', proxy: { host: null } },
        { accountId: 'char-old', displayName: 'Zezima', proxy: null }
    ],
    chosen: null,
    picked: true,
    missing: null,
    proxiesSaved: true
};

const PROXY_WARNING =
    "Lynx Titan uses the proxy 203.0.113.7 in the Microbot client. RuneLite doesn't use proxies, so Lynx Titan will connect from your own IP. To keep the proxy, play Lynx Titan in the Microbot client.";

describe('character picker data', () => {
    test('None comes first, then the characters in the order the launcher sends them', () => {
        expect(characterView(CHARACTERS)).toEqual({
            options: [
                { value: '', label: "None (I'll log in inside RuneLite)" },
                { value: 'char-new', label: 'Lynx Titan' },
                { value: 'char-odd', label: 'Odd' },
                { value: 'char-old', label: 'Zezima' }
            ],
            value: '',
            name: null,
            warning: '',
            relogin: false,
            loginFor: null,
            addLabel: 'Add Jagex account',
            addTitle: '',
            addNote: 'Logs in from your own IP.'
        });
    });

    test('without characters only None is offered', () => {
        expect(characterView(null).options).toEqual([{ value: '', label: TEXT.none }]);
        expect(characterView({ characters: [], chosen: 'char-old' }).value).toBe('');
    });

    test('a chosen character with a proxy explains that RuneLite connects from the member’s own IP', () => {
        expect(characterView({ ...CHARACTERS, chosen: 'char-new' }).warning).toBe(PROXY_WARNING);
        expect(characterView({ ...CHARACTERS, chosen: 'char-odd' }).warning).toBe(
            "Odd uses a proxy in the Microbot client. RuneLite doesn't use proxies, so Odd will connect from your own IP. To keep the proxy, play Odd in the Microbot client."
        );
        expect(characterView({ ...CHARACTERS, chosen: 'char-old' }).warning).toBe('');
    });

    test('Log in again belongs to the expired character only', () => {
        const expired = ['char-new'];

        expect(characterView({ ...CHARACTERS, chosen: 'char-new' }, { expired })).toMatchObject({
            relogin: true,
            loginFor: 'char-new',
            addLabel: 'Log in again',
            addTitle: 'Log in to the Jagex account that has Lynx Titan.',
            addNote: 'Logs in through 203.0.113.7.'
        });
        expect(characterView({ ...CHARACTERS, chosen: 'char-old' }, { expired })).toMatchObject({ relogin: false, loginFor: null, addLabel: 'Add Jagex account' });
        expect(characterView({ ...CHARACTERS, chosen: 'char-old' }, { expired: ['char-old'] }).addNote).toBe('Logs in from your own IP.');
    });

    test('a picked character that left the launcher stays selected with a hint', () => {
        const view = characterView({ ...CHARACTERS, missing: 'char-gone' });

        expect(view.options.at(-1)).toEqual({ value: 'char-gone', label: 'Character no longer in the launcher' });
        expect(view.value).toBe('char-gone');
        expect(view.warning).toBe('That character is no longer in the launcher. Add its Jagex account again, or choose None.');
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
            title: '',
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

    function loadCard({ state, characters = CHARACTERS, openResult = { ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.' }, characterApi = true } = {}) {
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
            'runelite-loader-add-note',
            'runelite-loader-character-warning',
            'runelite-loader-character-message'
        ];
        const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
        let data = JSON.parse(JSON.stringify(characters));
        let launchStatus = null;
        const hints = [];
        const runeliteLoader = {
            state: jest.fn(async () => state || { visible: true, state: 'added', opener: 'open', mode: 'runelite' }),
            install: jest.fn(),
            remove: jest.fn(),
            open: jest.fn(async () => {
                launchStatus?.({ text: "Checking Lynx Titan's Jagex login..." });
                hints.push(elements['runelite-loader-hint'].textContent);
                return typeof openResult === 'function' ? openResult() : openResult;
            }),
            find: jest.fn(async () => ({ cancelled: true })),
            setMode: jest.fn(async (mode) => ({ mode })),
            characters: jest.fn(async () => data),
            setCharacter: jest.fn(async (accountId) => {
                data = { ...data, chosen: accountId, picked: true };
                return data;
            }),
            login: jest.fn(async () => data),
            onLaunchStatus: jest.fn((fn) => (launchStatus = fn)),
            onProgress: jest.fn()
        };
        if (!characterApi) {
            ['characters', 'setCharacter', 'login', 'onLaunchStatus'].forEach((name) => delete runeliteLoader[name]);
        }
        const window = { electron: { runeliteLoader, logError: jest.fn(), cancelAuthFlow: jest.fn(async () => true), ipcRenderer: { receive: () => {} } } };
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
            window,
            hints,
            setData: (next) => (data = next),
            labels: () => elements['runelite-loader-character-select'].children.map((option) => option.textContent),
            add: () => elements['runelite-loader-add-account']
        };
    }

    test('shows None and the characters when RuneLite can be opened, with the IP note', async () => {
        const card = loadCard();
        await flush();

        expect(card.elements['runelite-loader-character'].hidden).toBe(false);
        expect(card.labels()).toEqual(["None (I'll log in inside RuneLite)", 'Lynx Titan', 'Odd', 'Zezima']);
        expect(card.elements['runelite-loader-character-select'].value).toBe('');
        expect(card.add().textContent).toBe('Add Jagex account');
        expect(card.elements['runelite-loader-add-note'].textContent).toBe('Logs in from your own IP.');
    });

    test('stays hidden before Microbot is added to RuneLite', async () => {
        const card = loadCard({ state: { visible: true, state: 'not-added', mode: 'runelite' } });
        await flush();

        expect(card.elements['runelite-loader-character'].hidden).toBe(true);
    });

    test('never picked shows the login file’s character as last used, and picking that character is a choice', async () => {
        const card = loadCard({ characters: { ...CHARACTERS, chosen: 'char-old', picked: false } });
        await flush();

        expect(card.elements['runelite-loader-character-select'].value).toBe('auto:char-old');
        expect(card.labels()).toEqual([TEXT.none, 'Zezima (last used)', 'Lynx Titan', 'Odd', 'Zezima']);

        card.elements['runelite-loader-character-select'].change('auto:char-old');
        await flush();
        expect(card.runeliteLoader.setCharacter).not.toHaveBeenCalled();

        card.elements['runelite-loader-character-select'].change('char-old');
        await flush();
        expect(card.runeliteLoader.setCharacter).toHaveBeenCalledWith('char-old');
        expect(card.labels()).toEqual([TEXT.none, 'Lynx Titan', 'Odd', 'Zezima']);
        expect(card.elements['runelite-loader-character-select'].value).toBe('char-old');
    });

    test('never picked with an expired login file starts RuneLite, shows the note and offers Log in again', async () => {
        const notice = "Zezima's saved login has expired; RuneLite will open on its login screen. Press Log in again to renew it.";
        const card = loadCard({
            characters: { ...CHARACTERS, chosen: 'char-old', picked: false },
            openResult: { ok: true, message: 'RuneLite is starting. Microbot will be in the sidebar.', notice, relogin: true, accountId: 'char-old' }
        });
        await flush();

        card.elements['runelite-loader-action'].click();
        await flush();

        expect(card.elements['runelite-loader-hint'].textContent).toBe('RuneLite is starting. Microbot will be in the sidebar.');
        expect(card.elements['runelite-loader-error'].textContent).toBe('');
        expect(card.elements['runelite-loader-character-message'].textContent).toBe(notice);
        expect(card.add().textContent).toBe('Log in again');
        await card.add().click();
        await flush();
        expect(card.runeliteLoader.login).toHaveBeenCalledWith('char-old');
    });

    test('the own-IP note shows only when the launcher has saved proxies', async () => {
        const card = loadCard({ characters: { ...CHARACTERS, characters: [CHARACTERS.characters[2]], proxiesSaved: false } });
        await flush();

        expect(card.elements['runelite-loader-add-note'].textContent).toBe('');
    });

    test('a missing character’s sentence shows once when the start fails with it', async () => {
        const sentence = 'That character is no longer in the launcher. Add its Jagex account again, or choose None.';
        const card = loadCard({ characters: { ...CHARACTERS, missing: 'char-gone' }, openResult: { ok: false, error: sentence } });
        await flush();
        expect(card.elements['runelite-loader-character-warning'].textContent).toBe(sentence);

        card.elements['runelite-loader-action'].click();
        await flush();

        expect(card.elements['runelite-loader-error'].textContent).toBe(sentence);
        expect(card.elements['runelite-loader-character-warning'].textContent).toBe('');
    });

    test('Add that finds no new characters says the logins were renewed', async () => {
        const card = loadCard();
        await flush();
        card.runeliteLoader.login.mockResolvedValueOnce({ ...CHARACTERS, added: 0, renewed: false });

        await card.add().click();
        await flush();

        expect(card.elements['runelite-loader-character-message'].textContent).toBe("No new characters. Your existing characters' logins were renewed.");
    });

    test('Log in again with a login that did not include the character says so', async () => {
        const sentence = "That login didn't include Zezima. Log in to the Jagex account that has Zezima.";
        const card = loadCard({
            characters: { ...CHARACTERS, chosen: 'char-old' },
            openResult: { ok: false, error: "Zezima's Jagex login has expired. Press Log in again, then press Open RuneLite.", relogin: true, accountId: 'char-old' }
        });
        await flush();
        card.elements['runelite-loader-action'].click();
        await flush();
        card.runeliteLoader.login.mockResolvedValueOnce({ ...CHARACTERS, chosen: 'char-old', added: 0, renewed: false, error: sentence });

        await card.add().click();
        await flush();

        expect(card.elements['runelite-loader-error'].textContent).toBe(sentence);
        expect(card.elements['runelite-loader-character-message'].textContent).toBe('');
        expect(card.add().textContent).toBe('Log in again');
    });

    test('picking a character saves it and shows the proxy warning, and RuneLite can still be opened', async () => {
        const card = loadCard();
        await flush();

        card.elements['runelite-loader-character-select'].change('char-new');
        await flush();

        expect(card.runeliteLoader.setCharacter).toHaveBeenCalledWith('char-new');
        expect(card.elements['runelite-loader-character-warning'].textContent).toBe(PROXY_WARNING);
        expect(card.elements['runelite-loader-action'].disabled).toBe(false);

        card.elements['runelite-loader-action'].click();
        await flush();

        expect(card.runeliteLoader.open).toHaveBeenCalledTimes(1);
        expect(card.hints).toEqual(["Checking Lynx Titan's Jagex login..."]);
    });

    test('picking None saves null', async () => {
        const card = loadCard({ characters: { ...CHARACTERS, chosen: 'char-old', picked: true } });
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
            (accountId) => new Promise((resolve) => (release = () => resolve({ ...CHARACTERS, chosen: accountId, picked: true })))
        );

        card.elements['runelite-loader-character-select'].change('char-old');
        card.elements['runelite-loader-action'].click();
        await flush();
        expect(card.runeliteLoader.open).not.toHaveBeenCalled();

        release();
        await flush();
        expect(card.runeliteLoader.open).toHaveBeenCalledTimes(1);
    });

    test('an expired login shows the message, turns Add into Log in again, and that follows the character', async () => {
        const error = "Zezima's Jagex login has expired. Press Log in again, then press Open RuneLite.";
        const card = loadCard({ characters: { ...CHARACTERS, chosen: 'char-old', picked: true }, openResult: { ok: false, error, relogin: true, accountId: 'char-old' } });
        await flush();

        card.elements['runelite-loader-action'].click();
        await flush();

        expect(card.elements['runelite-loader-error'].textContent).toBe(error);
        expect(card.elements['runelite-loader-hint'].textContent).toBe(TEXT.added);
        expect(card.add().textContent).toBe('Log in again');
        expect(card.add().title).toBe('Log in to the Jagex account that has Zezima.');

        card.elements['runelite-loader-character-select'].change('char-new');
        await flush();
        expect(card.add().textContent).toBe('Add Jagex account');

        card.elements['runelite-loader-character-select'].change('char-old');
        await flush();
        expect(card.add().textContent).toBe('Log in again');
    });

    test('Log in again logs in for that character and leaves the mode only when its session is renewed', async () => {
        const error = "Zezima's Jagex login has expired. Press Log in again, then press Open RuneLite.";
        const card = loadCard({ characters: { ...CHARACTERS, chosen: 'char-old', picked: true }, openResult: { ok: false, error, relogin: true, accountId: 'char-old' } });
        await flush();
        card.elements['runelite-loader-action'].click();
        await flush();

        card.runeliteLoader.login.mockResolvedValueOnce({ ...CHARACTERS, chosen: 'char-old', picked: true, added: 0, renewed: false });
        await card.add().click();
        await flush();
        expect(card.runeliteLoader.login).toHaveBeenLastCalledWith('char-old');
        expect(card.add().textContent).toBe('Log in again');

        card.runeliteLoader.login.mockResolvedValueOnce({ ...CHARACTERS, chosen: 'char-old', picked: true, added: 0, renewed: true });
        await card.add().click();
        await flush();
        expect(card.add().textContent).toBe('Add Jagex account');
    });

    test('Add Jagex account logs in from the card and shows the one new character the launcher selected', async () => {
        const card = loadCard();
        await flush();
        const added = { characters: [...CHARACTERS.characters, { accountId: 'char-woox', displayName: 'Woox', proxy: null }], chosen: 'char-woox', picked: true, added: 1, renewed: false };
        card.runeliteLoader.login.mockResolvedValueOnce(added);

        await card.add().click();
        await flush();

        expect(card.runeliteLoader.login).toHaveBeenCalledWith(null);
        expect(card.labels()).toContain('Woox');
        expect(card.elements['runelite-loader-character-select'].value).toBe('char-woox');
        expect(card.elements['runelite-loader-character-message'].textContent).toBe('');
    });

    test('several new characters ask the member to pick one', async () => {
        const card = loadCard();
        await flush();
        card.runeliteLoader.login.mockResolvedValueOnce({ ...CHARACTERS, added: 3, renewed: false });

        await card.add().click();
        await flush();

        expect(card.elements['runelite-loader-character-message'].textContent).toBe('Added 3 characters. Pick one under Log in as.');
    });

    test('a login already open shows one sentence', async () => {
        const card = loadCard();
        await flush();
        card.runeliteLoader.login.mockResolvedValueOnce({ ...CHARACTERS, error: 'A Jagex login is already open in your browser.' });

        await card.add().click();
        await flush();

        expect(card.elements['runelite-loader-error'].textContent).toBe('A Jagex login is already open in your browser.');
    });

    test('a second click while logging in cancels the login', async () => {
        const card = loadCard();
        await flush();
        let finish;
        card.runeliteLoader.login.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve({ ...CHARACTERS, cancelled: true }))));

        card.add().click();
        await flush();
        expect(card.add().textContent).toBe('Cancel login');
        expect(card.elements['runelite-loader-character-select'].disabled).toBe(true);

        card.add().click();
        await flush();
        expect(card.window.electron.cancelAuthFlow).toHaveBeenCalledTimes(1);
        expect(card.runeliteLoader.login).toHaveBeenCalledTimes(1);

        finish();
        await flush();
        expect(card.add().textContent).toBe('Add Jagex account');
        expect(card.elements['runelite-loader-character-select'].disabled).toBe(false);
    });

    test('the result is shown on the latest card state, not the one from before the check', async () => {
        const card = loadCard({
            characters: { ...CHARACTERS, chosen: 'char-old', picked: true },
            openResult: () => ({ ok: true, message: 'RuneLite is starting as Zezima. Microbot will be in the sidebar.', opener: undefined })
        });
        await flush();

        card.elements['runelite-loader-action'].click();
        await flush();

        expect(card.elements['runelite-loader-hint'].textContent).toBe('RuneLite is starting as Zezima. Microbot will be in the sidebar.');
        jest.advanceTimersByTime(6000);
        expect(card.elements['runelite-loader-hint'].textContent).toBe(TEXT.added);
    });

    test('the sidebar can refresh the picker', async () => {
        const card = loadCard();
        await flush();
        card.setData({ ...CHARACTERS, characters: [CHARACTERS.characters[2]] });

        await card.window.refreshRuneliteCharacters();

        expect(card.labels()).toEqual([TEXT.none, 'Zezima']);
    });

    test('without the character calls (older main process) the card still works', async () => {
        const card = loadCard({ characterApi: false });
        await flush();

        expect(card.elements['runelite-loader-action'].textContent).toBe('Open RuneLite');
        expect(card.labels()).toEqual([TEXT.none]);
        card.elements['runelite-loader-action'].click();
        await flush();
        expect(card.runeliteLoader.open).toHaveBeenCalledTimes(1);
        expect(card.hints).toEqual([TEXT.added]);
    });
});

describe('character picker markup and wiring', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const $ = cheerio.load(html);

    test('sits inside the card, hidden until the card shows it', () => {
        expect($('#runelite-loader #runelite-loader-character').length).toBe(1);
        expect($('#runelite-loader-character').attr('hidden')).toBeDefined();
        expect($('#runelite-loader-character label').attr('for')).toBe('runelite-loader-character-select');
        expect($('#runelite-loader-character select#runelite-loader-character-select').length).toBe(1);
        expect($('#runelite-loader-add-account').text().trim()).toBe('Add Jagex account');
        expect($('#runelite-loader-add-account').attr('type')).toBe('button');
        expect($('#runelite-loader-character #runelite-loader-add-note').length).toBe(1);
        expect($('#runelite-loader-character #runelite-loader-character-message').length).toBe(1);
    });

    test('the preload exposes the character calls', () => {
        const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
        expect(preload).toContain("characters: () => ipcRenderer.invoke('runelite-loader:characters')");
        expect(preload).toContain("setCharacter: (accountId) => ipcRenderer.invoke('runelite-loader:set-character', accountId)");
        expect(preload).toContain("login: (accountId) => ipcRenderer.invoke('runelite-loader:login', accountId)");
        expect(preload).toContain("ipcRenderer.on('runelite-loader:launch-status'");
    });

    test('the sidebar refreshes the picker wherever it changes accounts', () => {
        const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
        const calls = renderer.split('window.refreshRuneliteCharacters?.()').length - 1;
        expect(calls).toBe(5);
        expect(renderer).toMatch(/startAuthFlow\(getProxyValues\(\)\);\r?\n\s*window\.refreshRuneliteCharacters\?\.\(\);/);
        expect(renderer).toMatch(/deleteAccount\(accountId\);\r?\n\s*window\.refreshRuneliteCharacters\?\.\(\);/);
        expect(renderer).toMatch(/removeAccounts\(\);\r?\n\s*window\.refreshRuneliteCharacters\?\.\(\);/);
        expect(renderer).toMatch(/refreshAccounts\(getProxyValues\(\)\);\r?\n\s*window\.refreshRuneliteCharacters\?\.\(\);/);
        expect(renderer).toMatch(/if \(hasChanged\) \{\r?\n\s*window\.refreshRuneliteCharacters\?\.\(\);/);
    });

    test('main.js gives the card the same launch queue as the client launches', () => {
        const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
        const handlers = fs.readFileSync(path.join(__dirname, '..', 'libs', 'ipc-handlers.js'), 'utf8');
        expect(main).toContain("launchQueue: require(path.join(__dirname, 'libs', 'launch-queue.js'))()");
        expect(main).toContain('launchQueue: deps.launchQueue,');
        expect(handlers).toContain("const launchQueue = deps.launchQueue || require(path.join(projectDir, 'libs', 'launch-queue.js'))();");
    });
});
