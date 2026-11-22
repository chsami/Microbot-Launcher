// Paints a theme selection (see theme-settings.js) onto the launcher page: built-ins by data-theme, custom ones by
// setting the 19 launcher colour variables inline, plus an optional background image read from the themes folder.
(function () {
    // the page loads custom-theme.js by a script tag first; its global require would resolve from index.html, not libs/
    const CustomTheme = (typeof window !== 'undefined' && window.CustomTheme) || require('./custom-theme');
    const { LAUNCHER_VARS, BUILT_IN, BASES, cleanBackground, readable } = CustomTheme;
    const HEX = /^#[0-9a-f]{6}$/i;
    const hexOnly = (colors) => Object.fromEntries(Object.entries(colors || {}).filter(([, v]) => typeof v === 'string' && HEX.test(v)));
    const IMAGE_VARS = ['--theme-image', '--theme-image-strength'];
    // the select chevron from styles.css in a checked #rrggbb accent
    const selectArrow = (hex) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23${hex.slice(1)}' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

    // one image at a time, cached by name so a colour or strength change never re-reads it; forget() drops it on an
    // explicit refresh. The promise resolves to { url } or { error }
    let cached = null; // { name, url: Promise<{ url } | { error }> }
    // bumped by every paint and clear, so an image reply that lands after a newer paint is dropped
    let generation = 0;

    const NOT_FOUND = 'That image is not in the themes folder.';
    function load(images, name) {
        return Promise.resolve()
            .then(() => images(name))
            .then(async (r) => {
                if (!r || !r.bytes || !r.type) return { error: (r && typeof r.error === 'string' && r.error) || NOT_FOUND };
                const url = URL.createObjectURL(new Blob([r.bytes], { type: r.type }));
                // a valid header can still hide a cut-off file; Image is missing only outside a browser (tests)
                if (typeof Image === 'function') {
                    const image = new Image();
                    image.src = url;
                    try {
                        await image.decode();
                    } catch {
                        URL.revokeObjectURL(url);
                        return { error: 'That image is damaged or not a picture the launcher can show.' };
                    }
                }
                return { url };
            })
            .catch(() => ({ error: NOT_FOUND }));
    }

    function dropImage(root) {
        for (const v of IMAGE_VARS) root.style.removeProperty(v);
        delete root.dataset.themeImage;
        if (cached) cached.url.then((r) => r.url && URL.revokeObjectURL(r.url));
        cached = null;
    }

    function clear(root) {
        generation++;
        for (const v of LAUNCHER_VARS) root.style.removeProperty('--' + v);
        root.style.removeProperty('--select-arrow');
        delete root.dataset.custom;
        delete root.dataset.unreadable;
        dropImage(root);
    }

    // the embedded dashboard restyles its scrollbar from the new colours (renderer.js);
    // only on a real change, since the picker repaints on every window focus
    const announced = new WeakMap();
    function announce(root, key) {
        if (announced.get(root) === key) return;
        announced.set(root, key);
        if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('theme-changed'));
    }

    // resolves to an error message for the player, or undefined
    function paint(selection, root, images) {
        const custom = selection && selection.theme === 'custom' && selection.custom ? selection.custom : null;
        if (!custom) {
            clear(root);
            root.dataset.theme = BUILT_IN.includes(selection && selection.theme) ? selection.theme : 'gold';
            announce(root, root.dataset.theme);
            return Promise.resolve();
        }
        const gen = ++generation;
        const base = BUILT_IN.includes(custom.base) ? custom.base : 'classic';
        root.dataset.theme = base;
        root.dataset.custom = 'on';
        const launcher = custom.launcher || {};
        // the Themes window and editor keep the base's colours only while the painted theme is hard to read (a preview)
        if (readable({ base, client: { ...BASES[base].client, ...hexOnly(custom.colors) }, launcher: { ...BASES[base].launcher, ...hexOnly(launcher) } })) delete root.dataset.unreadable;
        else root.dataset.unreadable = 'on';
        for (const v of LAUNCHER_VARS) {
            const color = Object.prototype.hasOwnProperty.call(launcher, v) ? launcher[v] : null;
            if (typeof color === 'string' && HEX.test(color)) root.style.setProperty('--' + v, color);
            else root.style.removeProperty('--' + v);
        }
        if (typeof launcher.gold === 'string' && HEX.test(launcher.gold)) root.style.setProperty('--select-arrow', selectArrow(launcher.gold));
        else root.style.removeProperty('--select-arrow');
        announce(root, base + JSON.stringify(hexOnly(launcher)));
        const bg = custom.background ? cleanBackground(custom.background) : null;
        if (!bg) {
            dropImage(root);
            return Promise.resolve();
        }
        if (!cached || cached.name !== bg.image) {
            dropImage(root);
            cached = { name: bg.image, url: typeof images === 'function' ? load(images, bg.image) : Promise.resolve({ error: NOT_FOUND }) };
        }
        const mine = cached;
        return mine.url.then(({ url, error }) => {
            if (gen !== generation) return undefined;
            if (!url) {
                if (cached === mine) cached = null; // try again next time, the player may fix the file
                return 'Could not show ' + bg.image + ': ' + error;
            }
            root.style.setProperty('--theme-image', 'url("' + url + '")');
            root.style.setProperty('--theme-image-strength', String(bg.strength / 100));
            root.dataset.themeImage = 'on';
            return undefined;
        });
    }

    // the next paint reads the image again, for a file replaced under the same name
    function forget() {
        if (cached) cached.name = null;
    }

    // a clear from outside means the page's colours changed under us, so the next paint always restyles
    const clearAll = (root) => { announced.delete(root); clear(root); };
    const api = { paint, clear: clearAll, forget };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.ThemeApply = api;
})();
