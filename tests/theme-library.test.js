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

    test('a new theme named Gold becomes id gold-theme', () => {
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
        beforeEach(() => {
            handlers = {};
            shell = { openPath: jest.fn(async () => ''), openExternal: jest.fn() };
            library.register({ removeHandler: jest.fn(), handle: (name, fn) => (handlers[name] = fn) }, shell, null);
        });

        test('handlers reject bad ids', async () => {
            expect(Object.keys(handlers).sort()).toEqual([
                'themes:delete', 'themes:image', 'themes:images', 'themes:list', 'themes:open-folder', 'themes:save',
            ]);
            fs.writeFileSync(path.join(home, '.microbot', 'theme.json'), '{}');
            const result = await handlers['themes:delete'](fileEvent, '../theme');
            expect(result.error).toBeTruthy();
            expect(fs.existsSync(path.join(home, '.microbot', 'theme.json'))).toBe(true);
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
});
