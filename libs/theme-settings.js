// ~/.microbot/theme.json: the look picked in Themes. The native launcher and the client read the same file.
const fs = require('fs');
const os = require('os');
const path = require('path');

const THEMES = ['gold', 'slate', 'classic'];
const FONTS = ['montserrat', 'inter', 'runescape'];

function normalize(value) {
    const pick = (raw, allowed) => {
        const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        return allowed.includes(v) ? v : allowed[0];
    };
    return { theme: pick(value?.theme, THEMES), font: pick(value?.font, FONTS) };
}

function settingsFile(home = os.homedir()) {
    return path.join(home, '.microbot', 'theme.json');
}

function read(home) {
    try {
        return normalize(JSON.parse(fs.readFileSync(settingsFile(home), 'utf8')));
    } catch {
        return normalize({});
    }
}

function write(value, home) {
    const next = normalize(value);
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

module.exports = { THEMES, FONTS, normalize, read, write, register, settingsFile };
