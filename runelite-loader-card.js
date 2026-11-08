(() => {
    'use strict';

    const TEXT = {
        add: 'Add Microbot to my RuneLite',
        update: 'Update',
        notAdded: 'Adds Microbot to the RuneLite you already use. Open RuneLite the usual way afterwards.',
        added: 'Added. Open RuneLite the usual way; Microbot is in the sidebar.',
        newVersion: 'A new version of Microbot is ready for your RuneLite.',
        signedOut: 'Microbot in RuneLite needs your Microbot sign-in again.',
        working: 'Working...',
        failed: 'Something went wrong. Try again in a minute.'
    };

    const cardView = (view) => {
        if (!view?.visible) return { hidden: true };
        const base = { hidden: false, button: null, remove: false, error: view.error || '', hint: '' };
        if (view.state === 'working') return { ...base, hint: view.progress || TEXT.working };
        if (view.state === 'added') return { ...base, hint: TEXT.added, remove: true };
        if (view.state === 'update') {
            return { ...base, hint: view.reason === 'signed-out' ? TEXT.signedOut : TEXT.newVersion, button: TEXT.update, remove: true };
        }
        return { ...base, hint: TEXT.notAdded, button: TEXT.add };
    };

    if (typeof document === 'undefined') {
        module.exports = { TEXT, cardView };
        return;
    }

    const $ = (id) => document.getElementById(id);
    let busy = false;
    let latest = { visible: false };
    let requests = 0;

    const render = (view) => {
        latest = view || { visible: false };
        const card = $('runelite-loader');
        if (!card) return;
        const shown = cardView(latest);
        card.hidden = shown.hidden;
        if (shown.hidden) return;
        card.classList.toggle('is-working', latest.state === 'working');
        $('runelite-loader-hint').textContent = shown.hint;
        const button = $('runelite-loader-action');
        button.hidden = !shown.button;
        button.textContent = shown.button || '';
        button.disabled = busy;
        const remove = $('runelite-loader-remove');
        remove.hidden = !shown.remove;
        remove.disabled = busy;
        $('runelite-loader-error').textContent = shown.error;
    };

    const api = () => window.electron?.runeliteLoader;

    const refresh = async () => {
        if (!api()) return render({ visible: false });
        const request = ++requests;
        let view;
        try {
            view = await api().state();
        } catch (error) {
            view = { visible: false };
        }
        if (busy || request !== requests) return;
        render(view);
    };

    const act = async (action) => {
        if (busy || !api()) return;
        const before = latest;
        busy = true;
        requests += 1;
        render({ visible: true, state: 'working', progress: TEXT.working });
        let view;
        try {
            view = await api()[action]();
        } catch (error) {
            view = { ...before, error: TEXT.failed };
        }
        busy = false;
        render(view);
    };

    const init = () => {
        $('runelite-loader-action')?.addEventListener('click', () => act('install'));
        $('runelite-loader-remove')?.addEventListener('click', () => act('remove'));
        api()?.onProgress?.((data) => {
            if (busy && data?.text) render({ visible: true, state: 'working', progress: data.text });
        });
        window.electron?.ipcRenderer?.receive('auth:changed', () => refresh());
        refresh();
    };

    window.refreshRuneliteLoader = refresh;
    init();
})();
