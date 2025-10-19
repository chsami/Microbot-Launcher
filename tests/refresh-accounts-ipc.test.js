const fs = require('fs');
const path = require('path');
const os = require('os');

// Hoisted mock with placeholder implementation; actual logic assigned per test.
jest.mock('../libs/oauth-jagex.js', () => ({
    startAuthFlow: jest.fn(),
    writeAccountsToFile: jest.fn()
}));

let testTempDir; // set in beforeEach
let writeAccountsToFile; // reference to mocked function

describe('refresh-accounts IPC handler', () => {
    let ipcHandlersFn;
    let mockIpcMain;
    let registeredHandlers = {};

    beforeEach(async () => {
        // Fresh temp dir for each test
        testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbtest-'));
        registeredHandlers = {};
        mockIpcMain = {
            handle: (channel, fn) => {
                registeredHandlers[channel] = fn;
            }
        };

        // Seed accounts.json
        fs.writeFileSync(
            path.join(testTempDir, 'accounts.json'),
            JSON.stringify([
                {
                    accountId: 'acc1',
                    displayName: 'Test Account',
                    sessionId: 'SESSION123',
                    profile: 'default'
                }
            ])
        );

        // Assign mock implementation AFTER tempDir prepared
        ({ writeAccountsToFile } = require('../libs/oauth-jagex.js'));
        writeAccountsToFile.mockImplementation(async (sessionId) => {
            const accountsFile = path.join(testTempDir, 'accounts.json');
            const raw = fs.readFileSync(accountsFile, 'utf8');
            const arr = JSON.parse(raw);
            arr.push({
                accountId: 'acc2',
                displayName: 'Refreshed',
                sessionId,
                profile: 'default'
            });
            fs.writeFileSync(accountsFile, JSON.stringify(arr, null, 2));
        });

        // Load ipc handlers AFTER mock is in place
        ipcHandlersFn = require('../libs/ipc-handlers.js');
        const deps = {
            ipcMain: mockIpcMain,
            axios: {},
            microbotDir: testTempDir,
            packageJson: { version: '1.0.0' },
            path,
            log: { info: jest.fn(), error: jest.fn() },
            dialog: {},
            fs,
            projectDir: path.join(__dirname, '..'),
            app: {}
        };
        await ipcHandlersFn(deps);
    });

    afterEach(() => {
        // Cleanup temp directory recursively
        try {
            if (testTempDir && fs.existsSync(testTempDir)) {
                fs.rmSync(testTempDir, { recursive: true, force: true });
            }
        } catch (e) {
            // Log to console; tests shouldn't fail because cleanup failed.
            // eslint-disable-next-line no-console
            console.warn('Failed to remove temp test directory:', e);
        }
        jest.clearAllMocks();
    });

    test('refresh-accounts adds new accounts using sessionId', async () => {
        const handler = registeredHandlers['refresh-accounts'];
        expect(handler).toBeDefined();
        const result = await handler();
        expect(result.success).toBe(true);
        expect(result.accounts.length).toBe(2);
        const ids = result.accounts.map((a) => a.accountId).sort();
        expect(ids).toEqual(['acc1', 'acc2']);
    });

    test('refresh-accounts errors when accounts.json missing', async () => {
        fs.unlinkSync(path.join(testTempDir, 'accounts.json'));
        const handler = registeredHandlers['refresh-accounts'];
        const result = await handler();
        expect(result.error).toMatch(/does not exist/);
    });
});
