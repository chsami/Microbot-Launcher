// Menu > Themes: applies the saved look on start and saves changes to ~/.microbot/theme.json.
(() => {
    const $ = (id) => document.getElementById(id);
    const apply = ({ theme, font }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.font = font;
        for (const input of document.querySelectorAll('#theme-modal input[type="radio"]')) {
            input.checked = input.value === (input.name === 'theme' ? theme : font);
        }
    };
    // what the user last chose; every read and edit bumps `version` so an older read reply cannot undo a newer choice
    let desired = { theme: 'gold', font: 'montserrat' };
    let version = 0;
    let saving = Promise.resolve();

    // theme.json is shared with the native launcher and clients, so pick up changes made elsewhere
    // waits for queued saves first, so it reads what this window last saved rather than a half-saved state
    const sync = () => {
        const asked = ++version;
        return saving
            .then(() => (asked === version ? window.electron?.theme?.read() : null))
            .then((saved) => {
                if (saved && asked === version) {
                    desired = saved;
                    apply(saved);
                }
            });
    };
    sync();
    window.addEventListener('focus', sync);

    const modal = () => $('theme-modal');
    const close = () => modal()?.classList.add('auth-hidden');
    document.addEventListener('DOMContentLoaded', () => {
        apply(desired);
        document.querySelector('#app-menu [data-action="themes"]')?.addEventListener('click', () => {
            document.getElementById('app-menu')?.classList.add('hidden');
            $('theme-error').textContent = '';
            modal()?.classList.remove('auth-hidden');
            document.querySelector('#theme-modal input:checked')?.focus();
        });
        $('theme-close')?.addEventListener('click', close);
        modal()?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                close();
                return;
            }
            if (e.key !== 'Tab') return;
            // keep focus inside the dialog: wrap from the last tab stop to the first and back
            const stops = [...modal().querySelectorAll('input[type="radio"]:checked, button')];
            const active = document.activeElement;
            const at = stops.indexOf(active?.type === 'radio' ? modal().querySelector(`input[name="${active.name}"]:checked`) : active);
            if (e.shiftKey ? at <= 0 : at === stops.length - 1) {
                e.preventDefault();
                stops[e.shiftKey ? stops.length - 1 : 0].focus();
            }
        });
        modal()?.addEventListener('change', (e) => {
            const next = { ...desired, [e.target.name]: e.target.value };
            desired = next;
            version++;
            apply(next);
            // one save at a time, in order, so the file always ends on the latest choice
            saving = saving.then(async () => {
                const saved = await window.electron.theme.write(next);
                $('theme-error').textContent = saved?.error ? 'Could not save the theme: ' + saved.error : '';
            });
        });
    });
})();
