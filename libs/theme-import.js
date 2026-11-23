// Menu > Themes: share a custom theme as a code (Copy code) and import one from a code or a theme file, pasted or
// dropped. An import is previewed live on the launcher before it is saved as a new theme (see custom-theme.js).
(function () {
    const MAX_FILE = 64 * 1024;
    const NO_IMAGE = 'Background images are not included in codes. Send the image file too.';
    const UNREADABLE = "This theme's text is too hard to read, so it cannot be saved. Change Text or Background in the theme file, or ask for a fixed code, then preview it again.";

    async function readDrop(file) {
        if (!file || !/\.json$/i.test(file.name || '')) return { error: 'Drop a theme .json file.' };
        if (!(file.size <= MAX_FILE)) return { error: 'This file is too big to be a theme.' };
        try {
            return { text: await file.text() };
        } catch {
            return { error: 'Could not read that file.' };
        }
    }

    const $ = (id) => document.getElementById(id);
    const themes = () => window.electron?.themes;
    const el = (tag, text) => {
        const node = document.createElement(tag);
        node.textContent = text;
        return node;
    };
    // the colour chips and readability line the editor shows, for the theme on show (null clears them)
    function showLook(resolved) {
        const chips = resolved ? ['bg', 'surface-2', 'gold'].map((v) => {
            const chip = el('span', '');
            chip.style.setProperty('--chip', resolved.launcher[v]);
            return chip;
        }) : [];
        $('theme-import-chips').replaceChildren(...chips);
        $('theme-import-check').hidden = !resolved;
        const notes = resolved ? window.CustomTheme.warnings(resolved) : [];
        $('theme-import-check').dataset.state = notes.length ? 'warn' : 'ok';
        $('theme-import-check-title').textContent = notes.length ? 'Hard to read' : 'Text is easy to read';
        $('theme-import-warnings').replaceChildren(...notes.map((text) => el('li', text)));
    }
    const say = (id, text) => {
        $(id).textContent = text;
    };

    let built = false;
    let previewed = null; // the cleaned theme on show, null when nothing is
    let returnTo = null;
    let pickerWasOpen = false;
    let rev = 0; // bumped whenever the box text or dialog changes, so a save that finishes later knows it is stale
    let dropToken = 0; // the newest file drop; closing the dialog voids it too
    let copied = null; // the Copy code button showing "Copied": its button, original label and reset timer
    let saved = false; // the text in the box is saved: Save stays off and Cancel reads Done until the text changes

    function setSaved(on) {
        saved = on;
        $('theme-import-cancel').textContent = on ? 'Done' : 'Cancel';
    }

    function paint(selection) {
        // a missing image is not an error here: the preview note already names the image to add
        window.ThemeApply.paint(selection, document.documentElement, themes()?.image);
    }

    function preview() {
        rev++;
        say('theme-import-error', '');
        say('theme-import-status', '');
        const decoded = window.CustomTheme.decode($('theme-import-text').value);
        previewed = decoded.theme || null;
        $('theme-import-save').disabled = true; // on again only for a theme that previewed
        if (!previewed) {
            say('theme-import-name', '');
            say('theme-import-note', '');
            showLook(null);
            say('theme-import-error', decoded.error);
            paint(window.ThemePicker.current());
            return;
        }
        const resolved = window.CustomTheme.resolve(previewed);
        const readable = window.CustomTheme.readable(resolved);
        $('theme-import-save').disabled = saved || !readable;
        if (!readable) say('theme-import-status', UNREADABLE);
        say('theme-import-name', previewed.name);
        showLook(resolved);
        // only a theme file can name an image: codes drop it
        say('theme-import-note', previewed.background?.image ? 'This theme uses the image ' + previewed.background.image + '. Put that file in your themes folder.' : '');
        paint(window.CustomTheme.selection('preview', previewed));
    }

    async function save() {
        // the button is only on after a Preview of the text in the box; the picker would refuse an unreadable theme
        if (!previewed || saved || !window.CustomTheme.readable(window.CustomTheme.resolve(previewed))) return;
        const button = $('theme-import-save');
        button.disabled = true;
        const started = rev;
        let result;
        try {
            result = await themes().save(previewed); // never an id: an import is always a new theme
        } catch (error) {
            result = { error: error?.message || String(error) };
        }
        const failed = !result || result.error;
        // not for text that changed meanwhile: it needs a new Preview
        if (started === rev) {
            if (failed) button.disabled = false;
            else setSaved(true);
        }
        if (failed) return say('theme-import-error', 'Could not save the theme: ' + (result?.error || 'no reply'));
        say('theme-import-status', 'Saved as ' + result.theme.name + '. Press Done, then pick it in Your themes to use it.');
        await window.ThemePicker.refresh();
    }

    function close() {
        $('theme-importer').classList.add('auth-hidden');
        if (pickerWasOpen) $('theme-modal').classList.remove('auth-hidden');
        previewed = null;
        rev++;
        dropToken++;
        paint(window.ThemePicker.current());
        returnTo?.focus();
    }

    function build() {
        built = true;
        const dialog = $('theme-importer');
        $('theme-import-preview').addEventListener('click', preview);
        $('theme-import-save').addEventListener('click', save);
        $('theme-import-cancel').addEventListener('click', close);
        // the box's maxlength would silently cut a longer paste, so it is refused whole
        $('theme-import-text').addEventListener('paste', (e) => {
            if ((e.clipboardData?.getData('text') || '').length <= window.CustomTheme.MAX_INPUT) return;
            e.preventDefault();
            say('theme-import-error', 'This theme code is too long.');
        });
        // Save as new theme saves what was previewed, so new text needs a new Preview first
        $('theme-import-text').addEventListener('input', () => {
            rev++;
            setSaved(false);
            $('theme-import-save').disabled = true;
        });
        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                close();
                return;
            }
            if (e.key !== 'Tab') return;
            // keep focus inside the dialog: the text box is the first stop and Cancel the last
            const stops = dialog.querySelectorAll('textarea, button');
            const [first, last] = [stops[0], stops[stops.length - 1]];
            if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
            }
        });
    }

    // text: a code or theme file to preview straight away (a drop, or a code to copy by hand)
    function open(text) {
        if (!built) build();
        rev++;
        const dialog = $('theme-importer');
        if (dialog.classList.contains('auth-hidden')) {
            returnTo = document.activeElement;
            // the Themes window and its backdrop would hide the live preview, so it steps aside while this is open
            pickerWasOpen = !$('theme-modal').classList.contains('auth-hidden');
            $('theme-modal').classList.add('auth-hidden');
            dialog.classList.remove('auth-hidden');
        }
        $('theme-import-text').value = text || '';
        setSaved(false);
        $('theme-import-save').disabled = true;
        for (const id of ['theme-import-name', 'theme-import-error', 'theme-import-status', 'theme-import-note']) say(id, '');
        showLook(null);
        $('theme-import-text').focus();
        if (text) preview();
    }

    async function copy(theme, button) {
        const code = window.CustomTheme.encode(theme);
        const note = theme.background?.image ? ' ' + NO_IMAGE : '';
        try {
            await window.navigator.clipboard.writeText(code);
        } catch {
            // only to copy by hand: the player's own theme, so no preview and no Save (it would save a duplicate)
            open();
            $('theme-import-text').value = code;
            setSaved(true);
            $('theme-import-text').select();
            say('theme-import-status', 'Could not copy to the clipboard. The code above is selected: press Ctrl+C (Cmd+C on a Mac) to copy it.' + note);
            return;
        }
        say('theme-share-note', note.trim());
        if (!button) return;
        if (copied) {
            clearTimeout(copied.timer);
            copied.button.textContent = copied.label;
        }
        copied = { button, label: button.textContent };
        button.textContent = 'Copied';
        copied.timer = setTimeout(() => {
            button.textContent = copied.label;
            copied = null;
        }, 2000);
    }

    async function onDrop(e) {
        if (!e.dataTransfer?.files?.length) return; // a text drop goes into the text box
        e.preventDefault();
        const token = ++dropToken;
        const read = await readDrop(e.dataTransfer?.files?.[0]);
        if (token !== dropToken) return; // cancelled, or a newer drop took over
        if (read.text) return open(read.text);
        if ($('theme-importer').classList.contains('auth-hidden')) open();
        say('theme-import-error', read.error);
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', () => {
            // a file dropped anywhere else would make Electron navigate away to it
            window.addEventListener('dragover', (e) => e.preventDefault());
            window.addEventListener('drop', (e) => {
                if (e.target?.id !== 'theme-import-text' || e.dataTransfer?.files?.length) e.preventDefault();
            });
            for (const id of ['theme-modal', 'theme-importer']) {
                $(id).addEventListener('dragover', (e) => e.preventDefault());
                $(id).addEventListener('drop', onDrop);
            }
        });
    }

    const api = { open, copy, readDrop };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.ThemeImport = api;
})();
