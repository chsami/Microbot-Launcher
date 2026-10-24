const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const {
    MESSAGES,
    parseNightlyListing,
    pickLatestNightly,
    buildFromHeaders,
    clientJarName,
    agentJarName,
    readNightlyInfo,
    prepareNightly,
    nightlyStatus
} = require('../libs/nightly-client.js');
const { listClientJars, readDownloadedClients } = require('../libs/client-jars.js');

jest.mock('../libs/oauth-jagex.js', () => ({
    startAuthFlow: jest.fn(),
    writeAccountsToFile: jest.fn()
}));

const filestorage = 'https://files.example';
const baseUrl = `${filestorage}/releases/microbot/nightly/libs/`;
const JAR_URL = `${baseUrl}microbot-2.6.38.jar`;
const AGENT_URL = `${baseUrl}hwid-agent-2.6.38.jar`;
const FIRST_BUILT = 'Sat, 24 Oct 2026 02:21:50 GMT';
const SECOND_BUILT = 'Sun, 25 Oct 2026 02:20:10 GMT';
const FIRST_BUILD = 'nightly-2.6.38-20261024022150';
const SECOND_BUILD = 'nightly-2.6.38-20261025022010';
const FAST = { request: 1000, idle: 50, total: 5000 };

function jar(payload) {
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(payload), eocd]);
}

const CLIENT = jar('client');
const AGENT = jar('agent');

const LISTING = `<html><body><pre><a href="../">../</a>
<a href="hwid-agent-2.6.38.jar">hwid-agent-2.6.38.jar</a>                              24-Oct-2026 04:21     26K
<a href="microbot-2.6.38.jar">microbot-2.6.38.jar</a>                                24-Oct-2026 04:21     67M
<a href="microbot-2.6.40.jar">microbot-2.6.40.jar</a>                                22-Oct-2026 04:19     67M
<a href="microbot-2.6.8.jar">microbot-2.6.8.jar</a>                                 25-Jun-2026 02:28     63M
</pre></body></html>`;

function notFound() {
    return Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
}

function createServer(overrides = {}) {
    const server = {
        listing: LISTING,
        offline: false,
        built: FIRST_BUILT,
        client: CLIENT,
        agent: AGENT,
        agentMissing: false,
        agentFails: false,
        stall: false,
        contentLength: null,
        ...overrides
    };
    const headersFor = (body) => ({
        'last-modified': server.built,
        etag: `"${server.built.length}-${body.length}"`,
        'content-length': String(server.contentLength ?? body.length)
    });
    const axios = jest.fn(async ({ url, signal }) => {
        if (server.offline) throw new Error('getaddrinfo ENOTFOUND');
        if (url === AGENT_URL) {
            if (server.agentMissing) throw notFound();
            if (server.agentFails) throw new Error('socket hang up');
            return { data: Readable.from([server.agent]), headers: headersFor(server.agent) };
        }
        if (url !== JAR_URL) throw new Error(`unexpected ${url}`);
        if (server.stall) {
            const stream = new Readable({ read() {} });
            stream.push(server.client.subarray(0, 4));
            signal.addEventListener('abort', () => stream.destroy(new Error('aborted')));
            return { data: stream, headers: headersFor(server.client) };
        }
        const half = Math.floor(server.client.length / 2);
        return {
            data: Readable.from([server.client.subarray(0, half), server.client.subarray(half)]),
            headers: headersFor(server.client)
        };
    });
    axios.get = jest.fn(async () => {
        if (server.offline) throw new Error('getaddrinfo ENOTFOUND');
        return { data: server.listing };
    });
    axios.head = jest.fn(async (url) => {
        if (server.offline) throw new Error('getaddrinfo ENOTFOUND');
        if (url === AGENT_URL && server.agentMissing) throw notFound();
        return { headers: headersFor(url === AGENT_URL ? server.agent : server.client) };
    });
    server.axios = axios;
    server.downloads = () => axios.mock.calls.map(([config]) => config.url);
    return server;
}

