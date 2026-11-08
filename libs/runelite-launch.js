const path = require('path');

const FLATPAK_ID = 'net.runelite.RuneLite';
const SPAWN_WAIT_MS = 3000;
const APPIMAGE_PATTERN = /runelite.*\.appimage$/i;
const MENTIONS_RUNELITE = /runelite/i;
const FIELD_CODES = /%[fFuUdDnNickvm]/g;
const POSIX_ENV = [
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'PATH',
    'LANG',
    'LANGUAGE',
    'TZ',
    'TMPDIR',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XAUTHORITY',
    'DBUS_SESSION_BUS_ADDRESS'
];
const POSIX_PREFIXES = ['LC_', 'XDG_'];
const WINDOWS_ENV = [
    'ALLUSERSPROFILE',
    'APPDATA',
    'COMMONPROGRAMFILES',
    'COMMONPROGRAMFILES(X86)',
    'COMMONPROGRAMW6432',
    'COMPUTERNAME',
    'COMSPEC',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS',
    'OS',
    'PATH',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'PUBLIC',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'USERDOMAIN',
    'USERNAME',
    'USERPROFILE',
    'WINDIR'
];

function cleanEnv(env, platform) {
    const result = {};
    Object.entries(env || {}).forEach(([key, value]) => {
        if (typeof value !== 'string') return;
        const keep =
            platform === 'win32'
                ? WINDOWS_ENV.includes(key.toUpperCase())
                : POSIX_ENV.includes(key) || POSIX_PREFIXES.some((prefix) => key.startsWith(prefix));
        if (keep) result[key] = value;
    });
    return result;
}

function splitExec(exec) {
    const text = String(exec || '').replace(FIELD_CODES, '').replace(/%%/g, '%');
    const words = [];
    let current = '';
    let quoted = false;
    let started = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quoted && char === '\\' && index + 1 < text.length) {
            current += text[index + 1];
            index += 1;
        } else if (char === '"') {
            quoted = !quoted;
            started = true;
        } else if (!quoted && /\s/.test(char)) {
            if (started) words.push(current);
            current = '';
            started = false;
        } else {
            current += char;
            started = true;
        }
    }
    if (started) words.push(current);
    return words;
}

function parseDesktopEntry(text) {
    let inEntry = false;
    const fields = {};
    String(text || '')
        .split(/\r?\n/)
        .forEach((raw) => {
            const line = raw.trim();
            if (!line || line.startsWith('#')) return;
            if (line.startsWith('[')) {
                inEntry = line === '[Desktop Entry]';
                return;
            }
            if (!inEntry) return;
            const equals = line.indexOf('=');
            if (equals < 0) return;
            const key = line.slice(0, equals).trim();
            if (key === 'Name' || key === 'Exec' || key === 'Type' || key === 'Hidden') {
                if (!(key in fields)) fields[key] = line.slice(equals + 1).trim();
            }
        });
    return fields;
}

