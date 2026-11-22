// Menu > Themes > New theme / Edit: a form over one custom theme (see custom-theme.js) that previews it live on the
// launcher and on a mock client panel, warns about hard-to-read colours, and saves it to the themes folder.
(function () {
    // the page loads custom-theme.js by a script tag first; its global require would resolve from index.html, not libs/
    const CustomTheme = (typeof window !== 'undefined' && window.CustomTheme) || require('./custom-theme');
    const { BASIC_KEYS, CLIENT_KEYS, LAUNCHER_VARS } = CustomTheme;
    const SIDES = [['colors', BASIC_KEYS], ['client', CLIENT_KEYS], ['launcher', LAUNCHER_VARS]];
    const UNREADABLE = "This theme's text is too hard to read to use. Change Text or Background.";

    // values: every control's current value, plus `changed`: the 'side.key' names the player set (or the file had).
    // A colour, round scrollbars or scrollbar width is only written once changed; corners 0 and image '' mean unset.
    function formToTheme(values) {
        const changed = new Set(values.changed);
        const style = {};
        if (values.corners > 0) style.corners = values.corners;
        if (changed.has('style.roundScrollbars')) style.roundScrollbars = values.roundScrollbars;
        if (changed.has('style.scrollbarWidth')) style.scrollbarWidth = values.scrollbarWidth;
        const theme = { name: values.name, base: values.base, style, background: values.image ? { image: values.image, strength: values.strength } : null };
        for (const [side, keys] of SIDES) {
            theme[side] = Object.fromEntries(keys.filter((k) => changed.has(side + '.' + k)).map((k) => [k, values[side][k]]));
        }
        return theme;
    }

    const $ = (id) => document.getElementById(id);
    const themes = () => window.electron?.themes;
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    const showError = (text) => {
        $('theme-editor-error').textContent = text;
    };
    const BASIC_LABELS = { accent: 'Accent', background: 'Background', panel: 'Panels', text: 'Text' };
    const CLIENT_LABELS = {
        accent: 'Accent', darker: 'Cards and title bar', dark: 'Panel background', medium: 'Lines and selection', light: 'Muted text', text: 'Text',
        control: 'Buttons and inputs', border: 'Borders', darkerHover: 'Card hover', darkHover: 'Panel hover', scrollTrack: 'Scrollbar track',
    };
    const LAUNCHER_LABELS = {
        bg: 'Page', surface: 'Sidebar', 'surface-2': 'Cards', 'surface-3': 'Hover', line: 'Lines', 'line-strong': 'Strong lines', 'line-mid': 'Dividers',
        shade: 'Dialog shade', text: 'Text', 'text-strong': 'Headings', muted: 'Muted text', faint: 'Faint text', gold: 'Accent', 'gold-hover': 'Accent hover',
        'gold-soft': 'Soft accent', 'on-gold': 'Text on accent', red: 'Red', 'red-text': 'Red text', green: 'Green',
    };
    const LABELS = { colors: BASIC_LABELS, client: CLIENT_LABELS, launcher: LAUNCHER_LABELS };
    const CONTAINERS = { colors: 'theme-editor-basics', client: 'theme-editor-client-colours', launcher: 'theme-editor-launcher-colours' };
    const HINTS = { accent: 'Buttons, highlights and links', background: 'Behind the side panel and page', panel: 'Cards, lists and the title bar', text: 'Words and labels' };
    const BASE_NAMES = { gold: 'Gold', slate: 'Slate', classic: 'Classic RuneLite' };
    const HEX_ERROR = 'Use a colour like #7aa2f7';
    const parseHex = (text) => {
        const match = /^#?([0-9a-f]{6})$/i.exec(String(text).trim());
        return match ? '#' + match[1].toLowerCase() : null;
    };

    let inputs = null; // 'side.key' -> colour input, built on first open
    let parts = {}; // 'side.key' -> { row, hex, error, reset } beside that input
    let changed = new Set();
    let opened = ''; // the theme as it was on open, to tell whether Cancel throws anything away
    let editing; // the id being edited, undefined for a new theme
    let returnTo = null;
    let pickerWasOpen = false;
    let opening = 0; // bumped by every open(), so an older open whose image list lands late is dropped
    let pending = 0; // the `opening` whose save is waiting for its reply; 0 when none

    // one colour: swatch, label (with a hint for the basics), hex code field, changed dot (basics), reset icon, hex error
    function colourRow(side, k) {
        const key = side + '.' + k;
        const id = side + '-' + k;
        const text = LABELS[side][k] || k;
        const input = el('input');
        input.type = 'color';
        input.id = 'theme-editor-swatch-' + id;
        input.dataset.key = key;
        const label = el('label', 'theme-editor-label', text);
        label.htmlFor = input.id;
        const hex = el('input', 'theme-editor-hex');
        hex.type = 'text';
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.dataset.hex = key;
        hex.setAttribute('aria-label', text + ' colour code');
        const error = el('p', 'theme-editor-hex-error');
        error.id = 'theme-editor-hex-error-' + id;
        hex.setAttribute('aria-describedby', error.id);
        const reset = el('button', 'theme-editor-reset');
        reset.type = 'button';
        reset.dataset.reset = key;
        const row = el('div', 'theme-editor-colour');
        if (side === 'colors') {
            const words = el('div', 'theme-editor-words');
            words.append(label, el('span', 'theme-editor-hint', HINTS[k]));
            const dot = el('span', 'theme-editor-dot');
            dot.setAttribute('aria-hidden', 'true');
            row.append(input, words, hex, dot, reset, error);
        } else {
            label.setAttribute('title', text + ' (' + k + ')'); // the file key, for people editing theme files by hand
            reset.setAttribute('aria-label', 'Reset ' + text);
            reset.setAttribute('title', 'Reset ' + text);
            row.append(input, label, hex, reset, error);
        }
        inputs[key] = input;
        parts[key] = { row, hex, error, reset };
        return row;
    }

    // a hex code typed in: a valid one sets the colour; an invalid one is pointed out once the field is left
    function typedHex(key, left) {
        const { hex, error } = parts[key];
        const value = parseHex(hex.value);
        error.textContent = value || !left ? '' : HEX_ERROR;
        hex.setAttribute('aria-invalid', String(!value && left));
        refreshSave();
        if (!value) return;
        if (left) hex.value = value;
        if (value === inputs[key].value) return; // tabbing through a field changes nothing
        inputs[key].value = value;
        changed.add(key);
        update();
    }

    const invalidHex = () => Object.values(parts).find((p) => !parseHex(p.hex.value));

    // Save waits while a colour code holds text that is not a colour, and while this draft's save is in flight
    function refreshSave() {
        $('theme-editor-save').disabled = !!invalidHex() || pending === opening;
    }

    function build() {
        inputs = {};
        parts = {};
        for (const [side, keys] of SIDES) $(CONTAINERS[side]).replaceChildren(...keys.map((k) => colourRow(side, k)));
        for (const base of CustomTheme.BUILT_IN) {
            const chips = ['bg', 'surface-2', 'gold'].map((v) => {
                const chip = el('span');
                chip.style.setProperty('--chip', CustomTheme.BASES[base].launcher[v]);
                return chip;
            });
            $('theme-editor-base-' + base + '-chips').replaceChildren(...chips);
        }
        const dialog = $('theme-editor');
        dialog.addEventListener('input', (e) => {
            if (e.target.dataset?.hex) return typedHex(e.target.dataset.hex, false);
            if (e.target.dataset?.key) changed.add(e.target.dataset.key);
            update();
        });
        dialog.addEventListener('focusout', (e) => {
            if (e.target.dataset?.hex) typedHex(e.target.dataset.hex, true);
        });
        dialog.addEventListener('click', (e) => {
            const key = e.target.dataset?.reset;
            if (!key) return;
            changed.delete(key);
            if (key === 'style.roundScrollbars') $('theme-editor-round').checked = false;
            if (key === 'style.scrollbarWidth') $('theme-editor-width').value = '10';
            update();
        });
        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancel();
                return;
            }
            if (e.key !== 'Tab') return;
            // keep focus inside the dialog: the close button is always the first stop, Save (or Cancel while Save is disabled) the last
            const stops = [...dialog.querySelectorAll('input, select, button')].filter((n) => !n.disabled);
            const [first, last] = [stops[0], stops[stops.length - 1]];
            if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
            }
        });
        $('theme-editor-cancel').addEventListener('click', cancel);
        $('theme-editor-close').addEventListener('click', cancel);
        $('theme-editor-save').addEventListener('click', save);
        $('theme-editor-folder').addEventListener('click', async () => {
            const result = await themes()?.openFolder();
            if (result?.error) showError('Could not open the themes folder: ' + result.error);
        });
    }

    function read() {
        const values = {
            name: $('theme-editor-name').value,
            base: CustomTheme.BUILT_IN.find((b) => $('theme-editor-base-' + b).checked) || 'gold',
            changed,
            corners: Number($('theme-editor-corners').value),
            roundScrollbars: $('theme-editor-round').checked,
            scrollbarWidth: Number($('theme-editor-width').value),
            image: $('theme-editor-image').value,
            strength: Number($('theme-editor-strength').value),
        };
        for (const [side, keys] of SIDES) values[side] = Object.fromEntries(keys.map((k) => [k, inputs[side + '.' + k].value]));
        return values;
    }

    // the theme as it would be saved, with a stand-in name so an unnamed theme still previews
    function current() {
        const raw = formToTheme(read());
        // a name that cleans to nothing (only control characters) falls back too
        return (CustomTheme.clean({ ...raw, name: raw.name.trim() }).theme || CustomTheme.clean({ ...raw, name: 'New theme' }).theme);
    }

    function update() {
        showError('');
        const theme = current();
        const resolved = CustomTheme.resolve(theme);
        // pickers the player has not set follow the base and the basics
        const base = CustomTheme.BASES[theme.base].client;
        const basics = { accent: base.accent, background: base.dark, panel: base.darker, text: base.text };
        for (const [side, keys] of SIDES) {
            for (const k of keys) {
                const key = side + '.' + k;
                if (!changed.has(key)) inputs[key].value = side === 'colors' ? basics[k] : resolved[side][k];
                const { row, hex, error, reset } = parts[key];
                // the field being typed in keeps its text until it is left
                if (hex !== document.activeElement) {
                    hex.value = inputs[key].value;
                    error.textContent = '';
                    hex.setAttribute('aria-invalid', 'false');
                }
                row.dataset.changed = changed.has(key) ? 'yes' : 'no';
                reset.disabled = !changed.has(key);
                if (side === 'colors') {
                    reset.setAttribute('aria-label', 'Reset to ' + BASE_NAMES[theme.base]);
                    reset.setAttribute('title', 'Reset to ' + BASE_NAMES[theme.base]);
                }
            }
        }
        refreshSave();
        $('theme-editor-round-reset').disabled = !changed.has('style.roundScrollbars');
        $('theme-editor-width-reset').disabled = !changed.has('style.scrollbarWidth');
        const count = [...changed].filter((key) => !key.startsWith('style.')).length;
        $('theme-editor-status').textContent = count ? count + (count === 1 ? ' colour' : ' colours') + ' changed' : 'No colours changed';
        const style = resolved.style;
        $('theme-editor-corners-value').textContent = style.corners ? style.corners + ' px' : 'Off';
        $('theme-editor-width-value').textContent = changed.has('style.scrollbarWidth') ? style.scrollbarWidth + ' px' : 'Default';
        $('theme-editor-strength-value').textContent = $('theme-editor-strength').value + ' %';
        $('theme-editor-strength').disabled = !$('theme-editor-image').value; // no image, nothing to strengthen
        const warnings = CustomTheme.warnings(resolved);
        $('theme-editor-warnings').replaceChildren(...warnings.map((text) => el('li', '', text)));
        $('theme-editor-check').dataset.state = warnings.length ? 'warn' : 'ok';
        $('theme-editor-check-title').textContent = warnings.length ? 'Hard to read' : 'Text is easy to read';
        const launcher = $('theme-editor-launcher-mock');
        for (const k of LAUNCHER_VARS) launcher.style.setProperty('--l-' + k, resolved.launcher[k]);
        launcher.dataset.base = theme.base; // Gold's Play button is red, the others use the accent
        const mock = $('theme-editor-client');
        for (const k of CLIENT_KEYS) mock.style.setProperty('--c-' + k, resolved.client[k]);
        mock.style.setProperty('--c-corners', (style.corners || 0) + 'px');
        mock.style.setProperty('--c-scrollbar-width', (style.scrollbarWidth || 10) + 'px');
        mock.style.setProperty('--c-scrollbar-radius', style.roundScrollbars ? '999px' : '0');
        window.ThemeApply.paint(CustomTheme.selection(editing || 'preview', theme), document.documentElement, themes()?.image)
            .then((problem) => problem && showError(problem));
    }

    async function open(id, theme) {
        const ticket = ++opening;
        // the one wait comes first and nothing is touched before it, so a newer open() simply wins
        const names = await Promise.resolve(themes()?.images()).catch(() => null);
        if (ticket !== opening) return;
        if (!inputs) build();
        editing = id;
        $('theme-editor-title').textContent = id === undefined ? 'New theme' : 'Edit theme';
        // a new theme starts from the picked look: a built-in, a custom theme's base, or Gold
        const picked = window.ThemePicker.current();
        const start = picked.theme === 'custom' ? picked.custom?.base : picked.theme;
        const t = theme || { name: '', base: CustomTheme.BUILT_IN.includes(start) ? start : 'gold' };
        changed = new Set();
        $('theme-editor-name').value = t.name;
        for (const b of CustomTheme.BUILT_IN) $('theme-editor-base-' + b).checked = b === t.base;
        for (const [side, keys] of SIDES) {
            for (const k of keys) {
                const value = t[side]?.[k];
                if (!value) continue;
                inputs[side + '.' + k].value = value;
                changed.add(side + '.' + k);
            }
        }
        const style = t.style || {};
        $('theme-editor-corners').value = String(style.corners || 0);
        $('theme-editor-round').checked = Boolean(style.roundScrollbars);
        if (typeof style.roundScrollbars === 'boolean') changed.add('style.roundScrollbars');
        $('theme-editor-width').value = String(style.scrollbarWidth || 10);
        if (style.scrollbarWidth) changed.add('style.scrollbarWidth');
        const image = t.background?.image || '';
        const list = Array.isArray(names) ? names : [];
        // keep the theme's own image listed even if the file is gone, so saving does not drop it
        if (image && !list.includes(image)) list.push(image);
        const options = [['', 'None'], ...list.map((n) => [n, n])].map(([value, text]) => {
            const option = el('option', '', text);
            option.value = value;
            return option;
        });
        $('theme-editor-image').replaceChildren(...options);
        $('theme-editor-image').value = image;
        $('theme-editor-strength').value = String(t.background?.strength ?? 30);
        returnTo = document.activeElement;
        // the Themes window and its backdrop would hide the live preview, so it steps aside while the editor is open
        pickerWasOpen = !$('theme-modal').classList.contains('auth-hidden');
        $('theme-modal').classList.add('auth-hidden');
        $('theme-editor').classList.remove('auth-hidden');
        $('theme-editor-name').focus();
        update();
        opened = JSON.stringify(formToTheme(read()));
    }

    // Cancel, the close button and Escape: anything changed since opening is only thrown away once the player agrees
    function cancel() {
        if (JSON.stringify(formToTheme(read())) === opened) return close();
        window.electron.showConfirmationDialog(
            'Discard your changes to this theme?',
            'Your changes are not saved.',
            'Discard changes',
            'Discard',
            'Keep editing',
            { type: 'warning', defaultId: 1, cancelId: 1 }
        ).then((yes) => yes && close());
    }

    function close() {
        $('theme-editor').classList.add('auth-hidden');
        if (pickerWasOpen) $('theme-modal').classList.remove('auth-hidden');
        window.ThemeApply.paint(window.ThemePicker.current(), document.documentElement, themes()?.image);
        returnTo?.focus();
    }

    async function save() {
        if (pending === opening) return;
        const bad = invalidHex();
        if (bad) {
            bad.error.textContent = HEX_ERROR;
            bad.hex.setAttribute('aria-invalid', 'true');
            bad.hex.focus();
            return;
        }
        const cleaned = CustomTheme.clean(formToTheme(read()));
        if (cleaned.error) return showError(cleaned.error);
        if (!CustomTheme.readable(CustomTheme.resolve(cleaned.theme))) return showError(UNREADABLE);
        // the reply may land after this draft was closed and another opened: it must leave that one alone
        const session = opening;
        const id = editing;
        pending = session;
        refreshSave();
        let result;
        try {
            result = await themes().save(cleaned.theme, id);
        } catch (error) {
            result = { error: error?.message || String(error) };
        }
        if (pending === session) pending = 0;
        const mine = session === opening;
        if (mine) refreshSave();
        if (!result || result.error) return mine && showError('Could not save the theme: ' + (result?.error || 'no reply'));
        const picked = window.ThemePicker.current();
        if (mine) close();
        // through the picker's save queue, so theme.json and the picker agree on the new colours; a new theme is picked
        if (id === undefined || (picked.theme === 'custom' && picked.id === id)) {
            await window.ThemePicker.save(CustomTheme.selection(result.id, result.theme));
        }
        await window.ThemePicker.refresh();
    }

    const api = { open, formToTheme };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.ThemeEditor = api;
})();
