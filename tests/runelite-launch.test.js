const EventEmitter = require('events');
const path = require('path');
const { cleanEnv, splitExec, parseDesktopEntry, makeFinder, launch, describeSpec, FLATPAK_ID } = require('../libs/runelite-launch');

function fakeFs(entries) {
    const files = new Map();
    const add = (file, value) => {
        files.set(file, value);
        const parent = file.includes('\\') ? path.win32.dirname(file) : path.posix.dirname(file);
        if (parent !== file && !files.has(parent)) add(parent, { dir: true });
    };
    Object.entries(entries).forEach(([file, value]) => add(file, typeof value === 'string' ? { content: value, mode: 0o644 } : value));
    return {
        existsSync: (file) => files.has(file),
        statSync: (file) => {
            const value = files.get(file);
            if (!value) throw Object.assign(new Error(`ENOENT ${file}`), { code: 'ENOENT' });
            return { isFile: () => !value.dir, isDirectory: () => Boolean(value.dir), mode: value.mode ?? 0o755, mtimeMs: value.mtime || 0 };
        },
        readdirSync: (dir) => {
            const sep = dir.includes('\\') ? '\\' : '/';
            const prefix = dir.endsWith(sep) ? dir : dir + sep;
            return [...files.keys()].filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes(sep)).map((file) => file.slice(prefix.length));
        },
        readFileSync: (file) => {
            const value = files.get(file);
            if (!value || value.dir) throw new Error(`ENOENT ${file}`);
            return value.content || '';
        }
    };
}

const exe = { mode: 0o755 };
const HOME = '/home/zezima';
const linuxEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME };

