// ~/.microbot/theme.json: the look picked in Themes; the client reads the same file at startup.
// A key that is missing or not one of the names below counts as not picked: the launcher then keeps its own look
// (Gold, Montserrat) and the client keeps the stock RuneLite look (Classic, RuneScape).
const fs = require('fs');
const os = require('os');
const path = require('path');

const THEMES = ['gold', 'slate', 'classic'];
const FONTS = ['montserrat', 'inter', 'runescape'];

// only the keys that hold a known value, lower-cased the way the client compares them
function clean(value) {
    const out = {};
    for (const [key, allowed] of [['theme', THEMES], ['font', FONTS]]) {
        const v = typeof value?.[key] === 'string' ? value[key].trim().toLowerCase() : '';
        if (allowed.includes(v)) out[key] = v;
    }
    return out;
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
    // merge into what is saved, so a window that has not read the file yet cannot drop the other key
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

module.exports = { THEMES, FONTS, clean, read, write, register, settingsFile };
