const fs = require('fs');
const os = require('os');
const path = require('path');
const library = require('../libs/theme-library');

const theme = (name, extra = {}) => ({ format: 1, name, base: 'slate', colors: { accent: '#112233' }, ...extra });
const { pathToFileURL } = require('url');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
// signature + IHDR chunk (length, type, width, height, 5 more header bytes, crc)
const png = (w, h) => Buffer.concat([PNG_SIG, u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.alloc(9)]);
const PNG = png(100, 50);
// SOI, an APP0 segment, then a baseline SOF0 frame header
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, ...Array(9).fill(0)]);
const riff = (chunk, body) => Buffer.concat([Buffer.from('RIFF'), u32(0), Buffer.from('WEBP' + chunk), u32(body.length), body]);
const le24 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const webpX = (w, h) => riff('VP8X', Buffer.from([0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]));
const webpL = (w, h) => {
    const bits = (w - 1) | ((h - 1) << 14);
    return riff('VP8L', Buffer.from([0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]));
};
const webpLossy = (w, h) => riff('VP8 ', Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, w >> 8, h & 0xff, h >> 8]));
const PAGE = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const fileEvent = { senderFrame: { url: PAGE } };

describe('theme-library', () => {
    let home;
    let dir;
    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'themes-'));
        dir = library.themesDir(home);
        fs.mkdirSync(dir, { recursive: true });
    });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(home, { recursive: true, force: true });
    });

    test('lists good files and reports broken ones', () => {
        fs.writeFileSync(path.join(dir, 'midnight.json'), JSON.stringify(theme('Midnight')));
        fs.writeFileSync(path.join(dir, 'broken.json'), '{oops');
        fs.writeFileSync(path.join(dir, 'huge.json'), JSON.stringify(theme('Huge', { pad: 'x'.repeat(70 * 1024) })));
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
        fs.writeFileSync(path.join(dir, 'Bad Name.json'), JSON.stringify(theme('Bad')));
        fs.mkdirSync(path.join(dir, 'folder.json'));
        const list = library.list(home);
        expect(list).toHaveLength(4);
        expect(list.find((e) => e.id === 'midnight').theme.name).toBe('Midnight');
        expect(list.find((e) => e.id === 'broken')).toEqual({ id: 'broken', error: 'This file is not valid theme JSON.' });
        expect(list.find((e) => e.id === 'huge')).toEqual({ id: 'huge', error: 'This file is too big to be a theme.' });
        expect(list.find((e) => e.id === 'Bad Name.json')).toEqual({
            id: 'Bad Name.json', error: 'Rename this file using only a-z, 0-9 and -, like midnight.json.',
        });
    });

    test('lists at most 200 files', () => {
        for (let i = 0; i < 205; i++) fs.writeFileSync(path.join(dir, 't' + String(i).padStart(3, '0') + '.json'), '{}');
        expect(library.list(home)).toHaveLength(200);
    });

    test('a new theme is refused once there are 200 theme files; edits still save', () => {
        for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(dir, 't' + String(i).padStart(3, '0') + '.json'), '{}');
        expect(library.save(theme('Zed'), undefined, home)).toEqual({ error: 'You have 200 theme files, the most Themes can list. Delete one to save a new theme.' });
        expect(fs.existsSync(path.join(dir, 'zed.json'))).toBe(false);
        expect(library.save(theme('Edited'), 't000', home)).toMatchObject({ id: 't000' });
    });

    test('save never overwrites: same name gets (2) and a new id', () => {
        const first = library.save(theme('Midnight'), undefined, home);
        const second = library.save(theme('Midnight'), undefined, home);
        expect(first.id).toBe('midnight');
        expect(second.id).toBe('midnight-2');
        expect(second.theme.name).toBe('Midnight (2)');
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'midnight.json'), 'utf8')).name).toBe('Midnight');
        expect(fs.readdirSync(dir).sort()).toEqual(['midnight-2.json', 'midnight.json']);
    });

    test('importing Gold becomes id gold-theme', () => {
        const saved = library.save(theme('Gold'), undefined, home);
        expect(saved.id).toBe('gold-theme');
        expect(saved.theme.name).toBe('Gold (2)');
    });

    test('save with id edits that file', () => {
        const { id } = library.save(theme('Midnight'), undefined, home);
        const edited = library.save(theme('Midnight', { colors: { accent: '#ABCDEF' } }), id, home);
        expect(edited.id).toBe('midnight');
        expect(library.list(home)).toEqual([{ id: 'midnight', theme: edited.theme }]);
        expect(edited.theme.colors.accent).toBe('#abcdef');
        expect(library.save(theme('Gone'), 'gone', home)).toEqual({ error: 'That theme no longer exists.' });
        expect(library.save(theme('Bad'), '../x', home).error).toBeTruthy();
        expect(library.save({ name: '' }, undefined, home).error).toBeTruthy();
    });

    test('remove deletes a theme file', () => {
        const { id } = library.save(theme('Midnight'), undefined, home);
        expect(library.remove(id, home)).toEqual({ ok: true });
        expect(fs.readdirSync(dir)).toEqual([]);
        expect(library.remove(id, home).error).toBeTruthy();
    });

    test('readImage refuses traversal, wrong bytes and big files', () => {
        fs.writeFileSync(path.join(home, '.microbot', 'x.png'), PNG);
        fs.writeFileSync(path.join(dir, 'a.png'), 'just some text');
        fs.writeFileSync(path.join(dir, 'big.png'), Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]));
        fs.writeFileSync(path.join(dir, 'good.png'), PNG);
        expect(library.readImage('../x.png', home).error).toBeTruthy();
        expect(library.readImage('a.png', home).error).toBeTruthy();
        expect(library.readImage('big.png', home).error).toBeTruthy();
        const good = library.readImage('good.png', home);
        expect(good.type).toBe('image/png');
        expect(Array.from(good.bytes)).toEqual(Array.from(PNG));
        expect(library.images(home)).toEqual(['a.png', 'good.png']); // big.png is over 5 MB
    });

    test('readImage reads the size from the header and refuses huge or broken images', () => {
        const TOO_BIG = 'This image is too large or not a valid image.';
        const files = {
            'huge.png': png(100000, 100000), // a few bytes on disk, gigabytes once decoded
            'wide.png': png(9000, 10),
            'many.png': png(8000, 6000), // 48 million pixels
            'cut.png': PNG.subarray(0, 20),
            'ok.png': png(8192, 4000),
            'ok.jpg': jpeg(1920, 1080),
            'wide.jpg': jpeg(9000, 100),
            'cut.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00]),
            'nosof.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
            'x.webp': webpX(1920, 1080),
            'xbig.webp': webpX(9000, 9000),
            'l.webp': webpL(300, 200),
            'lbig.webp': webpL(16000, 16000),
            'lossy.webp': webpLossy(640, 480),
            'cut.webp': riff('VP8X', Buffer.alloc(3)),
        };
        for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), bytes);
        const result = (name) => [name, library.readImage(name, home).error || 'ok'];
        expect(Object.keys(files).map(result)).toEqual([
            ['huge.png', TOO_BIG], ['wide.png', TOO_BIG], ['many.png', TOO_BIG], ['cut.png', TOO_BIG], ['ok.png', 'ok'],
            ['ok.jpg', 'ok'], ['wide.jpg', TOO_BIG], ['cut.jpg', TOO_BIG], ['nosof.jpg', TOO_BIG],
            ['x.webp', 'ok'], ['xbig.webp', TOO_BIG], ['l.webp', 'ok'], ['lbig.webp', TOO_BIG], ['lossy.webp', 'ok'], ['cut.webp', TOO_BIG],
        ]);
    });

    describe('handlers', () => {
        let handlers;
        let shell;
        let dialog;
        beforeEach(() => {
            handlers = {};
            shell = { openPath: jest.fn(async () => ''), openExternal: jest.fn() };
            dialog = { showSaveDialog: jest.fn() };
            library.register({ removeHandler: jest.fn(), handle: (name, fn) => (handlers[name] = fn) }, shell, null, dialog);
        });

        test('handlers reject bad ids', async () => {
            expect(Object.keys(handlers).sort()).toEqual([
                'themes:delete', 'themes:export', 'themes:image', 'themes:images',
                'themes:list', 'themes:open-folder', 'themes:open-guide', 'themes:save',
            ]);
            fs.writeFileSync(path.join(home, '.microbot', 'theme.json'), '{}');
            const result = await handlers['themes:delete'](fileEvent, '../theme');
            expect(result.error).toBeTruthy();
            expect(fs.existsSync(path.join(home, '.microbot', 'theme.json'))).toBe(true);
            expect((await handlers['themes:export'](fileEvent, '../theme')).error).toBeTruthy();
            expect(dialog.showSaveDialog).not.toHaveBeenCalled();
        });

        test('handlers refuse senders that are not the launcher page', async () => {
            const others = ['https://evil.example', 'file:///C:/somewhere/else.html', PAGE.replace('index.html', 'other.html'), PAGE + '/../x.html'];
            for (const event of [...others.map((url) => ({ senderFrame: { url } })), {}]) {
                for (const name of Object.keys(handlers)) {
                    expect((await handlers[name](event)).error).toBeTruthy();
                }
            }
            expect(shell.openExternal).not.toHaveBeenCalled();
            expect(shell.openPath).not.toHaveBeenCalled();
        });

        test('the launcher page is allowed with a hash or query', async () => {
            for (const url of [PAGE, PAGE + '#themes', PAGE + '?a=1']) {
                expect(await handlers['themes:list']({ senderFrame: { url } })).toEqual(expect.any(Array));
            }
        });

    });

    test('register does not load Electron until the guide opens', () => {
        jest.isolateModules(() => {
            jest.doMock('electron', () => {
                throw new Error('no Electron binary');
            });
            const isolated = require('../libs/theme-library');
            expect(() => isolated.register({ removeHandler: jest.fn(), handle: jest.fn() }, {}, null, {})).not.toThrow();
        });
        jest.dontMock('electron');
    });

    describe('theme guide window', () => {
        const GUIDE = path.join(__dirname, '..', 'libs', 'theme-guide.html');
        let windows;
        let handler;
        let shell;
        let loadError;
        let log;
        beforeEach(() => {
            windows = [];
            loadError = null;
            log = { error: jest.fn() };
            shell = { openPath: jest.fn(), openExternal: jest.fn() };
            class FakeWindow {
                constructor(options) {
                    this.options = options;
                    this.listeners = {};
                    this.destroyed = false;
                    this.focus = jest.fn();
                    this.loadFile = jest.fn(async () => {
                        if (loadError) throw loadError;
                    });
                    this.destroy = jest.fn(() => (this.destroyed = true));
                    this.setTitleBarOverlay = jest.fn();
                    this.setBackgroundColor = jest.fn();
                    let keys = 0;
                    this.webContents = {
                        insertCSS: jest.fn(async () => 'key' + ++keys),
                        removeInsertedCSS: jest.fn(async () => {}),
                        on: (event, fn) => (this.listeners[event] = fn),
                        setWindowOpenHandler: (fn) => (this.openHandler = fn),
                    };
                    this.once = (event, fn) => (this.listeners[event] = fn);
                    this.on = this.once;
                    windows.push(this);
                }
                isDestroyed() {
                    return this.destroyed;
                }
            }
            FakeWindow.fromWebContents = jest.fn(() => 'parent');
            jest.spyOn(os, 'homedir').mockReturnValue(home);
            const handlers = {};
            library.register({ removeHandler: jest.fn(), handle: (name, fn) => (handlers[name] = fn) }, shell, log, {}, path.join(__dirname, '..', 'index.html'), FakeWindow);
            handler = handlers['themes:open-guide'];
        });

        test('opens one sandboxed window that loads the bundled guide, a second call focuses it', async () => {
            expect(await handler(fileEvent)).toEqual({ ok: true });
            expect(windows).toHaveLength(1);
            const { options } = windows[0];
            expect(options).toMatchObject({ width: 820, height: 720, title: 'How to make a theme', autoHideMenuBar: true, parent: 'parent' });
            expect(options.webPreferences).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
            expect(windows[0].loadFile).toHaveBeenCalledWith(GUIDE);
            await handler(fileEvent);
            expect(windows).toHaveLength(1);
            expect(windows[0].focus).toHaveBeenCalled();
            windows[0].listeners.closed();
            await handler(fileEvent);
            expect(windows).toHaveLength(2);
        });

        test("themes the guide's warnings with the launcher red", async () => {
            await handler(fileEvent);
            windows[0].listeners['did-finish-load']();
            expect(windows[0].webContents.insertCSS.mock.calls[0][0]).toContain('--red: #c2231f;');
        });

        test('a guide that fails to load is destroyed, forgotten and reported', async () => {
            loadError = new Error('ENOENT');
            expect(await handler(fileEvent)).toEqual({ error: 'Could not open the guide.' });
            expect(windows[0].destroy).toHaveBeenCalled();
            expect(log.error).toHaveBeenCalled();
            loadError = null;
            expect(await handler(fileEvent)).toEqual({ ok: true });
            expect(windows).toHaveLength(2);
        });

        // Every declaration in the block must be a launcher colour or the title offset; returns the offenders.
        const badDeclarations = (css) => {
            const body = css.match(/^html:root \{([^{}]*)\}$/);
            if (!body) return [css];
            return body[1].split(';').map((x) => x.trim()).filter(Boolean)
                .filter((x) => !/^(--title-left: (16|80)px|--(?!title-left:)[a-z0-9-]+: #[0-9a-f]{6})$/i.test(x));
        };

        test('inserts only #rrggbb launcher colours once loaded', async () => {
            await handler(fileEvent);
            windows[0].listeners['did-finish-load']();
            const css = windows[0].webContents.insertCSS.mock.calls[0][0];
            expect(css).toContain('--red:');
            expect(badDeclarations(css)).toEqual([]);
        });

        test('the guide CSS checker rejects extra or unterminated declarations', () => {
            expect(badDeclarations('html:root { --bg: #0c0a08; color: red; }')).toEqual(['color: red']);
            expect(badDeclarations('html:root { --bg: #0c0a08; --x: #fff }')).toEqual(['--x: #fff']);
            expect(badDeclarations('html:root { --bg: #0c0a08; }')).toEqual([]);
            expect(badDeclarations('html:root { --title-left: #ffffff; }')).toEqual(['--title-left: #ffffff']);
        });

        test('keeps the newest colours when overlapping focus restyles resolve out of order', async () => {
            await handler(fileEvent);
            const win = windows[0];
            await win.listeners['did-finish-load']();
            const pending = [];
            win.webContents.insertCSS = jest.fn((css) => new Promise((resolve) => pending.push({ css, resolve })));
            const theme = require('../libs/theme-settings');
            theme.write({ theme: 'slate' }, home);
            const first = win.listeners.focus();
            theme.write({ theme: 'gold' }, home);
            const second = win.listeners.focus();
            await Promise.resolve();
            expect(pending).toHaveLength(2);
            pending[1].resolve('newer');
            await second;
            pending[0].resolve('older');
            await first;
            expect(pending[1].css).toContain('--bg: #0c0a08;');
            const removed = win.webContents.removeInsertedCSS.mock.calls.map((c) => c[0]).sort();
            expect(removed).toEqual(['key1', 'older']);
        });

        test('a failing removeInsertedCSS does not break a restyle', async () => {
            await handler(fileEvent);
            const win = windows[0];
            await win.listeners['did-finish-load']();
            win.webContents.removeInsertedCSS.mockRejectedValue(new Error('gone'));
            await expect(win.listeners.focus()).resolves.toBeUndefined();
        });

        test('the guide title clears the macOS window controls only on darwin', async () => {
            const real = Object.getOwnPropertyDescriptor(process, 'platform');
            try {
                for (const [platform, left] of [['darwin', '80px'], ['win32', '16px']]) {
                    Object.defineProperty(process, 'platform', { value: platform });
                    await handler(fileEvent);
                    const win = windows[windows.length - 1];
                    await win.listeners['did-finish-load']();
                    expect(win.webContents.insertCSS.mock.calls[0][0]).toContain('--title-left: ' + left + ';');
                    win.listeners.closed();
                }
            } finally {
                Object.defineProperty(process, 'platform', real);
            }
            expect(fs.readFileSync(GUIDE, 'utf8')).toMatch(/\.titlebar \{[^}]*padding: 0 140px 0 var\(--title-left, 16px\)/);
        });

        test('hides the default title bar and colours its overlay and background from the launcher theme', async () => {
            await handler(fileEvent);
            const { options } = windows[0];
            // no theme.json in the fake home: the launcher is Gold
            expect(options.backgroundColor).toBe('#0c0a08');
            if (process.platform === 'darwin') {
                expect(options.titleBarStyle).toBe('hiddenInset');
                expect(options.titleBarOverlay).toBeUndefined();
            } else {
                expect(options.titleBarStyle).toBe('hidden');
                expect(options.titleBarOverlay).toEqual({ color: '#0c0a08', symbolColor: '#d6cfc2', height: 36 });
            }
        });

        test('on focus the guide picks up a theme changed in the launcher', async () => {
            await handler(fileEvent);
            const win = windows[0];
            await win.listeners['did-finish-load']();
            require('../libs/theme-settings').write({ theme: 'slate' }, home);
            await win.listeners.focus();
            expect(win.webContents.insertCSS).toHaveBeenCalledTimes(2);
            expect(win.webContents.insertCSS.mock.calls[1][0]).toContain('--bg: #15171c;');
            expect(win.webContents.removeInsertedCSS).toHaveBeenCalledWith('key1');
            expect(win.setBackgroundColor).toHaveBeenCalledWith('#15171c');
            if (process.platform !== 'darwin') expect(win.setTitleBarOverlay).toHaveBeenCalledWith({ color: '#15171c', symbolColor: '#c9cdd6' });
        });

        test('the guide has a draggable title strip and a themed scrollbar', () => {
            const html = fs.readFileSync(GUIDE, 'utf8');
            const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
            expect(html).toMatch(/<div class="titlebar"[^>]*>How to make a theme<\/div>/);
            const strip = css.match(/\.titlebar \{([^}]*)\}/)[1];
            expect(strip).toContain('-webkit-app-region: drag');
            expect(strip).toContain('height: 36px');
            // the page scrolls in its own box below the strip, so the scrollbar never sits under the caption buttons
            expect(css).toMatch(/html, body \{[^}]*height: 100vh;[^}]*overflow: hidden;/);
            const page = [...css.matchAll(/\.page \{([^}]*)\}/g)].map((m) => m[1]).join(' ');
            expect(page).toContain('height: calc(100vh - 36px)');
            expect(page).toContain('overflow-y: auto');
            expect(html).toMatch(/<body>\s*<div class="titlebar"[^>]*>[^<]*<\/div>\s*<div class="page">[\s\S]*<\/div>\s*<\/body>/);
            const bars = [...css.matchAll(/::-webkit-scrollbar[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
            expect(bars.length).toBeGreaterThan(2);
            for (const rule of bars) {
                for (const [, value] of rule.matchAll(/(?:background|border|background-color)\s*:\s*([^;]+)/g)) {
                    expect(value).toMatch(/var\(--|transparent|padding-box/);
                }
            }
        });

        test('blocks navigation and only opens web links externally', async () => {
            await handler(fileEvent);
            const prevent = jest.fn();
            windows[0].listeners['will-navigate']({ preventDefault: prevent });
            expect(prevent).toHaveBeenCalled();
            expect(windows[0].openHandler({ url: 'https://example.com/a' })).toEqual({ action: 'deny' });
            expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/a');
            windows[0].openHandler({ url: 'file:///C:/Windows/system32/calc.exe' });
            windows[0].openHandler({ url: 'javascript:alert(1)' });
            expect(shell.openExternal).toHaveBeenCalledTimes(1);
        });

        test('the guide file is self-contained and covers every section of the markdown guide', () => {
            const html = fs.readFileSync(GUIDE, 'utf8');
            expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:">`);
            expect(html).not.toMatch(/<script/i);
            expect(html).not.toMatch(/(src|href)="https?:/i);
            expect(html).not.toContain('TODO');
            const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'custom-themes-guide.md'), 'utf8');
            const headings = md.split(/\r?\n/).filter((l) => /^#{1,3} /.test(l)).map((l) => l.replace(/^#+ /, ''));
            expect(headings.length).toBeGreaterThan(8);
            for (const heading of headings) expect(html).toContain(heading);
        });

        test('the guide quick start links to the make, share and troubleshooting sections', () => {
            const html = fs.readFileSync(GUIDE, 'utf8');
            const quick = html.match(/<nav class="quick"[\s\S]*?<\/nav>/);
            expect(quick).not.toBeNull();
            const targets = [...quick[0].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
            expect(targets).toEqual(['make-a-theme', 'share', 'wrong']);
            for (const id of targets) expect(html).toContain(`id="${id}"`);
        });

        test('the guide styles take colours from variables, hex only in the :where(:root) defaults, which injected html:root colours outrank', () => {
            const html = fs.readFileSync(GUIDE, 'utf8');
            const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
            expect(css).toMatch(/^\s*:where\(:root\)\s*\{/m);
            const rest = css.replace(/:where\(:root\)\s*\{[^}]*\}/, '');
            expect(rest).not.toMatch(/#[0-9a-f]{3,8}\b/i);
            for (const [, style] of html.matchAll(/style="([^"]*)"/g)) expect(style).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i);
        });
    });

    test('images lists regular image files of 5 MB or less', () => {
        fs.writeFileSync(path.join(dir, 'small.png'), PNG);
        fs.writeFileSync(path.join(dir, 'big.png'), Buffer.alloc(5 * 1024 * 1024 + 1));
        fs.writeFileSync(path.join(dir, 'edge.jpg'), Buffer.alloc(5 * 1024 * 1024));
        fs.mkdirSync(path.join(dir, 'folder.webp'));
        expect(library.images(home)).toEqual(['edge.jpg', 'small.png']);
    });

    test('images lists at most 100 names, in order', () => {
        for (let i = 0; i < 101; i++) fs.writeFileSync(path.join(dir, 'img' + String(i).padStart(3, '0') + '.png'), PNG);
        const names = library.images(home);
        expect(names).toHaveLength(100);
        expect(names[0]).toBe('img000.png');
        expect(names[99]).toBe('img099.png');
    });

    test('exportFile writes the cleaned theme where the player picks', async () => {
        const { id } = library.save(theme('Midnight'), undefined, home);
        const target = path.join(home, 'out.json');
        const dialog = { showSaveDialog: jest.fn(async () => ({ canceled: false, filePath: target })) };
        expect(await library.exportFile(id, dialog, home)).toEqual({ ok: true });
        expect(dialog.showSaveDialog.mock.calls[0][0].defaultPath).toBe('midnight.json');
        expect(JSON.parse(fs.readFileSync(target, 'utf8')).name).toBe('Midnight');
        dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
        expect(await library.exportFile(id, dialog, home)).toEqual({ canceled: true });
    });
});
