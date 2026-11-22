// Menu > Themes: applies the saved look on start and saves changes to ~/.microbot/theme.json.
// With no theme saved (see libs/theme-settings.js) nothing is checked: the launcher keeps its own look (Gold)
// while the client keeps the stock RuneLite one.
(() => {
    const $ = (id) => document.getElementById(id);
    const NAMES = ['theme'];
    const LAUNCHER = { theme: 'gold' };
    const apply = (picked) => {
        document.documentElement.dataset.theme = picked.theme || LAUNCHER.theme;
        for (const input of document.querySelectorAll('#theme-modal input[type="radio"]')) {
            input.checked = input.value === picked[input.name];
        }
        const unset = $('theme-unset');
        if (unset) unset.hidden = NAMES.every((name) => picked[name]);
    };
    // what the user last chose; every read and edit bumps `version` so an older read reply cannot undo a newer choice
    let desired = {};
    let version = 0;
    let saving = Promise.resolve();

    // theme.json is shared with the clients and other launcher windows, so pick up changes made elsewhere.
    // Waits for queued saves first, so it reads what this window last saved rather than a half-saved state.
    const sync = () => {
        const asked = ++version;
        return saving
            .then(() => (asked === version ? window.electron?.theme?.read() : null))
            .then((saved) => {
                if (saved && asked === version) {
                    desired = saved;
                    apply(saved);
                }
            })
            .catch(() => {}); // keep the current look if the read fails
    };
    sync();
    window.addEventListener('focus', sync);

    const modal = () => $('theme-modal');
    const close = () => {
        modal()?.classList.add('auth-hidden');
        $('menu-btn')?.focus(); // back to the control that opened the menu, for keyboard users
    };
    // one tab stop per radio group (its checked option, or its first while nothing is picked), then the buttons
    const stopFor = (name) => modal().querySelector(`input[name="${name}"]:checked`) || modal().querySelector(`input[name="${name}"]`);
    document.addEventListener('DOMContentLoaded', () => {
        apply(desired);
        document.querySelector('#app-menu [data-action="themes"]')?.addEventListener('click', () => {
            document.getElementById('app-menu')?.classList.add('hidden');
            $('theme-error').textContent = '';
            modal()?.classList.remove('auth-hidden');
            stopFor('theme')?.focus();
        });
        $('theme-close')?.addEventListener('click', close);
        modal()?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                close();
                return;
            }
            if (e.key !== 'Tab') return;
            // keep focus inside the dialog: wrap from the last tab stop to the first and back
            const stops = [...NAMES.map(stopFor), ...modal().querySelectorAll('button')].filter(Boolean);
            const active = document.activeElement;
            const at = stops.indexOf(active?.type === 'radio' ? stopFor(active.name) : active);
            if (e.shiftKey ? at <= 0 : at === stops.length - 1) {
                e.preventDefault();
                stops[e.shiftKey ? stops.length - 1 : 0].focus();
            }
        });
        modal()?.addEventListener('change', (e) => {
            if (!NAMES.includes(e.target.name)) return;
            const change = { [e.target.name]: e.target.value };
            desired = { ...desired, ...change };
            const asked = ++version;
            apply(desired);
            // one save at a time, in order, so the file always ends on the latest choice. Only the changed key is
            // sent: the main process merges it into the saved file, which matters if the startup read has not landed
            saving = saving
                .then(() => window.electron.theme.write(change))
                .then((saved) => {
                    $('theme-error').textContent = saved?.error ? 'Could not save the theme: ' + saved.error : '';
                    if (saved && !saved.error && asked === version) {
                        desired = saved;
                        apply(saved);
                    }
                })
                .catch((error) => {
                    // a failed save must not block the ones after it
                    $('theme-error').textContent = 'Could not save the theme: ' + (error?.message || error);
                });
        });
    });
})();