describe('nightly client', () => {
    let microbotDir;
    let log;

    beforeEach(() => {
        microbotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-nightly-'));
        log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    });

    afterEach(() => {
        fs.rmSync(microbotDir, { recursive: true, force: true });
    });

    const file = (name) => path.join(microbotDir, name);
    const prepare = (server, extra = {}) =>
        prepareNightly({ axios: server.axios, fs, log, microbotDir, filestorage, timeouts: FAST, ...extra });

    test('picks the most recently built jar, not the highest version', () => {
        const entries = parseNightlyListing(LISTING);

        expect(entries.map((e) => e.version)).toEqual(['2.6.38', '2.6.40', '2.6.8']);
        expect(pickLatestNightly(entries).version).toBe('2.6.38');
    });

    test('names each build after its Last-Modified time in UTC', () => {
        expect(buildFromHeaders('2.6.38', { 'last-modified': FIRST_BUILT })).toEqual({
            build: FIRST_BUILD,
            etag: null,
            builtAt: '2026-10-24T02:21:50.000Z'
        });
        expect(buildFromHeaders('2.6.38', { etag: '"6adc-42b2"' })).toEqual({
            build: 'nightly-2.6.38-6adc42b2',
            etag: '"6adc-42b2"',
            builtAt: null
        });
        expect(buildFromHeaders('2.6.38', {})).toBeNull();
    });

    test('downloads the client and its HWID agent on first use', async () => {
        const progress = jest.fn();
        const result = await prepare(createServer(), { progress });

        expect(result).toMatchObject({ success: true, updated: true });
        expect(result.info).toMatchObject({
            build: FIRST_BUILD,
            version: '2.6.38',
            builtAt: '2026-10-24T02:21:50.000Z',
            hasAgent: true
        });
        expect(fs.readFileSync(file(clientJarName(FIRST_BUILD)))).toEqual(CLIENT);
        expect(fs.readFileSync(file(agentJarName(FIRST_BUILD)))).toEqual(AGENT);
        expect(readNightlyInfo(fs, microbotDir)).toEqual(result.info);
        expect(progress).toHaveBeenCalledWith(expect.any(Number), 'Downloading the nightly build... (100%)');
        expect(progress).toHaveBeenLastCalledWith(100, 'Completed!');
        expect(progress.mock.calls.some(([, status]) => status.includes('2.6.38'))).toBe(false);
    });

    test('does not download again while the server has the same build', async () => {
        await prepare(createServer());
        const server = createServer();

        const result = await prepare(server);

        expect(result).toMatchObject({ success: true, updated: false });
        expect(server.downloads()).toEqual([]);
    });

    test('installs a rebuild next to the running one and removes the old files', async () => {
        await prepare(createServer());
        const server = createServer({ built: SECOND_BUILT, client: jar('rebuilt') });

        const result = await prepare(server);

        expect(result.info.build).toBe(SECOND_BUILD);
        expect(fs.readFileSync(file(clientJarName(SECOND_BUILD)))).toEqual(jar('rebuilt'));
        expect(fs.existsSync(file(clientJarName(FIRST_BUILD)))).toBe(false);
        expect(fs.existsSync(file(agentJarName(FIRST_BUILD)))).toBe(false);
    });

    test('an old build that is still in use is kept and removed on a later run', async () => {
        await prepare(createServer());
        const locked = clientJarName(FIRST_BUILD);
        const lockingFs = {
            ...fs,
            rmSync: (target, options) => {
                if (path.basename(target) === locked) {
                    throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
                }
                return fs.rmSync(target, options);
            }
        };

        const result = await prepareNightly({
            axios: createServer({ built: SECOND_BUILT }).axios,
            fs: lockingFs,
            log,
            microbotDir,
            filestorage,
            timeouts: FAST
        });

        expect(result).toMatchObject({ success: true, updated: true });
        expect(result.info.build).toBe(SECOND_BUILD);
        expect(fs.existsSync(file(locked))).toBe(true);

        await prepare(createServer({ built: SECOND_BUILT }));

        expect(fs.existsSync(file(locked))).toBe(false);
    });

    test('keeps the installed build when the agent download fails', async () => {
        await prepare(createServer());

        const result = await prepare(createServer({ built: SECOND_BUILT, agentFails: true }));

        expect(result).toMatchObject({ success: true, updated: false, warning: MESSAGES.downloadFallback });
        expect(result.info.build).toBe(FIRST_BUILD);
        expect(fs.existsSync(file(clientJarName(SECOND_BUILD)))).toBe(false);
        expect(fs.readdirSync(microbotDir).filter((name) => name.endsWith('.part'))).toEqual([]);
    });

    test('installs without an agent when the server has none, and adds it once it appears', async () => {
        const first = await prepare(createServer({ agentMissing: true }));
        expect(first.info.hasAgent).toBe(false);

        const server = createServer();
        const second = await prepare(server);

        expect(second).toMatchObject({ success: true, updated: true });
        expect(second.info.hasAgent).toBe(true);
        expect(server.downloads()).toEqual([AGENT_URL]);
        expect(fs.readFileSync(file(agentJarName(FIRST_BUILD)))).toEqual(AGENT);
    });

    test('downloads the agent again when its file was deleted', async () => {
        await prepare(createServer());
        fs.unlinkSync(file(agentJarName(FIRST_BUILD)));
        const server = createServer();

        await prepare(server);

        expect(server.downloads()).toEqual([AGENT_URL]);
        expect(fs.existsSync(file(agentJarName(FIRST_BUILD)))).toBe(true);
    });

    test('gives up on a stalled download instead of hanging', async () => {
        const result = await prepare(createServer({ stall: true }));

        expect(result.error).toBe(MESSAGES.stalled);
        expect(fs.readdirSync(microbotDir)).toEqual([]);
    });

    test('rejects a truncated jar that still starts like a zip', async () => {
        const result = await prepare(createServer({ client: CLIENT.subarray(0, CLIENT.length - 22) }));

        expect(result.error).toBe(MESSAGES.failed);
        expect(fs.readdirSync(microbotDir)).toEqual([]);
    });

    test('rejects a download shorter than its Content-Length', async () => {
        const result = await prepare(createServer({ contentLength: CLIENT.length + 100 }));

        expect(result.error).toBe(MESSAGES.failed);
        expect(fs.readdirSync(microbotDir)).toEqual([]);
    });

    test('starts the installed build with a warning when the server cannot be reached', async () => {
        await prepare(createServer());

        const result = await prepare(createServer({ offline: true }));

        expect(result).toMatchObject({ success: true, warning: MESSAGES.checkFallback });
        expect(result.info.build).toBe(FIRST_BUILD);
    });

    test('reports a plain error when offline and nothing is installed', async () => {
        const result = await prepare(createServer({ offline: true }));

        expect(result).toEqual({ error: MESSAGES.unreachable });
    });

    test('reports a plain error when the server lists no nightly build', async () => {
        const result = await prepare(createServer({ listing: '<html></html>' }));

        expect(result).toEqual({ error: MESSAGES.none });
    });

    test('status says when a newer build is out, and why a check failed', async () => {
        await prepare(createServer());
        const status = (server) =>
            nightlyStatus({ axios: server.axios, fs, log, microbotDir, filestorage, checkRemote: true, timeouts: FAST });

        expect((await status(createServer())).updateAvailable).toBe(false);
        expect((await status(createServer({ built: SECOND_BUILT }))).updateAvailable).toBe(true);
        expect((await status(createServer({ offline: true }))).error).toBe(MESSAGES.unreachable);
    });

    test('nightly builds are not stable versions and are left out of the 3-day cleanup', async () => {
        await prepare(createServer());
        fs.writeFileSync(file('microbot-2.6.40.jar'), CLIENT);

        expect(listClientJars(fs, microbotDir).map((entry) => entry.file)).toEqual(['microbot-2.6.40.jar']);
        expect(readDownloadedClients(fs, microbotDir)).toEqual([]);
    });

    test('two Play clicks during a download share one download and both get progress-safe results', async () => {
        const handlers = {};
        let releaseListing;
        const axios = {
            get: jest.fn(() => new Promise((resolve, reject) => {
                releaseListing = () => reject(new Error('getaddrinfo ENOTFOUND'));
            }))
        };
        await require('../libs/ipc-handlers.js')({
            ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
            axios,
            microbotDir,
            packageJson: { version: '1.0.0' },
            path,
            log,
            dialog: {},
            fs,
            projectDir: path.join(__dirname, '..'),
            app: {}
        });
        const sender = { isDestroyed: () => true, send: jest.fn() };

        const first = handlers['prepare-nightly']({ sender });
        const second = handlers['prepare-nightly']({ sender });
        releaseListing();

        expect(await first).toEqual({ error: MESSAGES.unreachable });
        expect(await second).toBe(await first);
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(sender.send).not.toHaveBeenCalled();
    });
});
