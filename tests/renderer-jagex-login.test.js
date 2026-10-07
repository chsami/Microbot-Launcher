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