describe('finding RuneLite', () => {
    describe('Windows', () => {
        const env = {
            LOCALAPPDATA: 'C:\\Users\\Zezima\\AppData\\Local',
            ProgramFiles: 'C:\\Program Files',
            'ProgramFiles(x86)': 'C:\\Program Files (x86)'
        };
        const find = (entries) => makeFinder({ fs: fakeFs(entries), platform: 'win32', env, home: 'C:\\Users\\Zezima' }).find(null);

        test('the per-user install comes first', () => {
            expect(find({
                'C:\\Users\\Zezima\\AppData\\Local\\RuneLite\\RuneLite.exe': exe,
                'C:\\Program Files\\RuneLite\\RuneLite.exe': exe
            })).toEqual({ command: 'C:\\Users\\Zezima\\AppData\\Local\\RuneLite\\RuneLite.exe', args: [], source: 'installed', label: 'C:\\Users\\Zezima\\AppData\\Local\\RuneLite\\RuneLite.exe' });
        });

        test('then Program Files, then Program Files (x86)', () => {
            expect(find({ 'C:\\Program Files\\RuneLite\\RuneLite.exe': exe, 'C:\\Program Files (x86)\\RuneLite\\RuneLite.exe': exe }).command).toBe('C:\\Program Files\\RuneLite\\RuneLite.exe');
            expect(find({ 'C:\\Program Files (x86)\\RuneLite\\RuneLite.exe': exe }).command).toBe('C:\\Program Files (x86)\\RuneLite\\RuneLite.exe');
        });

        test('nothing installed finds nothing', () => {
            expect(find({})).toBeNull();
        });
    });

    describe('macOS', () => {
        const find = (entries) => makeFinder({ fs: fakeFs(entries), platform: 'darwin', env: {}, home: '/Users/zezima' }).find(null);

        test('/Applications first, opened with open -a', () => {
            expect(find({ '/Applications/RuneLite.app': { dir: true }, '/Users/zezima/Applications/RuneLite.app': { dir: true } })).toMatchObject({
                command: 'open',
                args: ['-a', '/Applications/RuneLite.app']
            });
        });

        test('then ~/Applications', () => {
            expect(find({ '/Users/zezima/Applications/RuneLite.app': { dir: true } }).args).toEqual(['-a', '/Users/zezima/Applications/RuneLite.app']);
        });

        test('nothing installed finds nothing', () => {
            expect(find({})).toBeNull();
        });
    });

    describe('Linux', () => {
        const everything = {
            [`/var/lib/flatpak/app/${FLATPAK_ID}`]: { dir: true },
            '/usr/bin/flatpak': exe,
            '/snap/bin/runelite': exe,
            '/usr/local/bin/runelite': exe,
            [`${HOME}/.local/share/applications/runelite.desktop`]: '[Desktop Entry]\nName=RuneLite\nExec=/opt/runelite/RuneLite.AppImage %U\n',
            '/opt/runelite/RuneLite.AppImage': exe,
            [`${HOME}/Downloads/RuneLite.AppImage`]: exe
        };
        const find = (entries, env = linuxEnv) => makeFinder({ fs: fakeFs(entries), platform: 'linux', env, home: HOME }).find(null);
        const without = (...keys) => Object.fromEntries(Object.entries(everything).filter(([key]) => !keys.some((k) => key.startsWith(k))));

        test('flatpak first', () => {
            expect(find(everything)).toMatchObject({ command: '/usr/bin/flatpak', args: ['run', FLATPAK_ID], source: 'flatpak' });
        });

        test('a per-user flatpak counts too', () => {
            expect(find({ ...without('/var/lib/flatpak'), [`${HOME}/.local/share/flatpak/app/${FLATPAK_ID}`]: { dir: true } }).source).toBe('flatpak');
        });

        test('then the snap', () => {
            expect(find(without('/var/lib/flatpak'))).toMatchObject({ command: '/snap/bin/runelite', args: [], source: 'snap' });
        });

        test('then runelite or RuneLite on PATH', () => {
            expect(find(without('/var/lib/flatpak', '/snap'))).toMatchObject({ command: '/usr/local/bin/runelite', source: 'path' });
            expect(find({ '/usr/bin/RuneLite': exe })).toMatchObject({ command: '/usr/bin/RuneLite', source: 'path' });
        });

        test('a file on PATH that cannot run is skipped', () => {
            expect(find({ '/usr/bin/runelite': { mode: 0o644 } })).toBeNull();
        });

        test('then a .desktop file, using its Exec without field codes', () => {
            expect(find(without('/var/lib/flatpak', '/snap', '/usr/local/bin'))).toMatchObject({
                command: '/opt/runelite/RuneLite.AppImage',
                args: [],
                source: 'desktop'
            });
        });

        test('a .desktop file whose program is gone is skipped', () => {
            expect(find({ [`${HOME}/.local/share/applications/runelite.desktop`]: '[Desktop Entry]\nName=RuneLite\nExec=/gone/RuneLite %U\n' })).toBeNull();
        });

        test('the system applications folder is read after the user one', () => {
            expect(find({
                '/usr/share/applications/rl.desktop': '[Desktop Entry]\nName=Old School\nExec=/usr/games/runelite-launcher --mode=JVM %F\n',
                '/usr/games/runelite-launcher': exe
            })).toMatchObject({ command: '/usr/games/runelite-launcher', args: ['--mode=JVM'], source: 'desktop' });
        });

        test('other .desktop files are ignored', () => {
            expect(find({
                '/usr/share/applications/firefox.desktop': '[Desktop Entry]\nName=Firefox\nExec=/usr/bin/firefox %u\n',
                '/usr/bin/firefox': exe
            })).toBeNull();
        });

        test('then the newest RuneLite AppImage in the usual folders', () => {
            expect(find({
                [`${HOME}/Downloads/RuneLite.AppImage`]: { mode: 0o755, mtime: 100 },
                [`${HOME}/Applications/runelite-2.7.AppImage`]: { mode: 0o755, mtime: 200 },
                [`${HOME}/Downloads/Microbot-Launcher.AppImage`]: { mode: 0o755, mtime: 300 }
            })).toMatchObject({ command: `${HOME}/Applications/runelite-2.7.AppImage`, args: [], source: 'appimage' });
        });

        test('an AppImage in ~/Downloads is found', () => {
            expect(find({ [`${HOME}/Downloads/RuneLite.AppImage`]: exe })).toMatchObject({ command: `${HOME}/Downloads/RuneLite.AppImage`, source: 'appimage' });
        });

        test('AppImages in ~/.local/bin, ~/bin and /opt are found', () => {
            expect(find({ [`${HOME}/.local/bin/RuneLite.AppImage`]: exe }).source).toBe('appimage');
            expect(find({ [`${HOME}/bin/RuneLite.AppImage`]: exe }).source).toBe('appimage');
            expect(find({ '/opt/RuneLite.AppImage': exe }).source).toBe('appimage');
            expect(find({ '/opt/RuneLite/RuneLite.AppImage': exe }).command).toBe('/opt/RuneLite/RuneLite.AppImage');
        });

        test('nothing installed finds nothing', () => {
            expect(find({})).toBeNull();
        });
    });

    describe('a remembered path', () => {
        test('wins over the search', () => {
            const finder = makeFinder({ fs: fakeFs({ '/snap/bin/runelite': exe, [`${HOME}/games/rl.AppImage`]: exe }), platform: 'linux', env: linuxEnv, home: HOME });
            expect(finder.find(`${HOME}/games/rl.AppImage`)).toEqual({ command: `${HOME}/games/rl.AppImage`, args: [], source: 'chosen', label: `${HOME}/games/rl.AppImage` });
        });

        test('that no longer exists falls back to the search', () => {
            const finder = makeFinder({ fs: fakeFs({ '/snap/bin/runelite': exe }), platform: 'linux', env: linuxEnv, home: HOME });
            expect(finder.find(`${HOME}/games/rl.AppImage`).source).toBe('snap');
        });

        test('a chosen .app on macOS opens with open -a', () => {
            const finder = makeFinder({ fs: fakeFs({ '/Volumes/Games/RuneLite.app': { dir: true } }), platform: 'darwin', env: {}, home: '/Users/z' });
            expect(finder.find('/Volumes/Games/RuneLite.app')).toMatchObject({ command: 'open', args: ['-a', '/Volumes/Games/RuneLite.app'] });
        });

        test('a folder is not a program', () => {
            const finder = makeFinder({ fs: fakeFs({ '/home/z/games': { dir: true } }), platform: 'linux', env: linuxEnv, home: '/home/z' });
            expect(finder.fromPath('/home/z/games')).toBeNull();
        });
    });
});

