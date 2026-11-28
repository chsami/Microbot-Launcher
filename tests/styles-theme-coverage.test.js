const fs = require('fs');
const path = require('path');

// LF, so the rule lookups work on a CRLF checkout too
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const css = read('css', 'styles.css');
const html = read('index.html');
// the declarations of one rule, by its exact selector
const rule = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    if (at < 0) throw new Error(`no rule ${selector}`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};
const arrow = (hex) =>
    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23${hex}' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

test('styles.css has no white-alpha colours outside the Halloween block', () => {
    const start = css.indexOf('.is-halloween');
    // Gold's title-bar icons stay pure white
    const outside = (start < 0 ? css : css.slice(0, start)).replaceAll('--titlebar-icon: #ffffff;', '').replaceAll('--ink: #ffffff;', '').replaceAll('--ink-strong: #ffffff;', '');
    expect(outside).not.toMatch(/rgba\(\s*255,\s*255,\s*255/);
    expect(outside).not.toMatch(/#ffffff\b/i);
});

test('primary buttons use the primary colours: red in Gold, the accent in Slate and Classic', () => {
    expect(rule(':root')).toMatch(/--primary: var\(--red\);\s*--primary-hover: var\(--red\);\s*--on-primary: var\(--text-strong\);/);
    for (const theme of [':root[data-theme="slate"]', ':root[data-theme="classic"]']) {
        expect(rule(theme)).toMatch(/--primary: var\(--gold\);\s*--primary-hover: var\(--gold-hover\);\s*--on-primary: var\(--on-gold\);/);
    }
    for (const selector of ['.auth-submit', '.guide-primary']) {
        expect(rule(selector)).toContain('background: var(--primary);');
        expect(rule(selector)).toContain('border: 1px solid var(--primary);');
        expect(rule(selector)).toContain('color: var(--on-primary);');
        expect(rule(selector)).not.toContain('--red');
    }
    expect(rule('.auth-submit:not([disabled]):hover,\n.guide-primary:hover')).toContain('background: var(--primary-hover);');
});

test('selection washes use --tint: gold in Gold, text colour in Slate and Classic', () => {
    expect(rule(':root')).toContain('--tint: var(--gold);');
    for (const theme of [':root[data-theme="slate"]', ':root[data-theme="classic"]']) expect(rule(theme)).toContain('--tint: var(--text);');
    // the update banner's download progress fill stays gold
    const washes = css.split('\n').filter((l) => /background/.test(l) && /color-mix\(in srgb, var\(--gold\)[^)]*transparent\)/.test(l) && !l.includes('--progress'));
    expect(washes).toEqual([]);
});

test('title-bar icons follow --titlebar-icon, white in Gold', () => {
    expect(rule(':root')).toContain('--titlebar-icon: #ffffff;');
    expect(rule(':root[data-theme="slate"]')).toContain('--titlebar-icon: var(--text-strong);');
    expect(rule(':root[data-theme="classic"]')).toContain('--titlebar-icon: var(--text-strong);');
    expect(rule('.titlebar .titlebar-controls button,\n.titlebar button.hamburger')).toContain('color: var(--titlebar-icon);');
    const bar = html.slice(html.indexOf('<div class="titlebar">'), html.indexOf('<span class="titlebar-title">') + 2000);
    expect(bar).not.toMatch(/#ffffff/i);
    expect(bar.match(/stroke="currentColor"/g)).toHaveLength(4);
});

test('select arrows are drawn in each theme\'s accent, Gold byte-identical to before', () => {
    expect(rule(':root')).toContain(`--select-arrow: ${arrow('ffb13b')};`);
    expect(rule(':root[data-theme="slate"]')).toContain(`--select-arrow: ${arrow('f5a524')};`);
    expect(rule(':root[data-theme="classic"]')).toContain(`--select-arrow: ${arrow('dc8a00')};`);
    expect(rule('.game-info select,\n.proxy-section select')).toContain('background: var(--surface-2) var(--select-arrow) no-repeat right 14px center;');
});

test('theme dialog primary buttons use the primary colours', () => {
    expect(rule('.theme-button-primary')).toMatch(/background: var\(--primary\);\s*border-color: var\(--primary\);\s*color: var\(--on-primary\);/);
});

test('theme dialog cards fit below the title bar and the importer has no empty gap', () => {
    expect(rule('.theme-editor-card')).toContain('box-sizing: border-box;');
    // cancels the card's 16px gap while nothing is previewed
    expect(rule('.theme-import-result')).toContain('margin-top: -16px;');
    expect(rule('.auth-card')).toContain('gap: 16px;');
});

test('native radios, checkboxes and sliders take the accent in Slate, Classic and custom themes only, Gold stays native', () => {
    const sel = [];
    for (const t of ['slate', 'classic']) for (const k of ['radio', 'checkbox', 'range']) sel.push(`:root[data-theme="${t}"] input[type="${k}"]`);
    const native = rule(sel.join(',\n'));
    expect(css).not.toMatch(/\ninput\[type="(radio|checkbox|range)"\][,{ ]/);
    expect(native).toContain('accent-color: var(--gold);');
    expect(native).toContain('color-scheme: dark;');
});

test('focus outlines follow the accent in Slate, Classic and custom themes, not Gold', () => {
    expect(rule(':where(:root[data-theme="slate"], :root[data-theme="classic"], :root[data-custom="on"]) :focus-visible')).toContain('outline-color: var(--gold);');
});

test('white washes and texts use --ink, pure white in Gold as before, the text colour in Slate and Classic', () => {
    expect(rule(':root')).toMatch(/--ink: #ffffff;\s*--ink-strong: #ffffff;/);
    for (const theme of [':root[data-theme="slate"]', ':root[data-theme="classic"]']) {
        expect(rule(theme)).toMatch(/--ink: var\(--text\);\s*--ink-strong: var\(--text-strong\);/);
    }
    expect(css).not.toMatch(/color-mix\(in srgb, var\(--text\) \d+%, transparent\)/);
    expect(rule('.auth-close:hover')).toContain('background: color-mix(in srgb, var(--ink) 6%, transparent);');
    expect(rule('.app-menu .separator')).toContain('background: color-mix(in srgb, var(--ink) 10%, transparent);');
    expect(rule('.channel-option:hover')).toContain('color: var(--ink-strong);');
    expect(rule('.nightly-info-title')).toContain('color: var(--ink-strong);');
});


test('custom themes get the accent on native controls; dialogs on a Gold base stay native', () => {
    const k = ['radio', 'checkbox', 'range'];
    const group = (pre) => k.map((x) => `${pre} input[type="${x}"]`).join(',\n');
    expect(rule(group(':root[data-custom="on"]'))).toMatch(/accent-color: var\(--gold\);\s*color-scheme: dark;/);
    expect(rule(group(':root[data-custom="on"][data-unreadable="on"]:not([data-theme="slate"]):not([data-theme="classic"]) .theme-safe'))).toMatch(/accent-color: auto;\s*color-scheme: normal;/);
});

test('the Themes window is a scrolling grid of cards that keep full names', () => {
    // the id beats the later .auth-card width and padding
    expect(rule('#theme-modal .theme-picker-card')).toContain('padding: 0;');
    expect(rule('#theme-modal .theme-picker-card')).toMatch(/box-sizing: border-box;[\s\S]*max-height: calc\(100vh - 64px\);[\s\S]*width: min\(760px, 94vw\);/);
    expect(rule('.theme-picker-body')).toContain('overflow-y: auto;');
    expect(rule('.theme-grid')).toMatch(/gap: 12px;\s*grid-template-columns: repeat\(auto-fill, minmax\(200px, 1fr\)\);/);
    expect(rule('.theme-card-name')).toContain('overflow-wrap: anywhere;');
    expect(rule('.theme-card-name')).not.toContain('ellipsis');
    expect(rule('.theme-card.is-current')).toContain('border: 2px solid var(--gold);');
    // one focus ring, on the card: the radio itself draws none
    expect(rule('.theme-card:has(.theme-card-radio:focus-visible)')).toMatch(/outline: 2px solid var\(--text-strong\);\s*outline-offset: 3px;/);
    // opening focuses the dialog, so the picked card shows no focus ring until the keyboard is used
    expect(html).toContain('<h1 id="theme-title" class="theme-editor-title" tabindex="-1">Themes</h1>');
    expect(rule('.theme-card-radio:focus-visible')).toContain('outline: none;');
    expect(rule('.theme-thumb')).toMatch(/border-radius: 8px;[\s\S]*height: 96px;/);
    expect(css).toContain('.theme-picker-body::-webkit-scrollbar-thumb {');
});
