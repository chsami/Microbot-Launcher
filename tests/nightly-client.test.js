const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    NIGHTLY_JAR,
    NIGHTLY_AGENT_JAR,
    parseNightlyListing,
    pickLatestNightly,
    readNightlyInfo,
    prepareNightly,
    nightlyStatus
} = require('../libs/nightly-client.js');
const { listClientJars, readDownloadedClients } = require('../libs/client-jars.js');

const filestorage = 'https://files.example';
const baseUrl = `${filestorage}/releases/microbot/nightly/libs/`;
const JAR = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
const AGENT = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9]);

const LISTING = `<html><body><pre><a href="../">../</a>
<a href="hwid-agent-2.6.38.jar">hwid-agent-2.6.38.jar</a>                              24-Oct-2026 04:21     26K
<a href="microbot-2.6.38.jar">microbot-2.6.38.jar</a>                                24-Oct-2026 04:21     67M
<a href="microbot-2.6.40.jar">microbot-2.6.40.jar</a>                                22-Oct-2026 04:19     67M
<a href="microbot-2.6.8.jar">microbot-2.6.8.jar</a>                                 25-Jun-2026 02:28     63M
</pre></body></html>`;

function createAxios({ etag = '"a"', listing = LISTING, jar = JAR, offline = false } = {}) {
    const axios = jest.fn(async ({ url, onDownloadProgress }) => {
        if (offline) throw new Error('getaddrinfo ENOTFOUND');
        onDownloadProgress?.({ loaded: 1, total: 2 });
        if (url === `${baseUrl}microbot-2.6.38.jar`) return { data: jar };
        if (url === `${baseUrl}hwid-agent-2.6.38.jar`) return { data: AGENT };
        throw new Error(`unexpected ${url}`);
    });
    axios.get = jest.fn(async () => {
        if (offline) throw new Error('getaddrinfo ENOTFOUND');
        return { data: listing };
    });
    axios.head = jest.fn(async () => ({
        headers: {
            etag,
            'last-modified': 'Sat, 24 Oct 2026 02:21:50 GMT',
            'content-length': String(JAR.length)
        }
    }));
    return axios;
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

    const prepare = (axios) => prepareNightly({ axios, fs, log, microbotDir, filestorage });

    test('picks the most recently built jar, not the highest version', () => {
        const entries = parseNightlyListing(LISTING);

        expect(entries.map((e) => e.version)).toEqual(['2.6.38', '2.6.40', '2.6.8']);
        expect(pickLatestNightly(entries).version).toBe('2.6.38');
    });

    test('downloads the nightly client and its HWID agent on first use', async () => {
        const progress = jest.fn();
        const result = await prepareNightly({ axios: createAxios(), fs, log, microbotDir, filestorage, progress });

        expect(result).toMatchObject({ success: true, updated: true });
        expect(result.info).toMatchObject({
            version: '2.6.38',
            etag: '"a"',
            builtAt: '2026-10-24T02:21:50.000Z'
        });
        expect(fs.readFileSync(path.join(microbotDir, NIGHTLY_JAR))).toEqual(JAR);
        expect(fs.readFileSync(path.join(microbotDir, NIGHTLY_AGENT_JAR))).toEqual(AGENT);
        expect(readNightlyInfo(fs, microbotDir)).toEqual(result.info);
        expect(readDownloadedClients(fs, microbotDir)).toEqual(['nightly']);
        expect(progress).toHaveBeenCalledWith(50, 'Downloading nightly 2.6.38... (50%)');
        expect(progress).toHaveBeenLastCalledWith(100, 'Completed!');
    });

    test('does not download again while the server has the same build', async () => {
        await prepare(createAxios());
        const axios = createAxios();

        const result = await prepare(axios);

        expect(result).toMatchObject({ success: true, updated: false });
        expect(axios).not.toHaveBeenCalled();
    });

    test('downloads a rebuilt nightly that kept the same version', async () => {
        await prepare(createAxios({ etag: '"a"' }));
        const axios = createAxios({ etag: '"b"' });

        const result = await prepare(axios);

        expect(result).toMatchObject({ success: true, updated: true });
        expect(result.info.etag).toBe('"b"');
        expect(axios).toHaveBeenCalledTimes(2);
    });

    test('starts the installed nightly when the server cannot be reached', async () => {
        await prepare(createAxios());

        const result = await prepare(createAxios({ offline: true }));

        expect(result.success).toBe(true);
        expect(result.info.version).toBe('2.6.38');
        expect(result.warning).toMatch(/could not check/i);
    });

    test('reports an error when offline and no nightly is installed', async () => {
        const result = await prepare(createAxios({ offline: true }));

        expect(result.error).toMatch(/could not download the nightly build/i);
        expect(fs.existsSync(path.join(microbotDir, NIGHTLY_JAR))).toBe(false);
    });

    test('keeps the installed nightly when the new download is not a jar', async () => {
        await prepare(createAxios({ etag: '"a"' }));

        const result = await prepare(createAxios({ etag: '"b"', jar: Buffer.from('<html>') }));

        expect(result.success).toBe(true);
        expect(result.warning).toMatch(/could not be downloaded/i);
        expect(fs.readFileSync(path.join(microbotDir, NIGHTLY_JAR))).toEqual(JAR);
        expect(readNightlyInfo(fs, microbotDir).etag).toBe('"a"');
        expect(fs.existsSync(path.join(microbotDir, `${NIGHTLY_JAR}.part`))).toBe(false);
    });

    test('reports an error when the server lists no nightly build', async () => {
        const result = await prepare(createAxios({ listing: '<html></html>' }));

        expect(result.error).toMatch(/no nightly build is available/i);
    });

    test('status says when a newer nightly is out', async () => {
        await prepare(createAxios({ etag: '"a"' }));

        const status = await nightlyStatus({
            axios: createAxios({ etag: '"b"' }),
            fs,
            log,
            microbotDir,
            filestorage,
            checkRemote: true
        });

        expect(status.installed.etag).toBe('"a"');
        expect(status.updateAvailable).toBe(true);
    });

    test('the nightly jar is not listed as a stable version', () => {
        fs.writeFileSync(path.join(microbotDir, NIGHTLY_JAR), JAR);
        fs.writeFileSync(path.join(microbotDir, 'microbot-2.6.40.jar'), JAR);

        expect(listClientJars(fs, microbotDir).map((jar) => jar.file)).toEqual(['microbot-2.6.40.jar']);
    });
});