describe('.desktop Exec lines', () => {
    test('field codes are dropped and %% kept as %', () => {
        expect(splitExec('/opt/RuneLite.AppImage %U')).toEqual(['/opt/RuneLite.AppImage']);
        expect(splitExec('runelite %f %F %u %d %D %n %N %i %c %k %v %m')).toEqual(['runelite']);
        expect(splitExec('runelite --label=100%%')).toEqual(['runelite', '--label=100%']);
    });

    test('quoted words and escapes', () => {
        expect(splitExec('"/home/z/My Games/RuneLite.AppImage" --scale "2"')).toEqual(['/home/z/My Games/RuneLite.AppImage', '--scale', '2']);
        expect(splitExec('"/opt/a \\"b\\"/run" ""')).toEqual(['/opt/a "b"/run', '']);
        expect(splitExec('env  JAVA_HOME=/x   runelite')).toEqual(['env', 'JAVA_HOME=/x', 'runelite']);
    });

    test('only the [Desktop Entry] group is read', () => {
        const text = [
            '# comment',
            '[Desktop Entry]',
            'Type=Application',
            'Name=RuneLite',
            'Name[de]=RuneLite DE',
            'Exec=/opt/RuneLite.AppImage %U',
            '[Desktop Action safe]',
            'Name=Safe mode',
            'Exec=/opt/RuneLite.AppImage --safe-mode'
        ].join('\n');
        expect(parseDesktopEntry(text)).toEqual({ Type: 'Application', Name: 'RuneLite', Exec: '/opt/RuneLite.AppImage %U' });
    });

    test('hidden entries and links are skipped', () => {
        const finder = (content) => makeFinder({ fs: fakeFs({ '/usr/share/applications/r.desktop': content, '/usr/bin/rl': exe }), platform: 'linux', env: { PATH: '' }, home: HOME });
        expect(finder('[Desktop Entry]\nName=RuneLite\nHidden=true\nExec=/usr/bin/rl\n').find(null)).toBeNull();
        expect(finder('[Desktop Entry]\nType=Link\nName=RuneLite\nExec=/usr/bin/rl\n').find(null)).toBeNull();
    });
});

