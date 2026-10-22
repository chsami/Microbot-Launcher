const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    LAUNCHER_DISABLED_ARG,
    ensureHwidAgentJar,
    hwidAgentJarPath,
    isHwidSpoofEnabled,
    hwidAgentArgs
} = require('../libs/hwid-agent.js');

const FILESTORAGE = 'https://files.microbot.example';
const VERSION = '2.6.21';

let microbotDir;

function createLog() {
    return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

beforeEach(() => {
    microbotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hwid-agent-'));
});

afterEach(() => {
    fs.rmSync(microbotDir, { recursive: true, force: true });
});

describe('ensureHwidAgentJar', () => {
    test('keeps an existing jar without downloading', async () => {
        const existing = path.join(microbotDir, `hwid-agent-${VERSION}.jar`);
        fs.writeFileSync(existing, 'jar-bytes');
        const axios = jest.fn();
        const log = createLog();

        const result = await ensureHwidAgentJar({ axios, fs, log, microbotDir, filestorage: FILESTORAGE, version: VERSION });

        expect(result).toBe(existing);
        expect(axios).not.toHaveBeenCalled();
    });

    test('downloads and writes the jar when missing', async () => {
        const jar = Buffer.from('PK\x03\x04agent', 'latin1');
        const axios = jest.fn().mockResolvedValue({ data: jar });
        const log = createLog();

        const result = await ensureHwidAgentJar({ axios, fs, log, microbotDir, filestorage: FILESTORAGE, version: VERSION });

        expect(axios).toHaveBeenCalledWith(
            expect.objectContaining({ url: `${FILESTORAGE}/releases/microbot/stable/hwid-agent-${VERSION}.jar` })
        );
        expect(fs.readFileSync(result)).toEqual(jar);
        expect(fs.readdirSync(microbotDir)).toEqual([`hwid-agent-${VERSION}.jar`]);
        expect(log.info).toHaveBeenCalled();
    });

    test('refuses a download that is not a jar', async () => {
        const axios = jest.fn().mockResolvedValue({ data: Buffer.from('<html>error</html>') });
        const log = createLog();

        const result = await ensureHwidAgentJar({ axios, fs, log, microbotDir, filestorage: FILESTORAGE, version: VERSION });

        expect(result).toBeNull();
        expect(fs.readdirSync(microbotDir)).toEqual([]);
        expect(log.warn).toHaveBeenCalled();
    });

    test('leaves no jar behind when writing fails', async () => {
        const axios = jest.fn().mockResolvedValue({ data: Buffer.from('PK\x03\x04agent', 'latin1') });
        const log = createLog();
        const failingFs = {
            ...fs,
            writeFileSync: (file, data) => {
                fs.writeFileSync(file, data.subarray(0, 2));
                throw new Error('ENOSPC: no space left on device');
            }
        };

        const result = await ensureHwidAgentJar({ axios, fs: failingFs, log, microbotDir, filestorage: FILESTORAGE, version: VERSION });

        expect(result).toBeNull();
        expect(fs.readdirSync(microbotDir)).toEqual([]);
        expect(hwidAgentJarPath({ fs, microbotDir, version: VERSION })).toBeNull();
    });

    test('returns null and logs a warning on download failure', async () => {
        const axios = jest.fn().mockRejectedValue(new Error('404: not found'));
        const log = createLog();

        const result = await ensureHwidAgentJar({ axios, fs, log, microbotDir, filestorage: FILESTORAGE, version: VERSION });

        expect(result).toBeNull();
        expect(fs.existsSync(path.join(microbotDir, `hwid-agent-${VERSION}.jar`))).toBe(false);
        expect(log.warn).toHaveBeenCalled();
    });

    test('refuses an unsafe version without downloading', async () => {
        const axios = jest.fn();
        const result = await ensureHwidAgentJar({ axios, fs, log: createLog(), microbotDir, filestorage: FILESTORAGE, version: '../evil' });
        expect(result).toBeNull();
        expect(axios).not.toHaveBeenCalled();
    });

    test('returns null for a missing version', async () => {
        const axios = jest.fn();
        const result = await ensureHwidAgentJar({ axios, fs, log: createLog(), microbotDir, filestorage: FILESTORAGE, version: null });
        expect(result).toBeNull();
        expect(axios).not.toHaveBeenCalled();
    });
});

describe('hwidAgentJarPath', () => {
    test('returns the jar path only when it exists', () => {
        expect(hwidAgentJarPath({ fs, microbotDir, version: VERSION })).toBeNull();
        const jarPath = path.join(microbotDir, `hwid-agent-${VERSION}.jar`);
        fs.writeFileSync(jarPath, 'x');
        expect(hwidAgentJarPath({ fs, microbotDir, version: VERSION })).toBe(jarPath);
    });

    test('rejects an unsafe version', () => {
        expect(hwidAgentJarPath({ fs, microbotDir, version: '../evil' })).toBeNull();
    });
});

describe('isHwidSpoofEnabled', () => {
    test('defaults to on for missing or unknown values', () => {
        expect(isHwidSpoofEnabled(undefined)).toBe(true);
        expect(isHwidSpoofEnabled(null)).toBe(true);
        expect(isHwidSpoofEnabled(true)).toBe(true);
        expect(isHwidSpoofEnabled('true')).toBe(true);
    });

    test('is off only when explicitly disabled', () => {
        expect(isHwidSpoofEnabled(false)).toBe(false);
        expect(isHwidSpoofEnabled('false')).toBe(false);
    });
});

describe('hwidAgentArgs', () => {
    test('attaches the agent when enabled and the jar exists', () => {
        const jarPath = path.join(microbotDir, `hwid-agent-${VERSION}.jar`);
        fs.writeFileSync(jarPath, 'x');
        expect(hwidAgentArgs({ fs, microbotDir, version: VERSION, enabled: true })).toEqual([`-javaagent:${jarPath}`]);
        expect(hwidAgentArgs({ fs, microbotDir, version: VERSION, enabled: undefined })).toEqual([`-javaagent:${jarPath}`]);
    });

    test('adds nothing when enabled but the jar is missing', () => {
        expect(hwidAgentArgs({ fs, microbotDir, version: VERSION, enabled: true })).toEqual([]);
    });

    test('skips the agent and tells the client when disabled', () => {
        fs.writeFileSync(path.join(microbotDir, `hwid-agent-${VERSION}.jar`), 'x');
        expect(hwidAgentArgs({ fs, microbotDir, version: VERSION, enabled: false })).toEqual([LAUNCHER_DISABLED_ARG]);
    });
});
