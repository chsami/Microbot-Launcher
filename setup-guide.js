(() => {
    'use strict';

    const HIDE_KEY = 'hide_setup_guide';
    const CANCEL_LOGIN_TEXT = 'Cancel login';
    const NAMES_SHOWN = 3;

    const shouldAutoShow = (properties) => properties?.[HIDE_KEY] !== true;

    const parseTargets = (value) => String(value ?? '').split(/\s+/).filter(Boolean);

    const listNames = (names) => {
        if (names.length <= NAMES_SHOWN) {
            return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        }
        return `${names.slice(0, NAMES_SHOWN).join(', ')} and ${names.length - NAMES_SHOWN} more`;
    };

    const jagexStatus = (accounts) => {
        const list = Array.isArray(accounts) ? accounts : [];
        if (list.length === 0) {
            return { done: false, count: 0, text: 'No Jagex characters added yet.' };
        }
        const names = list.map((account) => String(account?.displayName || '').trim() || 'Unnamed character');
        const noun = list.length === 1 ? 'character' : 'characters';
        return { done: true, count: list.length, text: `${list.length} ${noun} added: ${listNames(names)}.` };
    };

    const microbotStatus = (status) => {
        if (status?.authenticated) {
            const email = status?.user?.email;
            return { done: true, canSignIn: false, text: email ? `Signed in as ${email}.` : 'Signed in.' };
        }
        if (status?.api || status?.mock) {
            return { done: false, canSignIn: true, text: "You're not signed in. That's fine." };
        }
        return { done: false, canSignIn: false, text: "Microbot accounts aren't available in this launcher yet." };
    };

    if (typeof document === 'undefined') {
        module.exports = { HIDE_KEY, shouldAutoShow, parseTargets, jagexStatus, microbotStatus };
        return;
    }

    const $ = (id) => document.getElementById(id);

    const state = {
        index: 0,
        open: false,
        paused: false,
        focus: null,
        frame: 0,
        returnFocus: null,
        accountCount: 0,
    };

    let steps = [];

    const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };

    const resolveTarget = (value) => parseTargets(value).map($).find(isVisible) || null;

    const currentStep = () => steps[state.index];

    const svg = (paths, size = 14) => {
        const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        element.setAttribute('viewBox', '0 0 24 24');
        element.setAttribute('width', String(size));
        element.setAttribute('height', String(size));
        element.setAttribute('aria-hidden', 'true');
        element.setAttribute('fill', 'none');
        element.setAttribute('stroke', 'currentColor');
        element.setAttribute('stroke-width', '2.5');
        element.setAttribute('stroke-linecap', 'round');
        element.setAttribute('stroke-linejoin', 'round');
        paths.forEach((d) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            element.appendChild(path);
        });
        return element;
    };

    const placeRing = () => {
        const ring = $('guide-ring');
        const overlay = $('setup-guide');
        const target = state.focus;
        if (!target || !isVisible(target)) {
            ring.classList.add('guide-hidden');
            overlay.classList.add('dimmed');
            return;
        }
        const rect = target.getBoundingClientRect();
        const pad = 5;
        const edge = 3;
        const top = Math.max(edge, rect.top - pad);
        const left = Math.max(edge, rect.left - pad);
        const right = Math.min(window.innerWidth - edge, rect.right + pad);
        const bottom = Math.min(window.innerHeight - edge, rect.bottom + pad);
        ring.style.top = `${top}px`;
        ring.style.left = `${left}px`;
        ring.style.width = `${right - left}px`;
        ring.style.height = `${bottom - top}px`;
        ring.classList.remove('guide-hidden');
        overlay.classList.remove('dimmed');
    };

    const track = () => {
        placeRing();
        state.frame = state.focus ? requestAnimationFrame(track) : 0;
    };

    const spotlight = (element) => {
        if (element === state.focus && state.frame) return;
        state.focus = element;
        element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (state.frame) cancelAnimationFrame(state.frame);
        state.frame = 0;
        track();
    };

    const stepDefault = () => resolveTarget(currentStep()?.dataset.target);

    const setActiveItem = (item) => {
        currentStep()?.querySelectorAll('.guide-active').forEach((element) => element.classList.remove('guide-active'));
        item?.classList.add('guide-active');
    };

    const syncSidebarWidth = () => {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        document.documentElement.style.setProperty('--guide-sidebar', `${sidebar.offsetWidth}px`);
    };

    const setStatus = (id, status) => {
        const element = $(id);
        if (!element) return;
        element.textContent = status.text;
        element.classList.toggle('done', status.done);
    };

    const refreshStatus = async () => {
        const [accounts, auth] = await Promise.all([
            Promise.resolve(window.electron.readAccounts?.()).catch(() => null),
            Promise.resolve(window.electron.auth?.status?.()).catch(() => null),
        ]);
        const jagex = jagexStatus(accounts);
        state.accountCount = jagex.count;
        setStatus('guide-jagex-status', jagex);
        document.querySelectorAll('[data-action="jagex-login"]').forEach((button) => {
            button.textContent = jagex.count > 0 ? 'Add another Jagex account' : 'Log in with Jagex now';
        });

        const microbot = microbotStatus(auth);
        setStatus('guide-microbot-status', microbot);
        document.querySelectorAll('[data-requires="microbot-auth"]').forEach((element) => {
            element.hidden = !microbot.canSignIn;
        });

        refreshShowButtons();
    };

    const refreshShowButtons = () => {
        document.querySelectorAll('.guide-show').forEach((button) => {
            button.hidden = !resolveTarget(button.dataset.target);
        });
    };

    const renderStepper = () => {
        const stepper = $('guide-stepper');
        stepper.replaceChildren(
            ...steps.map((step, index) => {
                const item = document.createElement('li');
                item.classList.toggle('done', index < state.index);
                item.classList.toggle('current', index === state.index);

                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'guide-stepper-item';
                button.dataset.index = String(index);
                if (index === state.index) button.setAttribute('aria-current', 'step');
                button.setAttribute('aria-label', `Step ${index + 1} of ${steps.length}: ${step.dataset.title}`);

                const dot = document.createElement('span');
                dot.className = 'guide-stepper-dot';
                if (index < state.index) dot.appendChild(svg(['M5 12l5 5 9-10']));
                else dot.textContent = String(index + 1);

                const label = document.createElement('span');
                label.className = 'guide-stepper-label';
                label.textContent = step.dataset.title;

                button.append(dot, label);
                item.appendChild(button);
                return item;
            })
        );
    };

    const render = () => {
        steps.forEach((step, index) => {
            step.hidden = index !== state.index;
        });
        renderStepper();
        const last = state.index === steps.length - 1;
        $('guide-back').disabled = state.index === 0;
        $('guide-next').textContent = last ? 'Finish' : 'Next';
        document.querySelector('.guide-body').scrollTop = 0;
        setActiveItem(null);
        refreshShowButtons();
        spotlight(stepDefault());
        refreshStatus().catch(() => {});
    };

    const go = (index) => {
        state.index = Math.max(0, Math.min(steps.length - 1, index));
        render();
    };

    const focusables = () =>
        Array.from(
            $('guide-card').querySelectorAll('button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])')
        ).filter((element) => !element.hidden && isVisible(element));

    const onKeydown = (event) => {
        if (!state.open) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
            return;
        }
        if (event.key === 'Tab') {
            const items = focusables();
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            const inside = $('guide-card').contains(document.activeElement);
            if (event.shiftKey && (document.activeElement === first || !inside)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
                event.preventDefault();
                first.focus();
            }
            return;
        }
        if (event.target?.matches?.('input, select, textarea')) return;
        if (event.key === 'ArrowRight' && state.index < steps.length - 1) go(state.index + 1);
        if (event.key === 'ArrowLeft' && state.index > 0) go(state.index - 1);
    };

    const showOverlay = () => {
        $('guide-resume').classList.add('guide-hidden');
        $('guide-ring').classList.remove('pointing');
        $('setup-guide').classList.remove('guide-hidden');
        syncSidebarWidth();
        document.addEventListener('keydown', onKeydown, true);
    };

    const hideOverlay = () => {
        $('setup-guide').classList.add('guide-hidden');
        document.removeEventListener('keydown', onKeydown, true);
    };

    const syncHideCheckbox = async () => {
        const properties = await window.electron.readProperties();
        $('guide-hide').checked = !shouldAutoShow(properties);
    };

    const saveHidden = async (hidden) => {
        const write = async (properties) => {
            properties[HIDE_KEY] = hidden;
            await window.electron.writeProperties(properties);
        };
        if (typeof window.withProperties === 'function') return window.withProperties(write);
        return write(await window.electron.readProperties());
    };

    const open = (index = 0) => {
        if (steps.length === 0) return;
        if (!state.open && !state.paused) state.returnFocus = document.activeElement;
        state.open = true;
        state.paused = false;
        state.index = Math.max(0, Math.min(steps.length - 1, index));
        showOverlay();
        render();
        syncHideCheckbox().catch(() => {});
        setTimeout(() => $('guide-card')?.focus(), 0);
    };

    const close = () => {
        state.open = false;
        state.paused = false;
        hideOverlay();
        $('guide-resume').classList.add('guide-hidden');
        $('guide-ring').classList.remove('pointing');
        spotlight(null);
        const returnFocus = state.returnFocus;
        state.returnFocus = null;
        if (returnFocus?.isConnected) returnFocus.focus();
    };

    const pause = () => {
        state.open = false;
        state.paused = true;
        hideOverlay();
        const resume = $('guide-resume-open');
        resume.textContent = `Back to the setup guide (step ${state.index + 1} of ${steps.length})`;
        $('guide-resume').classList.remove('guide-hidden');
        spotlight(null);
    };

    const clearPointer = () => {
        if (state.open) return;
        $('guide-ring').classList.remove('pointing');
        spotlight(null);
    };

    const pointAt = (element) => {
        pause();
        $('guide-ring').classList.add('pointing');
        spotlight(element);
        document.addEventListener('pointerdown', clearPointer, { capture: true, once: true });
    };

    const jagexLogin = async () => {
        const pending = [$('play'), $('add-accounts')].find(
            (button) => button?.textContent.trim() === CANCEL_LOGIN_TEXT
        );
        if (pending) {
            pointAt(pending);
            return;
        }
        const button = resolveTarget('add-accounts play');
        if (!button || typeof window.runJagexLogin !== 'function') return;
        const before = state.accountCount;
        pointAt(button);
        await window.runJagexLogin(button);
        const accounts = await Promise.resolve(window.electron.readAccounts()).catch(() => null);
        if (state.paused && jagexStatus(accounts).count > before) open(state.index);
    };

    const showAuth = (tab) => {
        if (typeof window.showAuthModal !== 'function') return;
        pause();
        window.showAuthModal();
        if (tab === 'signup') {
            window.setActiveAuthTab?.('signup');
            setTimeout(() => $('signup-email')?.focus(), 0);
        }
    };

    const reportError = (result) => {
        if (result?.error) window.electron.errorAlert?.(result.error);
    };

    const runAction = async (action) => {
        if (action === 'jagex-login') await jagexLogin();
        if (action === 'microbot-signup') showAuth('signup');
        if (action === 'microbot-signin') showAuth('signin');
        if (action === 'discord') reportError(await window.electron.openHelpLink?.('discord'));
        if (action === 'logs') reportError(await window.electron.openLocation('launcher-logs'));
    };

    const addShowButtons = () => {
        document.querySelectorAll('.guide-step li[data-target]').forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'guide-show';
            button.dataset.target = item.dataset.target;
            button.append(svg(['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'], 13));
            button.append(document.createTextNode('Show me'));
            item.appendChild(button);
        });
    };

    const onHover = (event) => {
        if (!state.open) return;
        const item = event.target.closest?.('li[data-target]');
        const target = item ? resolveTarget(item.dataset.target) : null;
        setActiveItem(target ? item : null);
        spotlight(target || stepDefault());
    };

    const init = () => {
        steps = Array.from(document.querySelectorAll('#setup-guide .guide-step'));
        if (steps.length === 0) return;
        addShowButtons();

        $('guide-close')?.addEventListener('click', close);
        $('guide-back')?.addEventListener('click', () => go(state.index - 1));
        $('guide-next')?.addEventListener('click', () => {
            if (state.index === steps.length - 1) close();
            else go(state.index + 1);
        });
        $('guide-stepper')?.addEventListener('click', (event) => {
            const button = event.target.closest('.guide-stepper-item');
            if (button) go(Number(button.dataset.index));
        });
        $('guide-hide')?.addEventListener('change', (event) => {
            saveHidden(event.target.checked).catch((error) => {
                window.electron.logError?.(`Failed to save the setup guide setting: ${error?.message || error}`);
            });
        });
        $('guide-resume-open')?.addEventListener('click', () => open(state.index));
        $('guide-resume-dismiss')?.addEventListener('click', close);

        const body = document.querySelector('#setup-guide .guide-body');
        body?.addEventListener('pointerover', onHover);
        body?.addEventListener('focusin', onHover);
        body?.addEventListener('pointerleave', () => {
            if (!state.open) return;
            setActiveItem(null);
            spotlight(stepDefault());
        });
        body?.addEventListener('click', (event) => {
            const show = event.target.closest('.guide-show');
            if (show) {
                const target = resolveTarget(show.dataset.target);
                if (target) pointAt(target);
                return;
            }
            const action = event.target.closest('[data-action]');
            if (action) runAction(action.dataset.action);
        });

        window.addEventListener('resize', () => {
            if (state.open) syncSidebarWidth();
        });
    };

    window.openSetupGuide = () => open(0);
    window.maybeShowSetupGuide = async () => {
        const properties = await window.electron.readProperties();
        if (shouldAutoShow(properties) && !state.open && !state.paused) open(0);
    };

    init();
})();
