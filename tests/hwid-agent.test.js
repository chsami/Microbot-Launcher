const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    LAUNCHER_DISABLED_ARG,
    ensureHwidAgentJar,
    hwidAgentJarPath,
    isHwidSpoofEnabled,
    hwidAgentArgs,
    SPOOF_ENABLED_ARG,
    settleHwidSpoofChoice
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
    test('defaults to off for missing or unknown values', () => {
        expect(isHwidSpoofEnabled(undefined)).toBe(false);
        expect(isHwidSpoofEnabled(null)).toBe(false);
        expect(isHwidSpoofEnabled('yes')).toBe(false);
        expect(isHwidSpoofEnabled(false)).toBe(false);
        expect(isHwidSpoofEnabled('false')).toBe(false);
    });

    test('is on only when explicitly enabled', () => {
        expect(isHwidSpoofEnabled(true)).toBe(true);
        expect(isHwidSpoofEnabled('true')).toBe(true);
    });
});

describe('hwidAgentArgs', () => {
    test('attaches the agent and turns spoofing on when enabled and the jar exists', () => {
        const jarPath = path.join(microbotDir, `hwid-agent-${VERSION}.jar`);
        fs.writeFileSync(jarPath, 'x');
        expect(hwidAgentArgs({ fs, microbotDir, version: VERSION, enabled: true })).toEqual([`-javaagent:${jarPath}`, SPOOF_ENABLED_ARG]);
    });

    test('treats a missing choice as off', () => {
        fs.writeFileSync(path.join(microbotDir, `hwid-agent-${VERSION}.jar`), 'x');
        expect(hwidAgentArgs({ fs, microbotDir, version: VERSION, enabled: undefined })).toEqual([LAUNCHER_DISABLED_ARG]);
    });

    test('adds nothing when enabled but the jar is missing', () => {
        expect(hwidAgentArgs({ fs, microbotDir, version: VERSION, enabled: true })).toEqual([]);
    });

    test('skips the agent and tells the client when disabled', () => {
        fs.writeFileSync(path.join(microbotDir, `hwid-agent-${VERSION}.jar`), 'x');
        expect(hwidAgentArgs({ fs, microbotDir, version: VERSION, enabled: false })).toEqual([LAUNCHER_DISABLED_ARG]);
    });
});

describe('settleHwidSpoofChoice', () => {
    const propertiesFile = () => path.join(microbotDir, 'resource_versions.json');
    const saved = () => JSON.parse(fs.readFileSync(propertiesFile(), 'utf8'));
    const settle = (log = createLog()) => settleHwidSpoofChoice({ fs, log, microbotDir, defaults: { client_ram: '1g' } });

    test('an existing install with nothing saved keeps spoofing', () => {
        fs.writeFileSync(propertiesFile(), JSON.stringify({ client_ram: '2g', selected_account: 'abc' }));
        expect(settle()).toBe('true');
        expect(saved()).toEqual({ client_ram: '2g', selected_account: 'abc', hwid_spoof: 'true' });
    });

    test('an earlier run that left only accounts or a client jar counts as an existing install', () => {
        fs.writeFileSync(path.join(microbotDir, 'accounts.json'), '[]');
        expect(settle()).toBe('true');
        expect(saved()).toEqual({ client_ram: '1g', hwid_spoof: 'true' });

        fs.rmSync(path.join(microbotDir, 'accounts.json'));
        fs.rmSync(propertiesFile());
        fs.writeFileSync(path.join(microbotDir, 'microbot-2.6.21.jar'), 'x');
        expect(settle()).toBe('true');
    });

    test('a new install starts with spoofing off', () => {
        fs.writeFileSync(path.join(microbotDir, 'launcher-settings.json'), '{}');
        expect(settle()).toBe('false');
        expect(saved()).toEqual({ client_ram: '1g', hwid_spoof: 'false' });
    });

    test('a saved choice is left untouched', () => {
        for (const value of ['true', 'false']) {
            const content = JSON.stringify({ client_ram: '2g', hwid_spoof: value });
            fs.writeFileSync(propertiesFile(), content);
            expect(settle()).toBe(value);
            expect(fs.readFileSync(propertiesFile(), 'utf8')).toBe(content);
        }
    });

    test('runs only once: the saved choice wins on later starts', () => {
        expect(settle()).toBe('false');
        fs.writeFileSync(path.join(microbotDir, 'accounts.json'), '[]');
        expect(settle()).toBe('false');
    });

    test('an unreadable settings file is kept as a copy and replaced with spoofing on', () => {
        fs.writeFileSync(propertiesFile(), '{broken');
        const log = createLog();
        expect(settle(log)).toBe('true');
        expect(fs.readFileSync(`${propertiesFile()}.unreadable`, 'utf8')).toBe('{broken');
        expect(saved()).toEqual({ client_ram: '1g', hwid_spoof: 'true' });
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('resource_versions.json.unreadable'));
    });

    test('a settings file holding JSON that is not an object is kept as a copy and replaced with spoofing on', () => {
        for (const content of ['[]', 'null', '"text"', '42']) {
            fs.writeFileSync(propertiesFile(), content);
            expect(settle()).toBe('true');
            expect(fs.readFileSync(`${propertiesFile()}.unreadable`, 'utf8')).toBe(content);
            expect(saved()).toEqual({ client_ram: '1g', hwid_spoof: 'true' });
        }
    });

    test('an unreadable settings file is left alone when it cannot be copied', () => {
        fs.writeFileSync(propertiesFile(), '{broken');
        const failingCopy = { ...fs, copyFileSync: () => { throw new Error('disk full'); } };
        const log = createLog();
        expect(settleHwidSpoofChoice({ fs: failingCopy, log, microbotDir, defaults: { client_ram: '1g' } })).toBeNull();
        expect(fs.readFileSync(propertiesFile(), 'utf8')).toBe('{broken');
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    });
});
