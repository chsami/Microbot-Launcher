// ~/.microbot/themes/*.json: the player's own themes (format 1, see custom-theme.js), plus the background images
// they reference. Every value read from disk or from the renderer is cleaned here before it is used.
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const { BASES, clean, cleanBackground, slug, uniqueName } = require('./custom-theme');
const { writeAtomic, launcherColors } = require('./theme-settings');

const GUIDE_PAGE = path.join(__dirname, 'theme-guide.html');
const HEX = /^#[0-9a-f]{6}$/i;
// launcherColors() key -> CSS variable of theme-guide.html (muted keeps its own default: launcherColors has no such colour)
const GUIDE_VARS = { bg: '--bg', surface: '--surface', text: '--text', textStrong: '--text-strong', accent: '--gold', line: '--line', red: '--red' };
const ID = /^[a-z0-9-]{1,40}$/;
const MAX_THEME = 64 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_IMAGES = 100;
const MAX_SIDE = 8192;
const MAX_PIXELS = 40000000;
const BUILT_IN_NAMES = ['Gold', 'Slate', 'Classic RuneLite'];
const GONE = { error: 'That theme no longer exists.' };
const BAD_ID = { error: 'That is not a theme id.' };

function themesDir(home = os.homedir()) {
    return path.join(home, '.microbot', 'themes');
}

// regular files only: no folders, no symlinks pointing out of the themes folder
function stat(file) {
    try {
        const s = fs.lstatSync(file);
        return s.isFile() ? s : null;
    } catch {
        return null;
    }
}

function readTheme(file) {
    const s = stat(file);
    if (!s) return GONE;
    if (s.size > MAX_THEME) return { error: 'This file is too big to be a theme.' };
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return { error: 'This file is not valid theme JSON.' };
    }
    return clean(raw);
}

function readDir(dir) {
    try {
        return fs.readdirSync(dir).sort();
    } catch {
        return [];
    }
}

function list(home) {
    const dir = themesDir(home);
    const entries = [];
    for (const name of readDir(dir).filter((n) => n.endsWith('.json')).slice(0, MAX_FILES)) {
        if (!stat(path.join(dir, name))) continue;
        const id = name.slice(0, -'.json'.length);
        if (!ID.test(id)) {
            entries.push({ id: name, error: 'Rename this file using only a-z, 0-9 and -, like midnight.json.' });
            continue;
        }
        entries.push({ id, ...readTheme(path.join(dir, name)) });
    }
    const key = (e) => (e.theme ? e.theme.name : e.id).toLowerCase();
    return entries.sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
}

