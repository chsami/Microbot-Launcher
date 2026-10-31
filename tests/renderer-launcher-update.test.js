const fs = require('fs');
const path = require('path');
const vm = require('vm');

jest.mock('../libs/oauth-jagex.js', () => ({
    startAuthFlow: jest.fn(),
    writeAccountsToFile: jest.fn()
}));

function element() {
    const listeners = {};
    return {
        hidden: true,
        disabled: false,
        textContent: '',
        dataset: {},
        style: { setProperty: jest.fn() },
        setAttribute: jest.fn(),
        addEventListener: (type, fn) => (listeners[type] = fn),
        click() {
            if (!this.disabled) listeners.click?.({ currentTarget: this });
        }
    };
}

function loadRenderer({ install = jest.fn().mockResolvedValue(undefined) } = {}) {
    const elements = {
        'launcher-update-banner': element(),
        'launcher-update-text': element(),
        'launcher-update-btn': element()
    };
    let onStatus = null;
    const noop = () => {};
    const invoke = jest.fn((channel) =>
        channel === 'launcher-update:install' ? install() : Promise.resolve()
    );
    const electron = {
        ipcRenderer: {
            invoke,
            receive: (channel, fn) => {
                if (channel === 'launcher-update') onStatus = fn;
            }
        },
        openHelpLink: jest.fn().mockResolvedValue({ success: true })
    };
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
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8'), context);
    const send = (status) => onStatus({}, status);
    return { elements, send, invoke, electron, button: elements['launcher-update-btn'] };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('launcher update banner', () => {
    test('Restart now is pressed once, then waits for the launcher to restart', () => {
        const { send, invoke, button } = loadRenderer();
        send({ state: 'ready', version: '3.2.27' });
        expect(button.textContent).toBe('Restart now');
        button.click();
        button.click();
        expect(button.disabled).toBe(true);
        expect(invoke.mock.calls.filter(([channel]) => channel === 'launcher-update:install')).toHaveLength(1);
    });

    test('a failed restart points the player to the download page instead of a Retry that fails again', () => {
        const { elements, send, invoke, electron, button } = loadRenderer();
        send({ state: 'ready', version: '3.2.27' });
        button.click();
        send({ state: 'error', stage: 'install' });
        expect(button.disabled).toBe(false);
        expect(button.textContent).toBe('Open download page');
        expect(elements['launcher-update-text'].textContent).toBe(
            'Could not restart to update. Quit the launcher and install v3.2.27 from themicrobot.com'
        );
        button.click();
        expect(electron.openHelpLink).toHaveBeenCalledWith('launcherDownload');
        expect(invoke.mock.calls.filter(([channel]) => channel === 'launcher-update:download')).toHaveLength(0);
    });

    test('a failed download still offers Retry', () => {
        const { send, invoke, button } = loadRenderer();
        send({ state: 'available', version: '3.2.27', current: '3.2.24' });
        button.click();
        send({ state: 'error', stage: 'download' });
        expect(button.textContent).toBe('Retry');
        button.click();
        expect(invoke.mock.calls.filter(([channel]) => channel === 'launcher-update:download')).toHaveLength(2);
    });

    test('Restart now comes back when the install request itself fails', async () => {
        const { send, button } = loadRenderer({ install: () => Promise.reject(new Error('gone')) });
        send({ state: 'ready', version: '3.2.27' });
        button.click();
        await settle();
        expect(button.disabled).toBe(false);
    });
});
