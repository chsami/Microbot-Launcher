const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createButton(text) {
    const classes = new Set();
    return {
        textContent: text,
        title: '',
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c)
        },
        removeAttribute(name) {
            this[name] = '';
        }
    };
}

function createSelect(value = '') {
    const listeners = {};
    const select = {
        options: [],
        title: '',
        _value: value,
        get value() {
            return this._value;
        },
        set value(next) {
            this._value = this.options.some((option) => option.value === next) ? next : '';
        },
        set innerHTML(_) {
            this.options = [];
        },
        appendChild(option) {
            this.options.push(option);
        },
        addEventListener: (type, fn) => {
            listeners[type] = fn;
        },
        dispatch: (type) => listeners[type]?.({ target: select })
    };
    return select;
}

describe('renderer Jagex login button', () => {
    let electron;
    let buttons;
    let renderer;
    let finishLogin;

    beforeEach(() => {
        buttons = {
            play: createButton('Login Jagex Account'),
            'add-accounts': createButton('Add accounts')
        };
        electron = {
            startAuthFlow: jest.fn(
                () => new Promise((resolve) => (finishLogin = resolve))
            ),
            cancelAuthFlow: jest.fn(async () => {
                finishLogin({ cancelled: true });
                return true;
            }),
            errorAlert: jest.fn(),
            logError: () => {},
            ipcRenderer: { receive: () => {} }
        };
        const noop = () => {};
        const context = vm.createContext({
            window: { electron, addEventListener: noop },
            document: {
                getElementById: (id) => buttons[id] || null,
                createElement: () => ({}),
                querySelector: () => null,
                querySelectorAll: () => [],
                addEventListener: noop
            },
            console,
            sessionStorage: { getItem: () => null, setItem: noop }
        });
        const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
        vm.runInContext(
            `${source}\nglobalThis.__renderer = { runJagexLogin, addAccountsHandler };`,
            context
        );
        renderer = context.__renderer;
    });

    test('turns the button into a clickable cancel while the login is pending', async () => {
        const button = buttons['add-accounts'];
        const login = renderer.addAccountsHandler();

        expect(button.textContent).toBe('Cancel login');
        expect(button.classList.contains('disabled')).toBe(false);

        await renderer.addAccountsHandler();
        await login;

        expect(electron.cancelAuthFlow).toHaveBeenCalledTimes(1);
        expect(electron.startAuthFlow).toHaveBeenCalledTimes(1);
        expect(electron.errorAlert).not.toHaveBeenCalled();
        expect(button.textContent).toBe('Add accounts');
        expect(button.title).toBe('');
        expect(button.classList.contains('disabled')).toBe(false);
    });

    test('shows login errors and restores the button', async () => {
        const button = buttons['add-accounts'];
        const login = renderer.addAccountsHandler();
        finishLogin({ error: 'User denied' });
        await login;

        expect(electron.errorAlert).toHaveBeenCalledWith('User denied');
        expect(button.textContent).toBe('Add accounts');
    });

    test('ignores clicks on another login button while one is pending', async () => {
        const login = renderer.runJagexLogin(buttons['add-accounts']);
        await renderer.runJagexLogin(buttons.play);

        expect(electron.startAuthFlow).toHaveBeenCalledTimes(1);
        expect(electron.cancelAuthFlow).not.toHaveBeenCalled();
        expect(buttons.play.textContent).toBe('Login Jagex Account');

        finishLogin('Authentication successful.');
        await login;
    });

    test('keeps the play button text the account refresh set during login', async () => {
        const button = buttons.play;
        const login = renderer.runJagexLogin(button);
        button.textContent = 'Play With Jagex Account';
        finishLogin('Authentication successful.');
        await login;

        expect(button.textContent).toBe('Play With Jagex Account');
    });
});

