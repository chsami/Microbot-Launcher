(() => {
    'use strict';

    const TEXT = {
        add: 'Add Microbot to my RuneLite',
        update: 'Update',
        added: 'Added. Open RuneLite the usual way; Microbot is in the sidebar.',
        newVersion: 'A new version of Microbot is ready for your RuneLite.',
        signedOut: 'Microbot in RuneLite needs your Microbot sign-in again.',
        notLoading: "RuneLite won't load Microbot right now. Press Update to fix it.",
        removeOnly: 'Microbot is still in your RuneLite.',
        notReady: 'Microbot is waiting for an update for the latest RuneLite.',
        open: 'Open RuneLite',
        find: 'Find RuneLite…',
        working: 'Working...',
        failed: 'Something went wrong. Try again in a minute.'
    };

    const MODES = ['client', 'runelite'];
    const FLASH_MS = 6000;

    const layout = (view, chosen) => {
        if (!view?.visible) return { switchHidden: true, mode: 'client' };
        return { switchHidden: false, mode: MODES.includes(chosen) ? chosen : 'client' };
    };

    const cardView = (view) => {
        if (!view?.visible) return { hidden: true };
        const base = { hidden: false, button: null, action: null, remove: false, error: view.error || '', hint: '', note: '' };
        if (view.state === 'working') return { ...base, hint: view.progress || TEXT.working };
        if (view.state === 'added') {
            const find = view.opener === 'find';
            return {
                ...base,
                hint: view.flash || TEXT.added,
                note: view.note === 'not-ready' ? TEXT.notReady : '',
                button: find ? TEXT.find : TEXT.open,
                action: find ? 'find' : 'open',
                remove: true
            };
        }
        if (view.state === 'remove-only') return { ...base, hint: TEXT.removeOnly, remove: true };
        if (view.state === 'update') {
            const hints = { 'signed-out': TEXT.signedOut, 'not-loading': TEXT.notLoading };
            return { ...base, hint: hints[view.reason] || TEXT.newVersion, button: TEXT.update, action: 'install', remove: true };
        }
        return { ...base, button: TEXT.add, action: 'install' };
    };

    if (typeof document === 'undefined') {
        module.exports = { TEXT, MODES, cardView, layout };
        return;
    }

    const $ = (id) => document.getElementById(id);
    let busy = false;
    let latest = { visible: false };
    let mode = 'client';
    let requests = 0;

    const applyLayout = () => {
        const shown = layout(latest, mode);
        const modeSwitch = $('launcher-mode');
        if (modeSwitch) modeSwitch.hidden = shown.switchHidden;
        document.querySelectorAll('.mode-option').forEach((option) => {
            option.setAttribute('aria-pressed', option.dataset.mode === shown.mode ? 'true' : 'false');
        });
        document.querySelector('.sidebar')?.classList.toggle('mode-runelite', shown.mode === 'runelite');
        const runeliteView = $('runelite-view');
        if (runeliteView) runeliteView.hidden = shown.mode !== 'runelite';
    };

    const render = (view) => {
        latest = view || { visible: false };
        if (!latest.visible) mode = 'client';
        else if (MODES.includes(latest.mode)) mode = latest.mode;
        applyLayout();
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
        button.disabled = busy || Boolean(latest.flash);
        button.dataset.action = shown.action || '';
        const remove = $('runelite-loader-remove');
        remove.hidden = !shown.remove;
        remove.disabled = busy;
        $('runelite-loader-error').textContent = shown.error;
        const note = $('runelite-loader-note');
        if (note) note.textContent = shown.note;
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

    const choose = async (next) => {
        if (!MODES.includes(next) || !latest.visible || next === mode) return;
        mode = next;
        latest = { ...latest, mode: next };
        applyLayout();
        try {
            await api()?.setMode?.(next);
        } catch (error) {
            window.electron?.logError?.(`Could not save the launcher view: ${error?.message || error}`);
        }
    };

    const act = async (action) => {
        if (busy || !api()) return;
        const before = latest;
        busy = true;
        requests += 1;
        render({ visible: true, state: 'working', progress: TEXT.working, mode });
        let view;
        try {
            view = await api()[action]();
        } catch (error) {
            view = { ...before, error: TEXT.failed };
        }
        busy = false;
        render(view);
    };

    let flashTimer = null;

    const launchRuneLite = async (action) => {
        if (busy || !api()?.[action]) return;
        busy = true;
        render({ ...latest, error: '' });
        let result;
        try {
            result = await api()[action]();
        } catch (error) {
            result = { ok: false, error: TEXT.failed };
        }
        busy = false;
        if (result?.cancelled) return render(latest);
        const opener = result?.opener || latest.opener;
        if (!result?.ok) return render({ ...latest, opener, error: result?.error || TEXT.failed });
        clearTimeout(flashTimer);
        render({ ...latest, opener, error: '', flash: result.message });
        flashTimer = setTimeout(() => {
            if (latest.flash) render({ ...latest, flash: '' });
        }, FLASH_MS);
    };

    const press = () => {
        const action = $('runelite-loader-action')?.dataset.action;
        if (action === 'open' || action === 'find') launchRuneLite(action);
        else act('install');
    };

    const init = () => {
        $('runelite-loader-action')?.addEventListener('click', press);
        $('runelite-loader-remove')?.addEventListener('click', () => act('remove'));
        document.querySelectorAll('.mode-option').forEach((option) => {
            option.addEventListener('click', () => choose(option.dataset.mode));
        });
        api()?.onProgress?.((data) => {
            if (busy && data?.text) render({ visible: true, state: 'working', progress: data.text, mode });
        });
        window.electron?.ipcRenderer?.receive('auth:changed', () => refresh());
        refresh();
    };

    window.refreshRuneliteLoader = refresh;
    init();
})();