function makeFinder({ fs, platform, env = {}, home }) {
    const exists = (file) => {
        try {
            return fs.existsSync(file);
        } catch (error) {
            return false;
        }
    };

    const isFile = (file) => {
        try {
            return fs.statSync(file).isFile();
        } catch (error) {
            return false;
        }
    };

    const isExecutable = (file) => {
        try {
            const stat = fs.statSync(file);
            return stat.isFile() && (stat.mode & 0o111) !== 0;
        } catch (error) {
            return false;
        }
    };

    const list = (directory) => {
        try {
            return exists(directory) ? fs.readdirSync(directory) : [];
        } catch (error) {
            return [];
        }
    };

    const onPath = (names) => {
        const dirs = String(env.PATH || '').split(':').filter(Boolean);
        for (const dir of dirs) {
            for (const name of names) {
                const file = path.posix.join(dir, name);
                if (isExecutable(file)) return file;
            }
        }
        return null;
    };

    const windows = () => {
        const roots = [
            env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'RuneLite', 'RuneLite.exe'),
            env.ProgramFiles && path.win32.join(env.ProgramFiles, 'RuneLite', 'RuneLite.exe'),
            env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'RuneLite', 'RuneLite.exe')
        ].filter(Boolean);
        const found = roots.find(isFile);
        return found ? { command: found, args: [], source: 'installed', label: found } : null;
    };

    const mac = () => {
        const apps = ['/Applications/RuneLite.app', home && path.posix.join(home, 'Applications', 'RuneLite.app')].filter(Boolean);
        const found = apps.find(exists);
        return found ? { command: 'open', args: ['-a', found], source: 'app', label: found } : null;
    };

    const flatpak = () => {
        const installs = [
            '/var/lib/flatpak/app/' + FLATPAK_ID,
            home && path.posix.join(home, '.local', 'share', 'flatpak', 'app', FLATPAK_ID)
        ].filter(Boolean);
        if (!installs.some(exists)) return null;
        const command = onPath(['flatpak']) || (isExecutable('/usr/bin/flatpak') ? '/usr/bin/flatpak' : null);
        return command ? { command, args: ['run', FLATPAK_ID], source: 'flatpak', label: `flatpak ${FLATPAK_ID}` } : null;
    };

    const snap = () => {
        const file = '/snap/bin/runelite';
        return isExecutable(file) ? { command: file, args: [], source: 'snap', label: file } : null;
    };

    const pathCommand = () => {
        const file = onPath(['runelite', 'RuneLite']);
        return file ? { command: file, args: [], source: 'path', label: file } : null;
    };

    const desktopEntries = () => {
        const dirs = [home && path.posix.join(home, '.local', 'share', 'applications'), '/usr/share/applications'].filter(Boolean);
        for (const dir of dirs) {
            const names = list(dir).filter((name) => name.endsWith('.desktop')).sort();
            for (const name of names) {
                let fields;
                try {
                    fields = parseDesktopEntry(fs.readFileSync(path.posix.join(dir, name), 'utf8'));
                } catch (error) {
                    continue;
                }
                if (fields.Hidden === 'true' || (fields.Type && fields.Type !== 'Application')) continue;
                if (!MENTIONS_RUNELITE.test(fields.Name || '') && !MENTIONS_RUNELITE.test(fields.Exec || '')) continue;
                const words = splitExec(fields.Exec);
                if (!words.length) continue;
                const command = words[0].includes('/') ? words[0] : onPath([words[0]]);
                if (!command || !exists(command)) continue;
                return { command, args: words.slice(1), source: 'desktop', label: path.posix.join(dir, name) };
            }
        }
        return null;
    };

    const appImages = () => {
        const dirs = ['Applications', 'Downloads', path.posix.join('.local', 'bin'), 'bin']
            .map((dir) => home && path.posix.join(home, dir))
            .filter(Boolean)
            .concat(['/opt']);
        const candidates = [];
        dirs.forEach((dir) => {
            list(dir).forEach((name) => {
                const file = path.posix.join(dir, name);
                if (APPIMAGE_PATTERN.test(name) && isFile(file)) candidates.push(file);
                else if (dir === '/opt' && MENTIONS_RUNELITE.test(name)) {
                    list(file)
                        .filter((inner) => APPIMAGE_PATTERN.test(inner))
                        .forEach((inner) => isFile(path.posix.join(file, inner)) && candidates.push(path.posix.join(file, inner)));
                }
            });
        });
        if (!candidates.length) return null;
        const newest = candidates
            .map((file) => ({ file, time: fs.statSync(file).mtimeMs || 0 }))
            .sort((a, b) => b.time - a.time)[0].file;
        return { command: newest, args: [], source: 'appimage', label: newest };
    };

    const search = () => {
        if (platform === 'win32') return windows();
        if (platform === 'darwin') return mac();
        for (const step of [flatpak, snap, pathCommand, desktopEntries, appImages]) {
            const found = step();
            if (found) return found;
        }
        return null;
    };

    const fromPath = (file) => {
        if (typeof file !== 'string' || !file || !exists(file)) return null;
        if (platform === 'darwin' && /\.app\/?$/i.test(file)) return { command: 'open', args: ['-a', file], source: 'chosen', label: file };
        if (!isFile(file)) return null;
        return { command: file, args: [], source: 'chosen', label: file };
    };

    const find = (remembered) => fromPath(remembered) || search();

    return { find, search, fromPath };
}

function launch({ spawn, spec, env, platform, home, waitMs = SPAWN_WAIT_MS }) {
    return new Promise((resolve) => {
        let done = false;
        let timer = null;
        const finish = (result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(result);
        };
        let child;
        try {
            child = spawn(spec.command, spec.args, {
                detached: true,
                stdio: 'ignore',
                env: cleanEnv(env, platform),
                cwd: home || undefined,
                windowsHide: false
            });
        } catch (error) {
            finish({ ok: false, error });
            return;
        }
        child.on('error', (error) => finish({ ok: false, error }));
        child.on('spawn', () => finish({ ok: true }));
        timer = setTimeout(() => finish({ ok: true }), waitMs);
        try {
            child.unref();
        } catch (_) {}
    });
}

module.exports = { FLATPAK_ID, cleanEnv, splitExec, parseDesktopEntry, makeFinder, launch };