describe('renderer proxy login info popup', () => {
    let electron;
    let elements;
    let renderer;
    let finishLogin;
    let properties;

    function createElement(extra = {}) {
        const classes = new Set();
        const listeners = {};
        return {
            ...createButton(''),
            classList: {
                add: (c) => classes.add(c),
                remove: (c) => classes.delete(c),
                contains: (c) => classes.has(c)
            },
            focus: jest.fn(),
            addEventListener: (type, fn) => {
                listeners[type] = fn;
            },
            click: () => listeners.click?.(),
            ...extra
        };
    }

    function loadRenderer() {
        const noop = () => {};
        const context = vm.createContext({
            window: { electron, addEventListener: noop },
            document: {
                getElementById: (id) => elements[id] || null,
                createElement: () => ({}),
                querySelector: () => null,
                querySelectorAll: () => [],
                addEventListener: noop
            },
            console,
            sessionStorage: { getItem: () => null, setItem: noop }
        });
        const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
        vm.runInContext(
            `${source}\nglobalThis.__renderer = { runJagexLogin, setupProxyInput };`,
            context
        );
        return context.__renderer;
    }

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    beforeEach(() => {
        properties = { proxyip: '1.2.3.4:1080:bob:hunter2' };
        const modal = createElement();
        modal.classList.add('auth-hidden');
        elements = {
            play: createButton('Login Jagex Account'),
            'proxy-ip': createSelect('1.2.3.4:1080:bob:hunter2'),
            'proxy-login-info-modal': modal,
            'proxy-login-info-ok': createElement(),
            'proxy-login-info-hide': { checked: false }
        };
        electron = {
            startAuthFlow: jest.fn(() => new Promise((resolve) => (finishLogin = resolve))),
            cancelAuthFlow: jest.fn(),
            readProperties: jest.fn(async () => ({ ...properties })),
            writeProperties: jest.fn(async (data) => {
                properties = data;
            }),
            errorAlert: jest.fn(),
            logError: () => {},
            ipcRenderer: { receive: () => {} }
        };
        renderer = loadRenderer();
    });

    const modalOpen = () => !elements['proxy-login-info-modal'].classList.contains('auth-hidden');

    test('explains the proxied login before the first login and waits for the user', async () => {
        const login = renderer.runJagexLogin(elements.play);
        await flush();

        expect(modalOpen()).toBe(true);
        expect(elements['proxy-login-info-ok'].focus).toHaveBeenCalled();
        expect(electron.startAuthFlow).not.toHaveBeenCalled();

        elements['proxy-login-info-ok'].click();
        await flush();

        expect(modalOpen()).toBe(false);
        expect(electron.startAuthFlow).toHaveBeenCalledWith({ proxyIp: '1.2.3.4:1080:bob:hunter2' });
        expect(electron.writeProperties).not.toHaveBeenCalled();
        finishLogin('Authentication successful.');
        await login;
    });

    test('shows the popup only once per session', async () => {
        const first = renderer.runJagexLogin(elements.play);
        await flush();
        elements['proxy-login-info-ok'].click();
        await flush();
        finishLogin('Authentication successful.');
        await first;

        const second = renderer.runJagexLogin(elements.play);

        expect(modalOpen()).toBe(false);
        expect(electron.startAuthFlow).toHaveBeenCalledTimes(2);
        finishLogin('Authentication successful.');
        await second;
    });

    test('remembers "don\'t show this again" across launcher restarts', async () => {
        const login = renderer.runJagexLogin(elements.play);
        await flush();
        elements['proxy-login-info-hide'].checked = true;
        elements['proxy-login-info-ok'].click();
        await flush();
        finishLogin('Authentication successful.');
        await login;

        expect(properties.hide_proxy_login_info).toBe(true);
        expect(properties.proxyip).toBe('1.2.3.4:1080:bob:hunter2');

        elements['proxy-login-info-modal'].classList.add('auth-hidden');
        renderer = loadRenderer();
        await renderer.setupProxyInput();
        const next = renderer.runJagexLogin(elements.play);

        expect(modalOpen()).toBe(false);
        expect(electron.startAuthFlow).toHaveBeenCalledTimes(2);
        finishLogin('Authentication successful.');
        await next;
    });

    test('does not show the popup when no proxy is set', async () => {
        elements['proxy-ip']._value = '';
        const login = renderer.runJagexLogin(elements.play);

        expect(modalOpen()).toBe(false);
        expect(electron.startAuthFlow).toHaveBeenCalledTimes(1);
        finishLogin('Authentication successful.');
        await login;
    });
});

