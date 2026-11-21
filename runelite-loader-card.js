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
        switchedOff: 'Microbot is switched off in your RuneLite.',
        turnOn: 'Turn Microbot on',
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
        const base = {
            hidden: false,
            button: null,
            action: null,
            secondary: null,
            secondaryAction: null,
            starts: '',
            change: false,
            remove: false,
            error: view.error || '',
            hint: '',
            note: ''
        };
        const find = view.opener === 'find';
        const opener = {
            text: find ? TEXT.find : TEXT.open,
            action: find ? 'find' : 'open',
            starts: !find && view.starts ? `Starts ${view.starts}` : '',
            change: !find
        };
        if (view.state === 'working') return { ...base, hint: view.progress || TEXT.working };
        if (view.state === 'added') {
            return {
                ...base,
                hint: view.flash || TEXT.added,
                note: view.note === 'not-ready' ? TEXT.notReady : '',
                button: opener.text,
                action: opener.action,
                starts: opener.starts,
                change: opener.change,
                remove: true
            };
        }
        if (view.state === 'switched-off') {
            return {
                ...base,
                hint: view.flash || TEXT.switchedOff,
                button: TEXT.turnOn,
                action: 'install',
                secondary: opener.text,
                secondaryAction: opener.action,
                starts: opener.starts,
                change: opener.change,
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
        const secondary = $('runelite-loader-open');
        if (secondary) {
            secondary.hidden = !shown.secondary;
            secondary.textContent = shown.secondary || '';
            secondary.disabled = busy || Boolean(latest.flash);
            secondary.dataset.action = shown.secondaryAction || '';
        }
        const starts = $('runelite-loader-starts');
        if (starts) {
            starts.hidden = !shown.starts;
            const label = $('runelite-loader-starts-label');
            if (label) label.textContent = shown.starts;
        }
        const change = $('runelite-loader-change');
        if (change) {
            change.hidden = !shown.change;
            change.disabled = busy;
        }
        const remove = $('runelite-loader-remove');
        remove.hidden = !shown.remove;
        remove.disabled = busy;
        $('runelite-loader-error').textContent = shown.error;
        const note = $('runelite-loader-note');
        if (note) note.textContent = shown.note;
    };

    const api = () => window.electron?.runeliteLoader;
    const recorderApi = () => window.electron?.sessionRecorder;
    let recorder = { visible: false };

    const renderRecorder = (view) => {
        recorder = view || { visible: false };
        const row = $('session-recorder-row');
        if (!row) return;
        row.classList.toggle('hidden', !recorder.visible);
        $('session-recorder-switch').checked = recorder.on === true;
        $('session-recorder-hint').textContent = recorder.message || '';
    };

    const refreshRecorder = async () => {
        if (!recorderApi()) return renderRecorder(null);
        try {
            renderRecorder(await recorderApi().state());
        } catch (error) {
            renderRecorder(null);
        }
    };

    const toggleRecorder = async (on) => {
        try {
            renderRecorder(await recorderApi().setOn(on));
        } catch (error) {
            renderRecorder({ ...recorder, message: TEXT.failed });
        }
    };

    const refresh = async () => {
        refreshRecorder();
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
            result = action === 'open' && recorder.on && (recorder.running || recorder.updating) ? await recorderApi().open() : await api()[action]();
        } catch (error) {
            result = { ok: false, error: TEXT.failed };
        }
        busy = false;
        if (result?.cancelled) return render(latest);
        const opener = result?.opener || latest.opener;
        const starts = result?.starts || (opener === 'find' ? undefined : latest.starts);
        if (!result?.ok) return render({ ...latest, opener, starts, error: result?.error || TEXT.failed });
        clearTimeout(flashTimer);
        render({ ...latest, opener, starts, error: '', flash: result.message });
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
        $('runelite-loader-open')?.addEventListener('click', () => {
            const action = $('runelite-loader-open').dataset.action;
            if (action === 'open' || action === 'find') launchRuneLite(action);
        });
        $('runelite-loader-change')?.addEventListener('click', () => launchRuneLite('find'));
        $('runelite-loader-remove')?.addEventListener('click', () => act('remove'));
        document.querySelectorAll('.mode-option').forEach((option) => {
            option.addEventListener('click', () => choose(option.dataset.mode));
        });
        $('session-recorder-switch')?.addEventListener('change', (event) => toggleRecorder(event.target.checked));
        recorderApi()?.onStatus?.((view) => renderRecorder(view));
        api()?.onProgress?.((data) => {
            if (busy && data?.text) render({ visible: true, state: 'working', progress: data.text, mode });
        });
        window.electron?.ipcRenderer?.receive('auth:changed', () => refresh());
        refresh();
    };

    window.refreshRuneliteLoader = refresh;
    init();
})();
