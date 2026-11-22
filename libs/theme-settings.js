// ~/.microbot/theme.json: the look picked in Themes; the client reads the same file at startup.
// A theme that is missing or not one of the names below counts as not picked: the launcher then keeps its own look
// (Gold) and the client keeps the stock RuneLite look (Classic). A custom pick carries every resolved colour
// ({theme:'custom', id, custom}), so the client never has to read the theme file. Other keys are dropped.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BUILT_IN, BASES, CLIENT_KEYS, LAUNCHER_VARS, cleanStyle, cleanBackground, readable } = require('./custom-theme');

const THEMES = BUILT_IN;
const ID = /^[a-z0-9-]{1,40}$/;
const HEX = /^#[0-9a-f]{6}$/i;

// every key present as #rrggbb, lower-cased; null when one is missing
function fullColors(raw, keys) {
    const ok = raw !== null && typeof raw === 'object' && keys.every((k) => Object.hasOwn(raw, k) && typeof raw[k] === 'string' && HEX.test(raw[k]));
    return ok ? Object.fromEntries(keys.map((k) => [k, raw[k].toLowerCase()])) : null;
}

function cleanCustom(value) {
    const c = value.custom;
    if (typeof value.id !== 'string' || !ID.test(value.id) || !c || typeof c !== 'object' || !BUILT_IN.includes(c.base)) return {};
    const colors = fullColors(c.colors, CLIENT_KEYS);
    const launcher = fullColors(c.launcher, LAUNCHER_VARS);
    // the picker refuses an unreadable theme, so one here was written by hand or by an older launcher
    if (!colors || !launcher || !readable({ base: c.base, client: colors, launcher })) return {};
    return {
        theme: 'custom',
        id: value.id,
        custom: { base: c.base, colors, style: cleanStyle(c.style), launcher, background: c.background ? cleanBackground(c.background) : null },
    };
}

// only a known theme, lower-cased the way the client compares it
function clean(value) {
    const v = typeof value?.theme === 'string' ? value.theme.trim().toLowerCase() : '';
    if (v === 'custom') return cleanCustom(value);
    return THEMES.includes(v) ? { theme: v } : {};
}

function settingsFile(home = os.homedir()) {
    return path.join(home, '.microbot', 'theme.json');
}

function read(home) {
    try {
        return clean(JSON.parse(fs.readFileSync(settingsFile(home), 'utf8')));
    } catch {
        return {};
    }
}

// write a temp file and rename it over, so a reader starting now never reads half a file
function writeAtomic(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temp, text);
        fs.renameSync(temp, file);
    } catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
    }
}

function write(value, home) {
    // a value with a theme replaces the file; one without keeps the saved theme
    const cleaned = clean(value);
    if (value?.theme === 'custom' && !cleaned.theme) return { error: 'That theme is incomplete or too hard to read.' };
    const next = cleaned.theme ? cleaned : read(home);
    writeAtomic(settingsFile(home), JSON.stringify(next, null, 2));
    return next;
}

// The launcher's main colours for windows outside the renderer (Jagex login page, captcha); null when no theme is
// picked, so those windows keep their own original colours. read() has checked every custom colour is #rrggbb, so
// they are safe to put in HTML and CSS.
function launcherColors(home) {
    const picked = read(home);
    if (!picked.theme) return null;
    const l = picked.theme === 'custom' ? picked.custom.launcher : BASES[picked.theme].launcher;
    return { bg: l.bg, surface: l.surface, text: l.text, textStrong: l['text-strong'], accent: l.gold, onAccent: l['on-gold'], line: l.line, red: l.red };
}

function register(ipcMain, log) {
    ipcMain.removeHandler('theme:read');
    ipcMain.removeHandler('theme:write');
    ipcMain.handle('theme:read', async () => read());
    ipcMain.handle('theme:write', async (_event, value) => {
        try {
            return write(value);
        } catch (error) {
            log?.error('Could not save theme.json:', error.message);
            return { error: error.message };
        }
    });
}

module.exports = { THEMES, clean, read, write, writeAtomic, register, settingsFile, launcherColors };
