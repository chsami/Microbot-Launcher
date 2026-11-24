const { authCompleteHtml } = require('../libs/oauth-jagex');

test('nobody picked a theme: the page keeps its original colours', () => {
    const html = authCompleteHtml(null);
    expect(html).toContain('background: #0d1117;');
    expect(html).toContain('color: #e6edf3;');
    expect(html).toContain('border: 6px solid #2d333b;');
    expect(html).toContain('border-top-color: #2f81f7;');
});

test('the Jagex login complete page uses the launcher theme colours', () => {
    const html = authCompleteHtml({ bg: '#123456', text: '#abcdef', accent: '#fedcba', line: '#0f0f0f' });
    expect(html).toContain('background: #123456;');
    expect(html).toContain('color: #abcdef;');
    expect(html).toContain('border: 6px solid #0f0f0f;');
    expect(html).toContain('border-top-color: #fedcba;');
    expect(html).not.toMatch(/#0d1117|#e6edf3|#2f81f7|#2d333b/);
});
