// Menu > Themes: applies the saved look on start and saves changes to ~/.microbot/theme.json.
// With no theme saved (see libs/theme-settings.js) nothing is checked: the launcher keeps its own look (Gold)
// while the client keeps the stock RuneLite one. Custom themes come from ~/.microbot/themes (libs/theme-library.js).
(() => {
    const $ = (id) => document.getElementById(id);
    const HEX = /^#[0-9a-f]{6}$/i;
    const themes = () => window.electron?.themes;
    const valueOf = (picked) => (picked.theme === 'custom' ? 'custom:' + picked.id : picked.theme);
    const showError = (text) => {
        const box = $('theme-error');
        if (box) box.textContent = text;
    };
    // the last themes.list() reply; null until one lands
    let entries = null;
    const apply = (picked) => {
        // while the theme editor or import dialog is open its live preview owns the page's colours; it repaints the pick when it closes
        const previewing = ['theme-editor', 'theme-importer'].some((id) => $(id) && !$(id).classList.contains('auth-hidden'));
        if (!previewing) {
            window.ThemeApply.paint(picked, document.documentElement, themes()?.image).then((problem) => problem && showError(problem));
        }
        const value = valueOf(picked);
        for (const input of document.querySelectorAll('#theme-modal input[type="radio"]')) {
            input.checked = input.value === value;
            input.closest('.theme-card')?.classList.toggle('is-current', input.checked);
        }
        const unset = $('theme-unset');
        if (unset) unset.hidden = Boolean(picked.theme);
        const missing = $('theme-missing');
        if (missing) missing.hidden = !(entries && picked.theme === 'custom' && !entries.some((e) => e.id === picked.id));
    };
    // what the user last chose; every read and edit bumps `version` so an older read reply cannot undo a newer choice
    let desired = {};
    // what theme.json last held, as read or saved: a failed save of the latest choice goes back to it
    let accepted = {};
    let version = 0;
    let saving = Promise.resolve();

    // one save at a time, in order, so the file always ends on the latest choice; resolves true when this one saved. A built-in pick sends only
    // { theme }: the main process merges it into the saved file, which matters if the startup read has not landed
    const save = (change) => {
        desired = change;
        const asked = ++version;
        apply(desired);
        // a newer choice wins; otherwise the page and the radios go back to what is saved
        const failed = () => {
            if (asked === version) {
                desired = accepted;
                apply(accepted);
            }
            return false;
        };
        saving = saving
            .then(() => window.electron.theme.write(change))
            .then((saved) => {
                showError(saved?.error ? 'Could not save the theme: ' + saved.error : '');
                if (!saved || saved.error) return failed();
                accepted = saved;
                if (asked === version) {
                    desired = saved;
                    apply(saved);
                }
                return true;
            })
            .catch((error) => {
                // a failed save must not block the ones after it
                showError('Could not save the theme: ' + (error?.message || error));
                return failed();
            });
        return saving;
    };

    // a theme whose text cannot be read would make the way back unreadable too, so it is never applied
    const refusal = (theme) => {
        const resolved = window.CustomTheme.resolve(theme);
        if (window.CustomTheme.readable(resolved)) return '';
        return ['This theme was not applied because its text is too hard to read.', ...window.CustomTheme.warnings(resolved), 'Press Edit and change Text or Background.'].join(' ');
    };

    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };

    const removeTheme = async ({ id, theme }) => {
        const inUse = desired.theme === 'custom' && desired.id === id;
        const yes = await window.electron.showConfirmationDialog(
            `Delete the theme "${theme.name}"?`,
            `This deletes ${id}.json from your themes folder. This cannot be undone.` +
                (inUse ? `\n\nYou are using this theme. The launcher and the client will switch to ${BASE_NAMES[desired.custom.base]}.` : ''),
            'Delete theme',
            'Delete',
            'Cancel',
            { type: 'warning', defaultId: 1, cancelId: 1 }
        );
        if (!yes) return;
        // theme.json decides, once queued saves land: if switching away fails, keep the file (the save showed why)
        await saving;
        if (accepted.theme === 'custom' && accepted.id === id && !(await save({ theme: accepted.custom.base }))) return;
        try {
            const result = await themes().remove(id);
            if (result?.error) showError('Could not delete the theme: ' + result.error);
        } catch (error) {
            showError('Could not delete the theme: ' + (error?.message || error));
        }
        await refresh();
    };

    const exportTheme = async (id) => {
        const note = $('theme-share-note');
        if (note) note.textContent = '';
        try {
            const result = await themes().exportFile(id);
            if (result?.error) showError('Could not save the theme file: ' + result.error);
            if (note && result?.file) note.textContent = 'Saved to ' + result.file + '.';
        } catch (error) {
            showError('Could not save the theme file: ' + (error?.message || error));
        }
    };

    const SVG = 'http://www.w3.org/2000/svg';
    // a 24px stroke icon; d is one path of constant markup, never theme data
    const icon = (d, size = 16) => {
        const svg = document.createElementNS(SVG, 'svg');
        for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', d);
        svg.append(path);
        return svg;
    };
    const BASE_NAMES = { gold: 'Gold', slate: 'Slate', classic: 'Classic RuneLite' };
    const THUMB_VARS = ['bg', 'surface', 'surface-2', 'line', 'text', 'text-strong', 'muted', 'gold'];

    const parts = (className, ...kids) => {
        const node = el('span', className);
        node.append(...kids.map((kid) => (typeof kid === 'string' ? el('span', kid) : kid)));
        return node;
    };
    // a mini launcher in the theme's colours: a title bar; the page with a heading, two lines of text and an accent button;
    // and a sidebar holding a card with two lines of text and an accent pill
    const thumbnail = (launcher) => {
        const thumb = el('span', 'theme-thumb');
        thumb.setAttribute('aria-hidden', 'true');
        for (const v of THUMB_VARS) if (HEX.test(launcher[v])) thumb.style.setProperty('--thumb-' + v, launcher[v]);
        const page = parts('theme-thumb-page', 'theme-thumb-heading', 'theme-thumb-muted', 'theme-thumb-muted theme-thumb-short', 'theme-thumb-button');
        const side = parts('theme-thumb-side', parts('theme-thumb-card', 'theme-thumb-text', 'theme-thumb-muted', 'theme-thumb-pill'));
        const check = parts('theme-thumb-check', icon('M20 6 9 17l-5-5', 14));
        thumb.append(el('span', 'theme-thumb-titlebar'), parts('theme-thumb-body', page, side), check);
        return thumb;
    };

    // one theme: a label holding the hidden radio, the thumbnail and the name; apply() marks the card in use
    const card = (value, name, subtitle, launcher) => {
        const input = el('input', 'theme-card-radio');
        input.type = 'radio';
        input.name = 'theme';
        input.value = value;
        const text = el('span', 'theme-card-text');
        text.append(el('span', 'theme-card-name', name), el('span', 'theme-card-sub', subtitle));
        const info = el('span', 'theme-card-info');
        info.append(text, el('span', 'theme-card-inuse', 'In use'));
        const pick = el('label', 'theme-card-pick');
        if (value.startsWith('custom:')) controls.set(value, input);
        pick.append(input, thumbnail(launcher), info);
        const box = el('div', 'theme-card');
        box.append(pick);
        return box;
    };

    const ICONS = {
        Edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
        'Copy code': 'M8 8h12v12H8zM4 16V4h12',
        'Save as file': 'M12 3v12M7 10l5 5 5-5M5 21h14',
        Delete: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
    };
    // the custom list's controls by 'custom:<id>' (its radio) or '<action>:<id>', so a refresh can keep keyboard focus
    const controls = new Map();
    const custom = (entry) => {
        const { id, theme } = entry;
        const box = card('custom:' + id, theme.name, 'Based on ' + BASE_NAMES[theme.base], window.CustomTheme.resolve(theme).launcher);
        const actions = el('div', 'theme-card-actions');
        const copied = el('span', 'theme-card-copied');
        const label = (button, text) => {
            button.setAttribute('title', text);
            button.setAttribute('aria-label', text === 'Copied' ? text : text + ' ' + theme.name);
        };
        for (const [text, onClick] of [
            ['Edit', () => window.ThemeEditor?.open(id, theme)],
            // ThemeImport.copy says "Copied" by setting textContent for a while, then puts the old text back
            ['Copy code', (button) => window.ThemeImport?.copy(theme, {
                get textContent() { return copied.textContent; },
                set textContent(value) {
                    copied.textContent = value;
                    label(button, value || 'Copy code');
                },
            })],
            ['Save as file', () => exportTheme(id)],
            ['Delete', () => removeTheme(entry)],
        ]) {
            const button = el('button', 'theme-icon-button');
            button.type = 'button';
            label(button, text);
            button.append(icon(ICONS[text]));
            button.addEventListener('click', () => {
                clearNote();
                onClick(button);
            });
            controls.set(text + ':' + id, button);
            actions.append(button);
        }
        actions.append(copied);
        box.append(actions);
        return box;
    };
    const broken = (entry) => {
        const box = el('div', 'theme-card theme-card-broken');
        box.append(el('span', 'theme-card-name', entry.id.endsWith('.json') ? entry.id : entry.id + '.json'), el('span', 'theme-card-sub', entry.error));
        return box;
    };
    const newCard = () => {
        const button = el('button', 'theme-card theme-card-new', '+ New theme');
        button.type = 'button';
        button.addEventListener('click', () => window.ThemeEditor?.open());
        return button;
    };

    let listing = 0;
    const refresh = () => {
        const asked = ++listing;
        return Promise.resolve(themes()?.list())
            .then((list) => {
                if (asked !== listing || !Array.isArray(list)) return;
                entries = list;
                const focused = [...controls].find(([, node]) => node === document.activeElement)?.[0];
                controls.clear();
                const first = newCard();
                $('theme-custom-list')?.replaceChildren(first, ...list.map((e) => (e.theme ? custom(e) : broken(e))));
                if (focused) (controls.get(focused) || first).focus();
                const empty = $('theme-empty');
                if (empty) empty.hidden = list.length > 0;
                // the picked file may have been edited by hand: save its fresh colours so the client gets them too
                const picked = desired.theme === 'custom' && list.find((e) => e.id === desired.id && e.theme);
                const fresh = picked && window.CustomTheme.selection(picked.id, picked.theme);
                // key order is fixed by the cleaners, so equal selections serialise the same
                const stale = fresh && JSON.stringify(fresh) !== JSON.stringify(desired);
                const problem = stale ? refusal(picked.theme) : '';
                if (stale && !problem) save(fresh);
                else {
                    if (problem) showError(problem);
                    apply(desired);
                }
            })
            .catch(() => {}); // keep the current list if the read fails
    };

    // theme.json is shared with the clients and other launcher windows, so pick up changes made elsewhere.
    // Waits for queued saves first, so it reads what this window last saved rather than a half-saved state.
    const sync = () => {
        const asked = ++version;
        return saving
            .then(() => (asked === version ? window.electron?.theme?.read() : null))
            .then((saved) => {
                if (saved && asked === version) {
                    desired = saved;
                    accepted = saved;
                    apply(saved);
                }
            })
            .catch(() => {}) // keep the current look if the read fails
            // the list only shows in the Themes window; with it closed it matters only to pick up hand edits to the picked file
            .then(() => (desired.theme === 'custom' || !modal()?.classList.contains('auth-hidden') ? refresh() : undefined));
    };
    sync();
    window.addEventListener('focus', sync);

    const modal = () => $('theme-modal');
    const clearNote = () => {
        const note = $('theme-share-note');
        if (note) note.textContent = '';
    };
    const close = () => {
        clearNote();
        modal()?.classList.add('auth-hidden');
        $('menu-btn')?.focus(); // back to the control that opened the menu, for keyboard users
    };
    // one tab stop for the radio group (its checked option, or its first while nothing is picked), then the buttons
    const stopFor = () => modal().querySelector('input[name="theme"]:checked') || modal().querySelector('input[name="theme"]');
    document.addEventListener('DOMContentLoaded', () => {
        $('theme-builtin-list')?.replaceChildren(...window.CustomTheme.BUILT_IN.map((id) => card(id, BASE_NAMES[id], 'Built-in', window.CustomTheme.BASES[id].launcher)));
        apply(desired);
        document.querySelector('#app-menu [data-action="themes"]')?.addEventListener('click', () => {
            document.getElementById('app-menu')?.classList.add('hidden');
            showError('');
            modal()?.classList.remove('auth-hidden');
            // the dialog, not the picked card, so the card shows no focus ring until the keyboard is used
            $('theme-title')?.focus();
            window.ThemeApply.forget(); // a background image replaced in the folder shows on reopen
            refresh();
        });
        $('theme-close')?.addEventListener('click', close);
        $('theme-dismiss')?.addEventListener('click', close);
        $('theme-import')?.addEventListener('click', () => window.ThemeImport?.open());
        $('theme-folder')?.addEventListener('click', async () => {
            const result = await themes()?.openFolder();
            if (result?.error) showError('Could not open the themes folder: ' + result.error);
        });
        $('theme-guide')?.addEventListener('click', () => themes()?.openGuide());
        modal()?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                close();
                return;
            }
            if (e.key !== 'Tab') return;
            // keep focus inside the dialog: wrap from the last tab stop to the first and back, in document order,
            // the radio group counting once
            const stops = [...modal().querySelectorAll('button, input[name="theme"]')].filter((n) => !n.disabled && (n.name !== 'theme' || n === stopFor()));
            const active = document.activeElement;
            const at = stops.indexOf(active?.type === 'radio' ? stopFor() : active);
            if (e.shiftKey ? at <= 0 : at === stops.length - 1) {
                e.preventDefault();
                stops[e.shiftKey ? stops.length - 1 : 0].focus();
            }
        });
        modal()?.addEventListener('change', (e) => {
            if (e.target.name !== 'theme') return;
            const value = e.target.value;
            if (!value.startsWith('custom:')) {
                save({ theme: value });
                return;
            }
            const picked = entries?.find((entry) => 'custom:' + entry.id === value && entry.theme);
            const problem = picked ? refusal(picked.theme) : 'That theme no longer exists.';
            if (problem) {
                showError(problem);
                apply(desired); // put the radio back on the current theme
                return;
            }
            save(window.CustomTheme.selection(picked.id, picked.theme));
        });
    });

    window.ThemePicker = { current: () => desired, refresh, save };
})();
