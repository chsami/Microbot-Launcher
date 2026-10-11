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
            'proxy-ip': createElement({ value: '1.2.3.4:1080:bob:hunter2' }),
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
        elements['proxy-ip'].value = '  ';
        const login = renderer.runJagexLogin(elements.play);

        expect(modalOpen()).toBe(false);
        expect(electron.startAuthFlow).toHaveBeenCalledTimes(1);
        finishLogin('Authentication successful.');
        await login;
    });
});

describe('renderer account proxy', () => {
    let proxyInput;
    let properties;
    let electron;
    let renderer;

    beforeEach(() => {
        proxyInput = { value: '9.9.9.9:1080' };
        properties = { proxyip: '9.9.9.9:1080', client_ram: '2g' };
        electron = {
            readProperties: jest.fn(async () => ({ ...properties })),
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
                getElementById: (id) => (id === 'proxy-ip' ? proxyInput : null),
                createElement: () => ({}),
                querySelector: () => null,
                querySelectorAll: () => [],
                addEventListener: noop
            },
            console,
            sessionStorage: { getItem: () => null, setItem: noop }
        });
        const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
        vm.runInContext(`${source}\nglobalThis.__renderer = { applyAccountProxy };`, context);
        renderer = context.__renderer;
    });

    test('switches the proxy field to the proxy the account was logged in with and saves it', async () => {
        await renderer.applyAccountProxy({ accountId: 'a1', proxyIp: '1.2.3.4:1080:bob:pw' });

        expect(proxyInput.value).toBe('1.2.3.4:1080:bob:pw');
        expect(properties).toEqual({ proxyip: '1.2.3.4:1080:bob:pw', client_ram: '2g' });
    });

    test.each([
        ['logged in without a proxy', { accountId: 'a1', proxyIp: '' }],
        ['saved before proxies were remembered', { accountId: 'a1' }],
        ['already matching the field', { accountId: 'a1', proxyIp: '9.9.9.9:1080' }]
    ])('leaves the proxy field alone for an account %s', async (_, account) => {
        await renderer.applyAccountProxy(account);

        expect(proxyInput.value).toBe('9.9.9.9:1080');
        expect(electron.writeProperties).not.toHaveBeenCalled();
    });
});
