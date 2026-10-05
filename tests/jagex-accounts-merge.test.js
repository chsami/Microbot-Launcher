const fs = require('fs');
const path = require('path');
const os = require('os');

const fixturePath = path.join(
    __dirname,
    '__fixtures__',
    'jagex-accounts-unnamed.json'
);

function loadFixture() {
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

describe('mergeAccounts', () => {
    let mergeAccounts;

    beforeAll(() => {
        jest.isolateModules(() => {
            jest.doMock('patchright', () => ({ chromium: {} }));
            jest.doMock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
            jest.doMock('electron-log', () => ({
                info: jest.fn(),
                error: jest.fn()
            }));
            ({ mergeAccounts } = require('../libs/oauth-jagex.js'));
        });
    });

    test('fills display names of every existing unnamed character', () => {
        const fetched = [
            { accountId: 'fake-char-1', displayName: 'FakeOne', userHash: 'fake-hash-a' },
            { accountId: 'fake-char-2', displayName: 'FakeTwo', userHash: 'fake-hash-a' }
        ];
        const { accounts, added, updated } = mergeAccounts(
            loadFixture(),
            fetched,
            'fake-session-new',
            '2026-10-01T00:00:00.000Z'
        );

        expect(added).toBe(0);
        expect(updated).toBe(2);
        expect(accounts.map((a) => a.displayName)).toEqual([
            'FakeOne',
            'FakeTwo',
            'FakeNamed'
        ]);
        expect(accounts[0]).toMatchObject({
            sessionId: 'fake-session-new',
            createdOn: '2026-09-01T10:00:00.000Z',
            profile: 'fake-profile-1'
        });
        expect(accounts[2].sessionId).toBe('fake-session-other');
    });

    test('keeps a known display name when the response has none', () => {
        const { accounts, updated } = mergeAccounts(
            loadFixture(),
            [{ accountId: 'fake-char-3', displayName: null, userHash: 'fake-hash-b' }],
            'fake-session-other',
            '2026-10-01T00:00:00.000Z'
        );

        expect(updated).toBe(0);
        expect(accounts[2].displayName).toBe('FakeNamed');
    });

    test('appends new characters and reports no change when nothing differs', () => {
        const existing = loadFixture();
        const first = mergeAccounts(
            existing,
            [{ accountId: 'fake-char-4', displayName: 'FakeFour', userHash: 'fake-hash-b' }],
            'fake-session-other',
            '2026-10-01T00:00:00.000Z'
        );
        expect(first.added).toBe(1);
        expect(first.accounts[3]).toEqual({
            accountId: 'fake-char-4',
            displayName: 'FakeFour',
            userHash: 'fake-hash-b',
            sessionId: 'fake-session-other',
            createdOn: '2026-10-01T00:00:00.000Z'
        });

        const second = mergeAccounts(
            first.accounts,
            [{ accountId: 'fake-char-4', displayName: 'FakeFour', userHash: 'fake-hash-b' }],
            'fake-session-other',
            '2026-10-02T00:00:00.000Z'
        );
        expect(second.added).toBe(0);
        expect(second.updated).toBe(0);
        expect(existing).toEqual(loadFixture());
    });
});

describe('writeAccountsToFile', () => {
    let tempHome;
    let originalHome;
    let originalUserProfile;
    let writeAccountsToFile;
    let axiosGet;

    beforeEach(() => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mbtest-home-'));
        originalHome = process.env.HOME;
        originalUserProfile = process.env.USERPROFILE;
        process.env.HOME = tempHome;
        process.env.USERPROFILE = tempHome;
        fs.mkdirSync(path.join(tempHome, '.microbot'));
        fs.copyFileSync(
            fixturePath,
            path.join(tempHome, '.microbot', 'accounts.json')
        );
        axiosGet = jest.fn();
        jest.isolateModules(() => {
            jest.doMock('patchright', () => ({ chromium: {} }));
            jest.doMock('axios', () => ({ get: axiosGet, post: jest.fn() }));
            jest.doMock('electron-log', () => ({
                info: jest.fn(),
                error: jest.fn()
            }));
            ({ writeAccountsToFile } = require('../libs/oauth-jagex.js'));
        });
    });

    afterEach(() => {
        process.env.HOME = originalHome;
        if (originalUserProfile === undefined) {
            delete process.env.USERPROFILE;
        } else {
            process.env.USERPROFILE = originalUserProfile;
        }
        fs.rmSync(tempHome, { recursive: true, force: true });
    });

    test('re-login writes names of already stored characters', async () => {
        axiosGet.mockResolvedValue({
            data: [
                { accountId: 'fake-char-1', displayName: 'FakeOne', userHash: 'fake-hash-a' },
                { accountId: 'fake-char-2', displayName: 'FakeTwo', userHash: 'fake-hash-a' }
            ]
        });

        await writeAccountsToFile('fake-session-new');

        expect(axiosGet).toHaveBeenCalledWith(
            'https://auth.jagex.com/game-session/v1/accounts',
            { headers: { Authorization: 'Bearer fake-session-new' } }
        );
        const stored = JSON.parse(
            fs.readFileSync(
                path.join(tempHome, '.microbot', 'accounts.json'),
                'utf8'
            )
        );
        expect(stored).toHaveLength(3);
        expect(
            stored.map((a) => [a.accountId, a.displayName, a.sessionId])
        ).toEqual([
            ['fake-char-1', 'FakeOne', 'fake-session-new'],
            ['fake-char-2', 'FakeTwo', 'fake-session-new'],
            ['fake-char-3', 'FakeNamed', 'fake-session-other']
        ]);
    });
});