describe('renderer proxy list', () => {
    let proxySelect;
    let properties;
    let electron;
    let renderer;

    beforeEach(() => {
        proxySelect = createSelect();
        properties = { proxyip: '9.9.9.9:1080', client_ram: '2g' };
        electron = {
            readProperties: jest.fn(async () => JSON.parse(JSON.stringify(properties))),
            writeProperties: jest.fn(async (data) => {
                properties = data;
            }),
            logError: () => {},
            ipcRenderer: { receive: () => {} }
        };
        const noop = () => {};
        const context = vm.createContext({
            window: { electron, addEventListener: noop },
            document: {
                getElementById: (id) => (id === 'proxy-ip' ? proxySelect : null),
                createElement: () => ({}),
                querySelector: () => null,
                querySelectorAll: () => [],
                addEventListener: noop
            },
            console,
            sessionStorage: { getItem: () => null, setItem: noop }
        });
        const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
        vm.runInContext(
            `${source}\nglobalThis.__renderer = { applyAccountProxy, setupProxyInput, addProxiesFromText, parseProxyLine, proxyLabel };`,
            context
        );
        renderer = context.__renderer;
    });

    const optionLabels = () => proxySelect.options.map((option) => option.textContent);

    test('moves a proxy saved by an older launcher into the list and keeps it selected', async () => {
        await renderer.setupProxyInput();

        expect(properties.proxies).toEqual([{ name: '', address: '9.9.9.9:1080' }]);
        expect(optionLabels()).toEqual(['No proxy', '9.9.9.9:1080']);
        expect(proxySelect.value).toBe('9.9.9.9:1080');
    });

    test('saves the proxy picked from the list', async () => {
        properties.proxies = [
            { name: '', address: '9.9.9.9:1080' },
            { name: 'Main', address: '1.2.3.4:1080:bob:pw' }
        ];
        await renderer.setupProxyInput();

        proxySelect._value = '1.2.3.4:1080:bob:pw';
        await proxySelect.dispatch('change');

        expect(properties.proxyip).toBe('1.2.3.4:1080:bob:pw');
        expect(optionLabels()).toEqual(['No proxy', '9.9.9.9:1080', 'Main (1.2.3.4:1080)']);
    });

    test('adds every valid pasted line, skips duplicates and returns the invalid ones', async () => {
        properties = { proxyip: '', proxies: [{ name: '', address: '9.9.9.9:1080' }] };

        const result = await renderer.addProxiesFromText(
            ' 1.1.1.1:1080 \n\nHome | 2.2.2.2:1080:u:p:with:colons\nsocks5://u:p@3.3.3.3:1081\n9.9.9.9:1080\nnot-a-proxy\n4.4.4.4:99999'
        );

        expect(result).toEqual({ added: 3, duplicates: 1, invalid: ['not-a-proxy', '4.4.4.4:99999'] });
        expect(properties.proxies).toEqual([
            { name: '', address: '9.9.9.9:1080' },
            { name: '', address: '1.1.1.1:1080' },
            { name: 'Home', address: '2.2.2.2:1080:u:p:with:colons' },
            { name: '', address: 'socks5://u:p@3.3.3.3:1081' }
        ]);
        expect(properties.proxyip).toBe('');
    });

    test('selects the first proxy a user ever adds', async () => {
        properties = { proxyip: '' };

        await renderer.addProxiesFromText('1.1.1.1:1080\n2.2.2.2:1080');

        expect(properties.proxyip).toBe('1.1.1.1:1080');
        expect(proxySelect.value).toBe('1.1.1.1:1080');
    });

    test.each([
        ['1.2.3.4:1080', { name: '', address: '1.2.3.4:1080' }],
        ['http://1.2.3.4:8080', { name: '', address: 'http://1.2.3.4:8080' }],
        ['1.2.3.4:1080:user', null],
        ['ftp://1.2.3.4:21', null],
        ['1.2.3.4:abc', null]
    ])('parses %s', (line, expected) => {
        const parsed = renderer.parseProxyLine(line);
        expect(parsed ? { ...parsed } : parsed).toEqual(expected);
    });

    test('never shows proxy passwords in labels', () => {
        expect(renderer.proxyLabel({ name: '', address: '1.2.3.4:1080:bob:secret' })).toBe('1.2.3.4:1080');
        expect(renderer.proxyLabel({ name: 'Alt', address: 'socks5://bob:secret@1.2.3.4:1080' })).toBe(
            'Alt (1.2.3.4:1080)'
        );
    });

    test('switches to the proxy the account was logged in with, adding it to the list', async () => {
        properties.proxies = [{ name: '', address: '9.9.9.9:1080' }];
        await renderer.setupProxyInput();

        await renderer.applyAccountProxy({ accountId: 'a1', proxyIp: '1.2.3.4:1080:bob:pw' });

        expect(proxySelect.value).toBe('1.2.3.4:1080:bob:pw');
        expect(properties).toEqual({
            proxyip: '1.2.3.4:1080:bob:pw',
            client_ram: '2g',
            proxies: [
                { name: '', address: '9.9.9.9:1080' },
                { name: '', address: '1.2.3.4:1080:bob:pw' }
            ]
        });
    });

    test.each([
        ['logged in without a proxy', { accountId: 'a1', proxyIp: '' }],
        ['saved before proxies were remembered', { accountId: 'a1' }],
        ['already matching the selection', { accountId: 'a1', proxyIp: '9.9.9.9:1080' }]
    ])('leaves the selection alone for an account %s', async (_, account) => {
        properties.proxies = [{ name: '', address: '9.9.9.9:1080' }];
        await renderer.setupProxyInput();
        electron.writeProperties.mockClear();

        await renderer.applyAccountProxy(account);

        expect(proxySelect.value).toBe('9.9.9.9:1080');
        expect(electron.writeProperties).not.toHaveBeenCalled();
    });
});
