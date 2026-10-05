const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    parseClientJar,
    listClientJars,
    labelClientJar,
    markClientDownloaded,
    readDownloadedClients,
    DOWNLOADED_CLIENTS_FILE
} = require('../libs/client-jars');

function makeDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mb-client-jars-'));
}

function touch(dir, name) {
    fs.writeFileSync(path.join(dir, name), 'jar');
}

describe('parseClientJar', () => {
    test('accepts official, older and custom microbot jars', () => {
        expect(parseClientJar('microbot-2.6.28.jar')).toEqual({
            file: 'microbot-2.6.28.jar',
            version: '2.6.28',
            kind: 'official'
        });
        expect(parseClientJar('microbot-2.6.28-dev.jar').kind).toBe('custom');
        expect(parseClientJar('microbot-custom.jar')).toEqual({
            file: 'microbot-custom.jar',
            version: 'custom',
            kind: 'custom'
        });
        expect(parseClientJar('microbot-2.6.28 (1).jar').version).toBe(
            '2.6.28 (1)'
        );
    });

    test('rejects launcher and non-client files', () => {
        expect(parseClientJar('microbot-launcher.jar')).toBeNull();
        expect(parseClientJar('microbot-launcher-1.2.jar')).toBeNull();
        expect(parseClientJar('client.jar')).toBeNull();
        expect(parseClientJar('microbot-.jar')).toBeNull();
        expect(parseClientJar('microbot-2.6.28.jar.part')).toBeNull();
        expect(parseClientJar('microbot-2.6.28.JAR')).toBeNull();
        expect(parseClientJar('microbot-a..b.jar')).toBeNull();
        expect(parseClientJar(undefined)).toBeNull();
    });
});

describe('labelClientJar', () => {
    test('labels latest, older, custom and unknown-latest jars', () => {
        expect(labelClientJar(parseClientJar('microbot-2.6.28.jar'), '2.6.28')).toBe('2.6.28 (latest)');
        expect(labelClientJar(parseClientJar('microbot-2.6.9.jar'), '2.6.28')).toBe('2.6.9 (older)');
        expect(labelClientJar(parseClientJar('microbot-2.6.30.jar'), '2.6.28')).toBe('2.6.30');
        expect(labelClientJar(parseClientJar('microbot-dev.jar'), '2.6.28')).toBe('dev (custom)');
        expect(labelClientJar(parseClientJar('microbot-2.6.27.jar'), null)).toBe('2.6.27');
        expect(labelClientJar(parseClientJar('microbot-2.6.27.jar'), { error: 'offline' })).toBe('2.6.27');
    });
});

describe('listClientJars', () => {
    let dir;

    beforeEach(() => {
        dir = makeDir();
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('lists official and custom jars side by side in a stable order', () => {
        [
            'microbot-2.6.9.jar',
            'microbot-2.6.28.jar',
            'microbot-launcher.jar',
            'microbot-2.6.28-dev.jar',
            'microbot-zeta.jar',
            'microbot-Alpha.jar',
            'microbot-2.6.27.jar',
            'microbot-2.6.10-fix.jar',
            'accounts.json',
            'clients_jar_ttl.json',
            'notes.txt'
        ].forEach((name) => touch(dir, name));
        fs.mkdirSync(path.join(dir, 'microbot-folder.jar'));

        const result = listClientJars(fs, dir, '2.6.28');

        expect(result.map((jar) => jar.file)).toEqual([
            'microbot-2.6.28.jar',
            'microbot-2.6.27.jar',
            'microbot-2.6.9.jar',
            'microbot-2.6.28-dev.jar',
            'microbot-2.6.10-fix.jar',
            'microbot-Alpha.jar',
            'microbot-zeta.jar'
        ]);
        expect(result.map((jar) => jar.label)).toEqual([
            '2.6.28 (latest)',
            '2.6.27 (older)',
            '2.6.9 (older)',
            '2.6.28-dev (custom)',
            '2.6.10-fix (custom)',
            'Alpha (custom)',
            'zeta (custom)'
        ]);
    });

    test('keeps an older official jar when the latest is present', () => {
        touch(dir, 'microbot-2.6.28.jar');
        touch(dir, 'microbot-2.6.22.jar');

        const versions = listClientJars(fs, dir, '2.6.28').map((j) => j.version);

        expect(versions).toEqual(['2.6.28', '2.6.22']);
    });

    test('returns an empty list when the folder does not exist', () => {
        expect(listClientJars(fs, path.join(dir, 'missing'), '2.6.28')).toEqual([]);
    });
});

describe('markClientDownloaded', () => {
    let dir;

    beforeEach(() => {
        dir = makeDir();
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('records each downloaded version once', () => {
        markClientDownloaded(fs, dir, '2.6.27');
        markClientDownloaded(fs, dir, '2.6.28');
        markClientDownloaded(fs, dir, '2.6.27');
        markClientDownloaded(fs, dir, '../evil');

        expect(readDownloadedClients(fs, dir)).toEqual(['2.6.27', '2.6.28']);
        expect(fs.readdirSync(dir)).toEqual([DOWNLOADED_CLIENTS_FILE]);
    });

    test('leaves the previous record intact when the write fails', () => {
        markClientDownloaded(fs, dir, '2.6.27');
        const failingFs = {
            ...fs,
            renameSync: () => {
                throw new Error('disk full');
            }
        };

        expect(() => markClientDownloaded(failingFs, dir, '2.6.28')).toThrow('disk full');
        expect(readDownloadedClients(fs, dir)).toEqual(['2.6.27']);
        expect(fs.readdirSync(dir)).toEqual([DOWNLOADED_CLIENTS_FILE]);
    });

    test('treats a corrupt record as empty', () => {
        fs.writeFileSync(path.join(dir, DOWNLOADED_CLIENTS_FILE), '{oops');

        expect(readDownloadedClients(fs, dir)).toEqual([]);
        markClientDownloaded(fs, dir, '2.6.28');
        expect(readDownloadedClients(fs, dir)).toEqual(['2.6.28']);
    });
});