// reserves the first free id from the name's slug (-2, -3 …) by creating the file, so two windows never share one
function reserveId(name, dir) {
    const stem = slug(name);
    for (let n = 1; ; n++) {
        const suffix = n === 1 ? '' : '-' + n;
        const id = stem.slice(0, 40 - suffix.length).replace(/-+$/, '') + suffix;
        try {
            fs.closeSync(fs.openSync(path.join(dir, id + '.json'), 'wx'));
            return id;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
}

function save(raw, id, home) {
    const cleaned = clean(raw);
    if (cleaned.error) return cleaned;
    const theme = cleaned.theme;
    const dir = themesDir(home);
    if (id !== undefined) {
        if (typeof id !== 'string' || !ID.test(id)) return BAD_ID;
        const file = path.join(dir, id + '.json');
        if (!stat(file)) return GONE;
        writeAtomic(file, JSON.stringify(theme, null, 2));
        return { id, theme };
    }
    // list() shows only the first MAX_FILES, so a new file past them would be saved but never listed
    if (readDir(dir).filter((n) => n.endsWith('.json')).length >= MAX_FILES) {
        return { error: 'You have ' + MAX_FILES + ' theme files, the most Themes can list. Delete one to save a new theme.' };
    }
    // the id comes from the name as given (Gold -> gold-theme), the shown name gets the (2)
    fs.mkdirSync(dir, { recursive: true });
    const newId = reserveId(theme.name, dir);
    const taken = [...BUILT_IN_NAMES, ...list(home).filter((e) => e.id !== newId && e.theme).map((e) => e.theme.name)];
    theme.name = uniqueName(theme.name, taken);
    const file = path.join(dir, newId + '.json');
    try {
        writeAtomic(file, JSON.stringify(theme, null, 2));
    } catch (error) {
        fs.rmSync(file, { force: true });
        throw error;
    }
    return { id: newId, theme };
}

function remove(id, home) {
    if (typeof id !== 'string' || !ID.test(id)) return BAD_ID;
    const file = path.join(themesDir(home), id + '.json');
    if (!stat(file)) return GONE;
    fs.rmSync(file);
    return { ok: true };
}

const imageName = (name) => typeof name === 'string' && path.basename(name) === name && cleanBackground({ image: name }) !== null;

function images(home) {
    const dir = themesDir(home);
    return readDir(dir).filter((n) => imageName(n) && stat(path.join(dir, n))?.size <= MAX_IMAGE).slice(0, MAX_IMAGES);
}

function imageType(b) {
    if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

// width and height from the header, or null when the header is cut short or makes no sense
function imageSize(b, type) {
    if (type === 'image/png') {
        if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
        return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (type === 'image/jpeg') {
        // walk the segments to the first frame header (SOF0-SOF15, minus DHT C4, JPG C8 and DAC CC)
        let i = 2;
        while (i + 4 <= b.length) {
            if (b[i] !== 0xff) return null;
            const marker = b[i + 1];
            if (marker === 0xff) {
                i++; // fill byte
                continue;
            }
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
                i += 2; // markers without a length
                continue;
            }
            if (marker === 0xd9 || marker === 0xda) return null; // end of image or scan data before any frame
            const length = b.readUInt16BE(i + 2);
            if (length < 2) return null;
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                return i + 9 <= b.length ? { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) } : null;
            }
            i += 2 + length;
        }
        return null;
    }
    const chunk = b.toString('latin1', 12, 16);
    if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X' && b.length >= 30) return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    return null;
}

function readImage(name, home) {
    if (!imageName(name)) return { error: 'That is not an image name.' };
    const dir = path.resolve(themesDir(home));
    const file = path.resolve(dir, name);
    if (path.dirname(file) !== dir) return { error: 'That is not an image name.' };
    const s = stat(file);
    if (!s) return { error: 'That image is not in the themes folder.' };
    if (s.size > MAX_IMAGE) return { error: 'That image is bigger than 5 MB.' };
    const bytes = fs.readFileSync(file);
    const type = imageType(bytes);
    if (!type) return { error: 'That file is not a PNG, JPEG or WebP image.' };
    // a small file can still decode to gigabytes, so the size in the header decides
    const size = imageSize(bytes, type);
    if (!size || !size.width || !size.height || size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS) {
        return { error: 'This image is too large or not a valid image.' };
    }
    return { bytes: new Uint8Array(bytes), type };
}

async function exportFile(id, dialog, home) {
    if (typeof id !== 'string' || !ID.test(id)) return BAD_ID;
    const read = readTheme(path.join(themesDir(home), id + '.json'));
    if (read.error) return read;
    const result = await dialog.showSaveDialog({ defaultPath: id + '.json', filters: [{ name: 'Theme', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(read.theme, null, 2));
    return { ok: true };
}

// Gold when no theme is picked: unlike the login and captcha pages, the guide has no original colours of its own
function guideColors() {
    const g = BASES.gold.launcher;
    return launcherColors() || { bg: g.bg, surface: g.surface, text: g.text, textStrong: g['text-strong'], accent: g.gold, line: g.line, red: g.red };
}

function guideCss() {
    const colors = guideColors();
    const rules = Object.entries(GUIDE_VARS).filter(([key]) => HEX.test(colors[key])).map(([key, name]) => `${name}: ${colors[key]};`);
    // the macOS traffic lights sit over the left of the title strip
    rules.push(`--title-left: ${process.platform === 'darwin' ? 80 : 16}px;`);
    return `html:root { ${rules.join(' ')} }`;
}

// title bar overlay colours of the guide, Gold where a colour is not #rrggbb
function titleBarColors() {
    const colors = guideColors();
    const gold = BASES.gold.launcher;
    return { color: HEX.test(colors.bg) ? colors.bg : gold.bg, symbolColor: HEX.test(colors.text) ? colors.text : gold.text };
}

// page: the file main.js loads into the launcher window
function register(ipcMain, shell, log, dialog, page = path.join(__dirname, '..', 'index.html'), BrowserWindow) {
    let guide = null;
    const openGuide = async (event) => {
        if (guide && !guide.isDestroyed()) {
            guide.focus();
            return { ok: true };
        }
        BrowserWindow ??= require('electron').BrowserWindow; // only now: tests and worktrees may lack the Electron binary
        const bar = titleBarColors();
        const mac = process.platform === 'darwin';
        const win = new BrowserWindow({
            width: 820,
            height: 720,
            title: 'How to make a theme',
            autoHideMenuBar: true,
            ...(mac ? { titleBarStyle: 'hiddenInset' } : { titleBarStyle: 'hidden', titleBarOverlay: { ...bar, height: 36 } }),
            backgroundColor: bar.color, // no white flash before the page paints
            parent: BrowserWindow.fromWebContents(event.sender) || undefined,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        guide = win;
        win.once('closed', () => {
            if (guide === win) guide = null;
        });
        let cssKey = null;
        let generation = 0;
        const drop = (key) => win.webContents.removeInsertedCSS(key).catch(() => {});
        const restyle = async () => {
            // insert first, then drop the old block, so the page never shows without theme colours
            const mine = ++generation;
            const key = await win.webContents.insertCSS(guideCss());
            if (mine !== generation) return drop(key); // a newer restyle started meanwhile: it owns the colours
            const old = cssKey;
            cssKey = key;
            if (old) await drop(old);
        };
        win.webContents.on('did-finish-load', restyle);
        // the launcher theme may have changed while the guide sat behind it
        win.on('focus', async () => {
            const next = titleBarColors();
            win.setBackgroundColor(next.color);
            if (!mac && typeof win.setTitleBarOverlay === 'function') win.setTitleBarOverlay(next);
            if (cssKey) await restyle();
        });
        win.webContents.on('will-navigate', (e) => e.preventDefault());
        win.webContents.setWindowOpenHandler(({ url: target }) => {
            if (/^https?:\/\//i.test(target)) shell.openExternal(target);
            return { action: 'deny' };
        });
        try {
            await win.loadFile(GUIDE_PAGE);
        } catch (error) {
            log?.error('Could not open the theme guide:', error.message);
            if (guide === win) guide = null;
            if (!win.isDestroyed()) win.destroy();
            return { error: 'Could not open the guide.' };
        }
        return { ok: true };
    };
    const pageUrl = url.pathToFileURL(page).href;
    const fromPage = (event) => {
        try {
            const sender = new URL(String(event?.senderFrame?.url ?? ''));
            sender.hash = '';
            sender.search = '';
            return sender.href === pageUrl;
        } catch {
            return false;
        }
    };
    const channels = {
        'themes:list': () => list(),
        'themes:save': (theme, id) => save(theme, id),
        'themes:delete': (id) => remove(id),
        'themes:images': () => images(),
        'themes:image': (name) => readImage(name),
        'themes:export': (id) => exportFile(id, dialog),
        'themes:open-folder': async () => {
            fs.mkdirSync(themesDir(), { recursive: true });
            const problem = await shell.openPath(themesDir());
            return problem ? { error: problem } : { ok: true };
        },
        'themes:open-guide': function () {
            return openGuide(this); // this = the IPC event
        },
    };
    for (const [name, fn] of Object.entries(channels)) {
        ipcMain.removeHandler(name);
        ipcMain.handle(name, async (event, ...args) => {
            // only the launcher's own page, never a webview or a remote page
            if (!fromPage(event)) return { error: 'Not allowed.' };
            try {
                return await fn.call(event, ...args);
            } catch (error) {
                log?.error(`${name} failed:`, error.message);
                return { error: error.message };
            }
        });
    }
}

module.exports = { themesDir, list, save, remove, images, readImage, exportFile, register };
