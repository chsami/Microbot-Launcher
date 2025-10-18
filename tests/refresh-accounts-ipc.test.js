const fs = require('fs');
const path = require('path');

// We'll load the ipc-handlers module function and invoke it with mocked deps

describe('refresh-accounts IPC handler', () => {
    let ipcHandlersFn;
    let mockIpcMain;
    let registeredHandlers = {};
    let tempDir;

    beforeAll(() => {
        ipcHandlersFn = require('../libs/ipc-handlers.js');
    });

    beforeEach(async () => {
        registeredHandlers = {};
        mockIpcMain = {
            handle: (channel, fn) => {
                registeredHandlers[channel] = fn;
            }
        };

        tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mbtest-'));
        const accountsPath = path.join(tempDir, 'accounts.json');
        fs.writeFileSync(
            accountsPath,
            JSON.stringify([
                {
                    accountId: 'acc1',
                    displayName: 'Test Account',
                    sessionId: 'SESSION123',
                    profile: 'default'
                }
            ])
        );

        // mock oauth-jagex writeAccountsToFile to append a new account
        jest.mock('../libs/oauth-jagex.js', () => ({
            startAuthFlow: jest.fn(),
            writeAccountsToFile: jest.fn(async (sessionId) => {
                const accountsFile = path.join(tempDir, 'accounts.json');
                const raw = fs.readFileSync(accountsFile, 'utf8');
                const arr = JSON.parse(raw);
                arr.push({
                    accountId: 'acc2',
                    displayName: 'Refreshed',
                    sessionId,
                    profile: 'default'
                });
                fs.writeFileSync(accountsFile, JSON.stringify(arr, null, 2));
            })
        }), { virtual: true });

        const deps = {
            ipcMain: mockIpcMain,
            axios: {},
            microbotDir: tempDir,
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
        jest.resetModules();
    });

    test('refresh-accounts adds new accounts using sessionId', async () => {
        const handler = registeredHandlers['refresh-accounts'];
        expect(handler).toBeDefined();
        const result = await handler();
        expect(result.success).toBe(true);
        expect(Array.isArray(result.accounts)).toBe(true);
        expect(result.accounts.length).toBe(2);
        const ids = result.accounts.map((a) => a.accountId).sort();
        expect(ids).toEqual(['acc1', 'acc2']);
    });

    test('refresh-accounts errors when accounts.json missing', async () => {
        const accountsFile = path.join(tempDir, 'accounts.json');
        fs.unlinkSync(accountsFile);
        const handler = registeredHandlers['refresh-accounts'];
        const result = await handler();
        expect(result.error).toMatch(/does not exist/);
    });
});
