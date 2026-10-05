const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

jest.mock('../libs/oauth-jagex.js', () => ({
    startAuthFlow: jest.fn(),
    writeAccountsToFile: jest.fn()
}));

function createSelect() {
    const select = {
        options: [],
        selectedIndex: -1,
        get value() {
            return this.selectedIndex >= 0 ? this.options[this.selectedIndex].value : '';
        },
        set value(v) {
            this.selectedIndex = this.options.findIndex((o) => o.value === v);
        },
        set innerHTML(_) {
            this.options = [];
            this.selectedIndex = -1;
        },
        appendChild(option) {
            this.options.push(option);
            if (this.selectedIndex < 0) this.selectedIndex = 0;
        }
    };
    return select;
}

describe('renderer client version select', () => {
    let microbotDir;
    let handlers;
    let properties;
    let context;
    let select;

    beforeEach(async () => {
        microbotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-renderer-'));
        [
            'microbot-2.6.28.jar',
            'microbot-2.6.2.jar',
            'microbot-2.6.28-dev.jar',
            'microbot-launcher.jar'
        ].forEach((name) => fs.writeFileSync(path.join(microbotDir, name), 'jar'));

        handlers = {};
        jest.resetModules();
        await require('../libs/ipc-handlers.js')({
            ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
            axios: {},
            microbotDir,
            packageJson: { version: '1.0.0' },
            path,
            log: { info: jest.fn(), error: jest.fn() },
            dialog: {},
            fs,
            projectDir: path.join(__dirname, '..'),
            app: {}
        });

        properties = { client: '2.6.28', version_pref: '0.0.0' };
        select = createSelect();
        const noop = () => {};
        const document = {
            getElementById: (id) => (id === 'client' ? select : null),
            createElement: () => ({}),
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: noop
        };
        const electron = {
            ipcRenderer: { receive: noop },
            listJars: () => handlers['list-jars'](),
            listClientJars: (latest) => handlers['list-client-jars']({}, latest),
            fetchClientVersion: async () => '2.6.28',
            readProperties: async () => ({ ...properties }),
            writeProperties: async (p) => {
                properties = { ...p };
            },
            logError: noop
        };
        context = vm.createContext({
            window: { electron, addEventListener: noop },
            document,
            console
        });
        const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
        vm.runInContext(
            `${source}\nglobalThis.__renderer = { populateAndSelectClientVersion, selectClientVersion, shouldPromptForClientDownload, orderClientJarsByVersion, rememberLatestClientVersion };`,
            context
        );
        context.__renderer.rememberLatestClientVersion('2.6.28');
    });

    afterEach(() => {
        fs.rmSync(microbotDir, { recursive: true, force: true });
    });

    test('lists official, older and custom jars with labels', async () => {
        await context.__renderer.populateAndSelectClientVersion('2.6.28');

        expect(select.options.map((o) => [o.value, o.text])).toEqual([
            ['microbot-2.6.28.jar', '2.6.28 (latest)'],
            ['microbot-2.6.2.jar', '2.6.2 (older)'],
            ['microbot-2.6.28-dev.jar', '2.6.28-dev (custom)']
        ]);
        expect(select.value).toBe('microbot-2.6.28.jar');
        expect(properties.version_pref).toBe('2.6.28');
    });

    test('selects the exact saved version instead of a prefix match', async () => {
        await context.__renderer.populateAndSelectClientVersion('2.6.2');
        expect(select.value).toBe('microbot-2.6.2.jar');

        await context.__renderer.selectClientVersion('2.6.28-dev');
        expect(select.value).toBe('microbot-2.6.28-dev.jar');
        expect(properties.version_pref).toBe('2.6.28-dev');
    });

    test('a custom jar sharing the latest version does not count as the latest', async () => {
        fs.unlinkSync(path.join(microbotDir, 'microbot-2.6.28.jar'));
        const jars = await handlers['list-jars']();

        const prompt = await context.__renderer.shouldPromptForClientDownload('2.6.28', jars, properties);

        expect(prompt).toBe(true);
        expect(properties.client).toBe('2.6.2');
    });
});
