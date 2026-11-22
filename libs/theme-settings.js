// ~/.microbot/theme.json: the look picked in Themes; the client reads the same file at startup.
// A theme that is missing or not one of the names below counts as not picked: the launcher then keeps its own look
// (Gold) and the client keeps the stock RuneLite look (Classic). Other keys are dropped.
const fs = require('fs');
const os = require('os');
const path = require('path');

const THEMES = ['gold', 'slate', 'classic'];

// only a known theme, lower-cased the way the client compares it
function clean(value) {
    const v = typeof value?.theme === 'string' ? value.theme.trim().toLowerCase() : '';
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

function write(value, home) {
    // merge into what is saved, so a write without a theme keeps the saved one
    const next = { ...read(home), ...clean(value) };
    const file = settingsFile(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // write a temp file and rename it over, so a client starting now never reads half a file
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temp, JSON.stringify(next, null, 2));
        fs.renameSync(temp, file);
    } catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
    }
    return next;
}

// The launcher's main colours for windows outside the renderer (Jagex login page, captcha), from styles.css.
const LAUNCHER_COLORS = {
    gold: { bg: '#0c0a08', surface: '#15110d', text: '#d6cfc2', textStrong: '#f5efe4', accent: '#ffb13b', onAccent: '#1a1714', line: '#2e261c' },
    slate: { bg: '#15171c', surface: '#15171c', text: '#c9cdd6', textStrong: '#e3e6ec', accent: '#f5a524', onAccent: '#15171c', line: '#262a33' },
    classic: { bg: '#181818', surface: '#1e1e1e', text: '#c6c6c6', textStrong: '#ebebeb', accent: '#dc8a00', onAccent: '#141414', line: '#323232' },
};

// null when no theme is picked: those windows then keep their own original colours
function launcherColors(home) {
    const { theme } = read(home);
    return theme ? { ...LAUNCHER_COLORS[theme] } : null;
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

module.exports = { THEMES, clean, read, write, register, settingsFile, launcherColors };
