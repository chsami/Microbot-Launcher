const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const setupSessionRecorder = require('../libs/session-recorder');
const { parseInfo, parseStatus, STATUS_PREFIX } = require('../libs/session-recorder');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }

    invoke(channel, ...args) {
        return this.handlers.get(channel)(null, ...args);
    }
}

const JAR = Buffer.from('PK\u0003\u0004 session recorder 1.0.0');
const JAR_SHA = crypto.createHash('sha256').update(JAR).digest('hex');
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe('session-recorder', () => {
    let dir;
    let log;
    let info;
    let served;
    let settings;
    let children;
    let spawn;
    let runelite;
    let sent;

    const setup = () => {
        const ipcMain = new FakeIpcMain();
        const webContents = { send: jest.fn((channel, view) => sent.push(view)) };
        setupSessionRecorder({
            ipcMain,
            log,
            fs,
            spawn,
            runelite,
            directory: dir,
            auth: {
                email: () => 'admin@example.com',
                request: jest.fn(async (config) => {
                    if (config.path === '/api/loader/recorder/info') {
                        if (info instanceof Error) throw info;
                        return { data: info };
                    }
                    if (config.path === '/api/loader/recorder') return { data: served };
                    throw httpError(404);
                })
            },
            getWindow: () => ({ isDestroyed: () => false, webContents })
        });
        return ipcMain;
    };

    const say = (child, text) => child.stdout.emit('data', Buffer.from(text));

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-recorder-'));
        log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        info = { version: '1.0.0', sha256: JAR_SHA, size: JAR.length, url: '/api/loader/recorder' };
        served = JAR;
        settings = {};
        sent = [];
        children = [];
        runelite = {
            readSetting: (key) => settings[key],
            writeSetting: (key, value) => {
                settings[key] = value;
                return true;
            },
            javaForTools: jest.fn(async () => '/jdk/bin/java'),
            installedAgentJar: jest.fn(async () => '/home/p/.microbot/loader/agent.jar')
        };
        spawn = jest.fn((command, args) => {
            const child = new EventEmitter();
            child.command = command;
            child.args = args;
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.written = [];
            child.stdin = Object.assign(new EventEmitter(), { writable: true, write: jest.fn((text) => child.written.push(text)) });
            children.push(child);
            return child;
        });
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('an account the API refuses never sees it and nothing starts', async () => {
        info = httpError(403);
        const ipc = setup();

        expect(await ipc.invoke('session-recorder:state')).toEqual({ visible: false });
        expect(await ipc.invoke('session-recorder:set-on', true)).toEqual({ visible: false });
        await flush();

        expect(settings.sessionRecorder).toBeUndefined();
        expect(spawn).not.toHaveBeenCalled();
    });

    test('turning it on downloads the checked jar, starts it with Microbot and shows its status', async () => {
        const ipc = setup();

        const view = await ipc.invoke('session-recorder:set-on', true);
        await flush();

        expect(view).toMatchObject({ visible: true, on: true });
        expect(settings.sessionRecorder).toBe(true);
        expect(children).toHaveLength(1);
        const jar = path.join(dir, 'session-recorder-1.0.0.jar');
        expect(children[0].command).toBe('/jdk/bin/java');
        expect(children[0].args).toEqual(['-jar', jar, '--agent', '/home/p/.microbot/loader/agent.jar']);
        expect(fs.readFileSync(jar)).toEqual(JAR);

        say(children[0], 'RuneLite log line\n' + STATUS_PREFIX + '{"state":"ready","message":"On. Press Open RuneLite to start a recorded RuneLite.","recording":0,"unrecorded":1}\n');

        expect(sent.at(-1)).toEqual({ visible: true, on: true, running: true, message: 'On. Press Open RuneLite to start a recorded RuneLite.' });
        expect(await ipc.invoke('session-recorder:open')).toEqual({ ok: true, message: 'RuneLite is starting through the Session Recorder.' });
        expect(children[0].written).toEqual(['open\n']);
    });

    test('opening before it is ready says so and sends nothing', async () => {
        const ipc = setup();
        await ipc.invoke('session-recorder:set-on', true);
        await flush();

        expect((await ipc.invoke('session-recorder:open')).ok).toBe(false);
        expect(children[0].written).toEqual([]);
    });

    test('a damaged download is refused and nothing starts', async () => {
        served = Buffer.from('PK\u0003\u0004 something else entirely');
        const ipc = setup();

        await ipc.invoke('session-recorder:set-on', true);
        await flush();

        expect(spawn).not.toHaveBeenCalled();
        expect(sent.at(-1).message).toBe('The Session Recorder download was damaged. Try again in a minute.');
    });

    test('turning it off asks the recorder to stop', async () => {
        const ipc = setup();
        await ipc.invoke('session-recorder:set-on', true);
        await flush();

        const view = await ipc.invoke('session-recorder:set-on', false);

        expect(view.on).toBe(false);
        expect(children[0].written).toEqual(['stop\n']);
    });

    test('it starts on its own when it was left on', async () => {
        settings.sessionRecorder = true;
        const ipc = setup();

        await ipc.invoke('session-recorder:state');
        await flush();

        expect(children).toHaveLength(1);
    });

    test('a crash shows a message and is not restarted in a loop', async () => {
        const ipc = setup();
        await ipc.invoke('session-recorder:set-on', true);
        await flush();

        children[0].emit('close', 1);
        const view = await ipc.invoke('session-recorder:state');
        await flush();

        expect(view.message).toBe('The Session Recorder stopped. Turn it off and on to start it again.');
        expect(children).toHaveLength(1);
    });

    test('parsing refuses odd answers', () => {
        expect(parseInfo({ ...{ version: '1.0.0', sha256: JAR_SHA, size: 10, url: 'https://evil.example/x' } })).toBeNull();
        expect(parseInfo({ version: '../1', sha256: JAR_SHA, size: 10, url: '/api/loader/recorder' })).toBeNull();
        expect(parseStatus('not json')).toBeNull();
        expect(parseStatus('{"state":"ready","message":"' + 'x'.repeat(400) + '"}').message).toHaveLength(300);
    });
});
