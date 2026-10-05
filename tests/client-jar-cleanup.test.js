const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../libs/oauth-jagex.js', () => ({
    startAuthFlow: jest.fn(),
    writeAccountsToFile: jest.fn()
}));

const DAY = 24 * 60 * 60 * 1000;

describe('client jar cleanup and listing with an isolated home', () => {
    let homeDir;
    let microbotDir;
    let dirModule;

    function touch(name) {
        fs.writeFileSync(path.join(microbotDir, name), 'jar');
    }

    function exists(name) {
        return fs.existsSync(path.join(microbotDir, name));
    }

    function writeTtl(data) {
        fs.writeFileSync(
            path.join(microbotDir, 'clients_jar_ttl.json'),
            JSON.stringify(data)
        );
    }

    function readTtl() {
        return JSON.parse(
            fs.readFileSync(path.join(microbotDir, 'clients_jar_ttl.json'), 'utf8')
        );
    }

    function writeDownloaded(versions) {
        fs.writeFileSync(
            path.join(microbotDir, 'downloaded_clients.json'),
            JSON.stringify(versions)
        );
    }

    function readDownloaded() {
        return JSON.parse(
            fs.readFileSync(path.join(microbotDir, 'downloaded_clients.json'), 'utf8')
        );
    }

    beforeEach(() => {
        homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-home-'));
        microbotDir = path.join(homeDir, '.microbot');
        fs.mkdirSync(microbotDir);
        jest.resetModules();
        jest.doMock('os', () => ({
            ...jest.requireActual('os'),
            homedir: () => homeDir
        }));
        dirModule = require('../libs/dir-module.js');
        if (dirModule.microbotDir !== microbotDir) {
            throw new Error('dir-module is not using the isolated home');
        }
    });

    afterEach(() => {
        jest.dontMock('os');
        fs.rmSync(homeDir, { recursive: true, force: true });
    });

    test('uses the isolated home directory', () => {
        expect(dirModule.microbotDir).toBe(microbotDir);
    });

    test('keeps stale jars the user placed manually', async () => {
        touch('microbot-2.6.28.jar');
        touch('microbot-2.6.22.jar');
        touch('microbot-2.6.28-dev.jar');
        const stale = Date.now() - 10 * DAY;
        writeTtl({ '2.6.28': stale, '2.6.22': stale, '2.6.28-dev': stale });

        const result = await dirModule.cleanupUnusedClientsJar('2.6.28');

        expect(result).toEqual({ success: true });
        expect(exists('microbot-2.6.22.jar')).toBe(true);
        expect(exists('microbot-2.6.28-dev.jar')).toBe(true);
        expect(exists('microbot-2.6.28.jar')).toBe(true);
    });

    test('still removes stale jars the launcher downloaded, except the latest', async () => {
        touch('microbot-2.6.28.jar');
        touch('microbot-2.6.27.jar');
        touch('microbot-2.6.26.jar');
        const stale = Date.now() - 10 * DAY;
        const fresh = Date.now() - DAY;
        writeTtl({ '2.6.28': stale, '2.6.27': stale, '2.6.26': fresh });
        writeDownloaded(['2.6.26', '2.6.27', '2.6.28']);

        const result = await dirModule.cleanupUnusedClientsJar('2.6.28');

        expect(result).toEqual({ success: true });
        expect(exists('microbot-2.6.28.jar')).toBe(true);
        expect(exists('microbot-2.6.27.jar')).toBe(false);
        expect(exists('microbot-2.6.26.jar')).toBe(true);
        expect(Object.keys(readTtl()).sort()).toEqual(['2.6.26', '2.6.28']);
        expect(readDownloaded()).toEqual(['2.6.26', '2.6.28']);
    });

    test('starts tracking newly placed custom jars without deleting them', async () => {
        touch('microbot-my build.jar');
        touch('microbot-launcher.jar');

        const result = await dirModule.cleanupUnusedClientsJar('2.6.28');

        expect(result).toEqual({ success: true });
        expect(Object.keys(readTtl())).toEqual(['my build']);
        expect(exists('microbot-launcher.jar')).toBe(true);
    });

    test('updates TTL for custom jar names with spaces', async () => {
        touch('microbot-2.6.28 (1).jar');

        const result = await dirModule.updateClientJarTTL('2.6.28 (1)');

        expect(result).toEqual({ success: true });
        expect(Object.keys(readTtl())).toEqual(['2.6.28 (1)']);
        expect(await dirModule.updateClientJarTTL('../x')).toEqual({
            success: false,
            error: 'Invalid version format'
        });
    });

    describe('IPC handlers', () => {
        let handlers;
        let axios;

        beforeEach(async () => {
            handlers = {};
            axios = jest.fn().mockResolvedValue({ data: Buffer.from('jar') });
            const ipcHandlers = require('../libs/ipc-handlers.js');
            await ipcHandlers({
                ipcMain: {
                    handle: (channel, fn) => {
                        handlers[channel] = fn;
                    }
                },
                axios,
                microbotDir,
                packageJson: { version: '1.0.0' },
                path,
                log: { info: jest.fn(), error: jest.fn() },
                dialog: {},
                fs,
                projectDir: path.join(__dirname, '..'),
                app: {}
            });
        });

        test('list-jars and list-client-jars include older and custom jars', async () => {
            touch('microbot-2.6.28.jar');
            touch('microbot-2.6.22.jar');
            touch('microbot-custom.jar');
            touch('microbot-launcher.jar');

            expect(await handlers['list-jars']()).toEqual([
                'microbot-2.6.28.jar',
                'microbot-2.6.22.jar',
                'microbot-custom.jar'
            ]);
            expect(
                (await handlers['list-client-jars']({}, '2.6.28')).map((j) => j.label)
            ).toEqual(['2.6.28 (latest)', '2.6.22 (older)', 'custom (custom)']);
            expect(await handlers['client-exists']({}, 'custom')).toBe(true);
        });

        test('download-client records the version as launcher-managed', async () => {
            const sender = { send: jest.fn() };

            const result = await handlers['download-client']({ sender }, '2.6.28');

            expect(result.success).toBe(true);
            expect(exists('microbot-2.6.28.jar')).toBe(true);
            expect(readDownloaded()).toEqual(['2.6.28']);
        });

        test('rejects unsafe versions before touching the file system', async () => {
            const sender = { send: jest.fn() };
            const unsafe = ['../../escape', 'a/b', 'a\\b', '', null, 42];

            for (const version of unsafe) {
                expect(await handlers['download-client']({ sender }, version)).toEqual({
                    error: `Invalid client version: ${JSON.stringify(String(version))}`
                });
                expect(await handlers['client-exists']({}, version)).toBe(false);
                expect((await handlers['open-client']({}, version, {}, {}, '1g')).error).toMatch(/^Invalid client version/);
                expect((await handlers['play-no-jagex-account']({}, version, {}, '1g')).error).toMatch(/^Invalid client version/);
            }
            expect(axios).not.toHaveBeenCalled();
            expect(fs.existsSync(path.join(homeDir, 'escape.jar'))).toBe(false);
        });

        test('keeps registering other jar-executor handlers unchanged', () => {
            expect(typeof handlers['open-client']).toBe('function');
            expect(typeof handlers['play-no-jagex-account']).toBe('function');
        });

        test('download-client does not claim a jar that already exists', async () => {
            touch('microbot-2.6.22.jar');
            const sender = { send: jest.fn() };

            const result = await handlers['download-client']({ sender }, '2.6.22');

            expect(result.success).toBe(true);
            expect(axios).not.toHaveBeenCalled();
            expect(exists('downloaded_clients.json')).toBe(false);
        });
    });
});
