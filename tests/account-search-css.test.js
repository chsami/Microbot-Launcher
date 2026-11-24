const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
const rule = (selector) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));

test('the account search box counts its padding inside its 100% width', () => {
    expect(rule('.accounts-search-input')).toMatch(/width:\s*100%/);
    expect(rule('.accounts-search-input')).toMatch(/box-sizing:\s*border-box/);
});