describe('starting RuneLite', () => {
    const SECRETS = {
        MICROBOT_CLIENT_TOKEN: `mbc_${'S'.repeat(43)}`,
        JX_SESSION_ID: 'jagex-session',
        JX_CHARACTER_ID: 'character-98765',
        JX_DISPLAY_NAME: 'Zezima',
        JAVA_TOOL_OPTIONS: '-DsocksProxyHost=1.2.3.4',
        _JAVA_OPTIONS: '-Xmx8g',
        HTTPS_PROXY: 'http://user:pw@proxy:8080',
        ALL_PROXY: 'socks5://proxy:1080',
        APPIMAGE: '/home/z/Microbot-Launcher.AppImage',
        APPDIR: '/tmp/.mount_x',
        LD_LIBRARY_PATH: '/tmp/.mount_x/usr/lib',
        ELECTRON_RUN_AS_NODE: 'electron-as-node',
        NODE_OPTIONS: '--inspect'
    };

    const fakeSpawn = (behaviour = 'spawn') =>
        jest.fn(() => {
            const child = new EventEmitter();
            child.unref = jest.fn();
            setImmediate(() => (behaviour === 'spawn' ? child.emit('spawn') : child.emit('error', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }))));
            return child;
        });

    test('detached, ignoring stdio, no extra arguments, unref’d', async () => {
        const spawn = fakeSpawn();
        const spec = { command: `${HOME}/Downloads/RuneLite.AppImage`, args: [] };

        expect(await launch({ spawn, spec, env: { ...linuxEnv, DISPLAY: ':0' }, platform: 'linux', home: HOME })).toEqual({ ok: true });

        const [command, args, options] = spawn.mock.calls[0];
        expect(command).toBe(`${HOME}/Downloads/RuneLite.AppImage`);
        expect(args).toEqual([]);
        expect(options).toMatchObject({ detached: true, stdio: 'ignore', cwd: HOME });
        expect(spawn.mock.results[0].value.unref).toHaveBeenCalled();
    });

    test('passes no token, proxy or Jagex credentials, only what the desktop needs', async () => {
        const spawn = fakeSpawn();
        const env = { ...linuxEnv, DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', LANG: 'en_GB.UTF-8', LC_ALL: 'en_GB.UTF-8', ...SECRETS };

        await launch({ spawn, spec: { command: '/snap/bin/runelite', args: [] }, env, platform: 'linux', home: HOME });

        const [, args, options] = spawn.mock.calls[0];
        expect(options.env).toEqual({
            PATH: linuxEnv.PATH,
            HOME,
            DISPLAY: ':0',
            WAYLAND_DISPLAY: 'wayland-0',
            XDG_RUNTIME_DIR: '/run/user/1000',
            DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
            LANG: 'en_GB.UTF-8',
            LC_ALL: 'en_GB.UTF-8'
        });
        const everything = JSON.stringify([args, options]);
        Object.values(SECRETS).forEach((secret) => expect(everything).not.toContain(secret));
    });

    test('Windows keeps the system variables, case-insensitively, and nothing else', () => {
        const env = { SystemRoot: 'C:\\Windows', Path: 'C:\\Windows\\system32', USERPROFILE: 'C:\\Users\\Z', LOCALAPPDATA: 'C:\\Users\\Z\\AppData\\Local', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ...SECRETS };
        expect(cleanEnv(env, 'win32')).toEqual({
            SystemRoot: 'C:\\Windows',
            Path: 'C:\\Windows\\system32',
            USERPROFILE: 'C:\\Users\\Z',
            LOCALAPPDATA: 'C:\\Users\\Z\\AppData\\Local',
            'ProgramFiles(x86)': 'C:\\Program Files (x86)'
        });
    });

    test('a start that fails is reported', async () => {
        const result = await launch({ spawn: fakeSpawn('error'), spec: { command: '/x', args: [] }, env: {}, platform: 'linux', home: HOME });
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('EACCES');
    });

    test('a spawn that throws is reported', async () => {
        const spawn = jest.fn(() => {
            throw new Error('bad');
        });
        expect((await launch({ spawn, spec: { command: '/x', args: [] }, env: {}, platform: 'linux', home: HOME })).ok).toBe(false);
    });
});

