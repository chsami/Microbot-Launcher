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
    let current = { theme: 'gold', font: 'montserrat' };
    // theme.json is shared with the native launcher and clients, so pick up changes made elsewhere
    const sync = () => window.electron?.theme?.read().then((saved) => {
        current = saved;
        apply(saved);
    });
    sync();
    window.addEventListener('focus', sync);

    const close = () => $('theme-modal')?.classList.add('auth-hidden');
    document.addEventListener('DOMContentLoaded', () => {
        apply(current);
        document.querySelector('#app-menu [data-action="themes"]')?.addEventListener('click', () => {
            document.getElementById('app-menu')?.classList.add('hidden');
            $('theme-error').textContent = '';
            $('theme-modal')?.classList.remove('auth-hidden');
            document.querySelector('#theme-modal input:checked')?.focus();
        });
        $('theme-close')?.addEventListener('click', close);
        $('theme-modal')?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        });
        $('theme-modal')?.addEventListener('change', async (e) => {
            const next = { ...current, [e.target.name]: e.target.value };
            apply(next);
            const saved = await window.electron.theme.write(next);
            if (saved?.error) {
                $('theme-error').textContent = 'Could not save the theme: ' + saved.error;
            } else {
                current = saved;
            }
        });
    });
})();