describe('which RuneLite the card names', () => {
    test('home is shortened to ~', () => {
        expect(describeSpec({ command: '/home/zezima/Downloads/RuneLite.AppImage', args: [], source: 'appimage' }, '/home/zezima')).toBe('~/Downloads/RuneLite.AppImage');
        expect(describeSpec({ command: '/home/zezima2/RuneLite.AppImage', args: [], source: 'appimage' }, '/home/zezima')).toBe('/home/zezima2/RuneLite.AppImage');
        expect(describeSpec({ command: '/snap/bin/runelite', args: [], source: 'snap' }, '/home/zezima')).toBe('/snap/bin/runelite');
    });

    test('flatpak and macOS apps read naturally', () => {
        expect(describeSpec({ command: '/usr/bin/flatpak', args: ['run', FLATPAK_ID], source: 'flatpak' }, '/home/z')).toBe('flatpak net.runelite.RuneLite');
        expect(describeSpec({ command: 'open', args: ['-a', '/Users/z/Applications/RuneLite.app'], source: 'app' }, '/Users/z')).toBe('~/Applications/RuneLite.app');
    });

    test('Windows paths, case-insensitively', () => {
        expect(describeSpec({ command: 'C:\\Users\\Zezima\\AppData\\Local\\RuneLite\\RuneLite.exe', args: [], source: 'installed' }, 'c:\\users\\zezima')).toBe(
            '~\\AppData\\Local\\RuneLite\\RuneLite.exe'
        );
    });

    test('nothing found names nothing', () => {
        expect(describeSpec(null, '/home/z')).toBeNull();
    });
});

describe('early exits', () => {
    const spawned = () => {
        const child = new EventEmitter();
        child.unref = jest.fn();
        setImmediate(() => child.emit('spawn'));
        return child;
    };

    test('a non-zero exit soon after the start is reported', async () => {
        let child;
        const onEarlyExit = jest.fn();
        let clock = 1000;
        await launch({ spawn: () => (child = spawned()), spec: { command: '/x', args: [] }, env: {}, platform: 'linux', home: HOME, onEarlyExit, now: () => clock });
        clock = 3500;
        child.emit('exit', 1, null);

        expect(onEarlyExit).toHaveBeenCalledWith({ code: 1, signal: null, seconds: 2.5 });
    });

    test('a clean exit of a wrapper and a late exit are not', async () => {
        let child;
        const onEarlyExit = jest.fn();
        let clock = 0;
        await launch({ spawn: () => (child = spawned()), spec: { command: 'open', args: ['-a', '/Applications/RuneLite.app'] }, env: {}, platform: 'darwin', home: '/Users/z', onEarlyExit, now: () => clock });
        child.emit('exit', 0, null);
        clock = 60000;
        child.emit('exit', 1, null);

        expect(onEarlyExit).not.toHaveBeenCalled();
    });
});
