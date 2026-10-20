(() => {
    'use strict';

    const NAME_MAX = 32;
    const NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;
    const DEFAULT_NAME = 'default';

    const state = {
        saved: [],
        names: [],
        query: '',
        editing: null,
        confirming: null,
    };

    const $ = (id) => document.getElementById(id);

    const icon = (paths) => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '15');
        svg.setAttribute('height', '15');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        paths.forEach((d) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            svg.appendChild(path);
        });
        return svg;
    };

    const ICONS = {
        rename: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
        duplicate: ['M9 9h11v11H9z', 'M5 15V5h10'],
        remove: ['M6 6l12 12', 'M18 6L6 18'],
    };

    const button = (className, label, attributes = {}) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = className;
        element.textContent = label;
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
        return element;
    };

    const iconButton = (action, name, label, paths, extraClass = '') => {
        const element = button(`profile-icon-button ${extraClass}`.trim(), '', {
            'data-action': action,
            'data-name': name,
            title: label,
            'aria-label': label,
        });
        element.appendChild(icon(paths));
        return element;
    };

    const displayName = (name) => (name === DEFAULT_NAME ? 'Default' : name);

    const validateName = (raw, others, original = null) => {
        const name = raw.trim();
        if (!name) return 'Enter a name for the profile.';
        if (name.length > NAME_MAX) return `Use ${NAME_MAX} characters or fewer.`;
        if (!NAME_PATTERN.test(name)) return 'Use letters, numbers, spaces, dashes or underscores.';
        const lower = name.toLowerCase();
        if (lower === DEFAULT_NAME) return 'Default is reserved. Choose another name.';
        if (others.some((other) => other.toLowerCase() === lower && other !== original)) {
            return 'A profile with that name already exists.';
        }
        return '';
    };

    const copyName = (base, names) => {
        const taken = new Set(names.map((name) => name.toLowerCase()));
        let candidate = `${base} copy`;
        let index = 2;
        while (taken.has(candidate.toLowerCase())) {
            candidate = `${base} copy ${index}`;
            index += 1;
        }
        return candidate.slice(0, NAME_MAX).trim();
    };

    const sortNames = (names) => [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const activeName = () => $('profile')?.value || DEFAULT_NAME;

    const setError = (message) => {
        const element = $('profiles-error');
        if (element) element.textContent = message;
    };

    const updateSummary = () => {
        const count = state.names.length + 1;
        const summary = $('profiles-summary');
        if (summary) {
            summary.textContent = `${count} ${count === 1 ? 'profile' : 'profiles'} on this PC`;
        }
    };

    const buildNameLine = (name) => {
        const line = document.createElement('div');
        line.className = 'profile-name-line';
        const label = document.createElement('span');
        label.className = 'profile-name';
        label.textContent = displayName(name);
        line.appendChild(label);
        if (name === activeName()) {
            const badge = document.createElement('span');
            badge.className = 'profile-badge in-use';
            badge.textContent = 'In use';
            line.appendChild(badge);
        }
        return line;
    };

    const buildMeta = (name) => {
        const meta = document.createElement('div');
        meta.className = 'profile-meta';
        const chip = document.createElement('span');
        chip.className = 'sync-chip local';
        chip.textContent = name === DEFAULT_NAME ? 'Built in' : 'On this PC';
        meta.appendChild(chip);
        return meta;
    };

    const buildEditRow = (name) => {
        const row = document.createElement('li');
        row.className = 'profile-row is-editing';
        const form = document.createElement('form');
        form.className = 'profile-edit-form';
        form.dataset.name = name;
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = NAME_MAX;
        input.value = name;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', `New name for ${name}`);
        input.className = 'profile-edit-input';
        const save = button('profiles-inline-primary', 'Save', { type: 'submit' });
        save.type = 'submit';
        const cancel = button('profiles-inline-secondary', 'Cancel', { 'data-action': 'cancel-edit' });
        form.append(input, save, cancel);
        row.appendChild(form);
        return row;
    };

    const buildConfirmRow = (name) => {
        const row = document.createElement('li');
        row.className = 'profile-row is-confirming';
        const text = document.createElement('p');
        text.className = 'profile-confirm-text';
        text.textContent = `Delete "${name}"? This can't be undone.`;
        const actions = document.createElement('div');
        actions.className = 'profile-confirm-actions';
        const cancel = button('profiles-inline-secondary', 'Keep', { 'data-action': 'cancel-delete' });
        const confirm = button('profiles-inline-danger', 'Delete', { 'data-action': 'confirm-delete', 'data-name': name });
        actions.append(cancel, confirm);
        row.append(text, actions);
        return row;
    };

    const buildRow = (name) => {
        if (name === state.editing) return buildEditRow(name);
        if (name === state.confirming) return buildConfirmRow(name);

        const row = document.createElement('li');
        row.className = 'profile-row';
        if (name === activeName()) row.classList.add('is-active');

        const main = document.createElement('div');
        main.className = 'profile-main';
        main.append(buildNameLine(name), buildMeta(name));

        const actions = document.createElement('div');
        actions.className = 'profile-actions';
        const inUse = name === activeName();
        const saved = name === DEFAULT_NAME || state.saved.includes(name);
        const use = button(inUse ? 'profile-use-button is-current' : 'profile-use-button', inUse ? 'In use' : 'Use', {
            'data-action': 'use',
            'data-name': name,
        });
        use.disabled = inUse || !saved;
        if (!saved) use.title = 'Available after the preview is saved';
        actions.appendChild(use);

        if (name !== DEFAULT_NAME) {
            actions.append(
                iconButton('rename', name, `Rename ${name}`, ICONS.rename),
                iconButton('duplicate', name, `Duplicate ${name}`, ICONS.duplicate),
                iconButton('delete', name, `Delete ${name}`, ICONS.remove, 'profile-delete-button')
            );
        }

        row.append(main, actions);
        return row;
    };

    const render = () => {
        const list = $('profiles-list');
        const empty = $('profiles-empty');
        if (!list) return;
        const query = state.query.trim().toLowerCase();
        const visible = [DEFAULT_NAME, ...sortNames(state.names)].filter(
            (name) => !query || displayName(name).toLowerCase().includes(query)
        );
        list.replaceChildren(...visible.map(buildRow));
        if (empty) empty.classList.toggle('auth-hidden', visible.length > 0);
        updateSummary();
    };

    const load = async () => {
        let names = [];
        try {
            const result = await window.electron.listProfiles();
            if (Array.isArray(result)) names = result;
        } catch (error) {
            names = [];
        }
        state.saved = names.filter((name) => name.toLowerCase() !== DEFAULT_NAME);
        state.names = [...state.saved];
    };

    const hideNewForm = () => {
        $('profiles-new-form')?.classList.add('auth-hidden');
        const input = $('profiles-new-input');
        if (input) input.value = '';
    };

    const showNewForm = () => {
        state.editing = null;
        state.confirming = null;
        setError('');
        $('profiles-new-form')?.classList.remove('auth-hidden');
        $('profiles-new-input')?.focus();
        render();
    };

    const startEdit = (name) => {
        hideNewForm();
        state.confirming = null;
        state.editing = name;
        setError('');
        render();
        const input = document.querySelector('.profile-edit-input');
        input?.focus();
        input?.select();
    };

    const finishEdit = (original, raw) => {
        const others = state.names.filter((name) => name !== original);
        const error = validateName(raw, others, original);
        if (error) {
            setError(error);
            document.querySelector('.profile-edit-input')?.focus();
            return;
        }
        const name = raw.trim();
        state.names = state.names.map((existing) => (existing === original ? name : existing));
        state.editing = null;
        setError('');
        render();
    };

    const duplicate = (name) => {
        const copy = copyName(name, state.names.concat(DEFAULT_NAME));
        state.names = [...state.names, copy];
        setError('');
        render();
    };

    const remove = (name) => {
        state.names = state.names.filter((existing) => existing !== name);
        state.confirming = null;
        setError('');
        render();
    };

    const useProfile = (name) => {
        const select = $('profile');
        if (select) {
            if (![...select.options].some((option) => option.value === name)) {
                select.add(new Option(displayName(name), name));
            }
            select.value = name;
            select.dispatchEvent(new Event('change'));
        }
        close();
    };

    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        if (state.editing || state.confirming) {
            state.editing = null;
            state.confirming = null;
            setError('');
            render();
            return;
        }
        if (!$('profiles-new-form')?.classList.contains('auth-hidden')) {
            hideNewForm();
            setError('');
            return;
        }
        close();
    };

    const open = async () => {
        await load();
        state.query = '';
        state.editing = null;
        state.confirming = null;
        const search = $('profiles-search');
        if (search) search.value = '';
        hideNewForm();
        setError('');
        render();
        $('profiles-modal')?.classList.remove('auth-hidden');
        document.addEventListener('keydown', onKey);
        requestAnimationFrame(() => search?.focus());
    };

    const close = () => {
        $('profiles-modal')?.classList.add('auth-hidden');
        document.removeEventListener('keydown', onKey);
        $('manage-profiles')?.focus();
    };

    const init = () => {
        const modal = $('profiles-modal');
        if (!modal) return;

        $('manage-profiles')?.addEventListener('click', open);
        $('profiles-close')?.addEventListener('click', close);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) close();
        });

        $('profiles-search')?.addEventListener('input', (event) => {
            state.query = event.target.value;
            render();
        });

        $('profiles-new')?.addEventListener('click', showNewForm);
        $('profiles-new-cancel')?.addEventListener('click', () => {
            hideNewForm();
            setError('');
        });
        $('profiles-new-form')?.addEventListener('submit', (event) => {
            event.preventDefault();
            const input = $('profiles-new-input');
            const error = validateName(input.value, state.names);
            if (error) {
                setError(error);
                input.focus();
                return;
            }
            state.names = [...state.names, input.value.trim()];
            hideNewForm();
            setError('');
            render();
        });

        $('profiles-list')?.addEventListener('click', (event) => {
            const target = event.target.closest('button');
            if (!target) return;
            const action = target.dataset.action;
            const name = target.dataset.name;
            if (action === 'use') useProfile(name);
            if (action === 'rename') startEdit(name);
            if (action === 'duplicate') duplicate(name);
            if (action === 'delete') {
                state.editing = null;
                state.confirming = name;
                setError('');
                render();
            }
            if (action === 'cancel-edit') {
                state.editing = null;
                setError('');
                render();
            }
            if (action === 'cancel-delete') {
                state.confirming = null;
                render();
            }
            if (action === 'confirm-delete') remove(name);
        });

        $('profiles-list')?.addEventListener('submit', (event) => {
            const form = event.target.closest('.profile-edit-form');
            if (!form) return;
            event.preventDefault();
            finishEdit(form.dataset.name, form.querySelector('input').value);
        });

        $('profiles-sign-in')?.addEventListener('click', () => {
            close();
            if (typeof window.showAuthModal === 'function') window.showAuthModal();
        });
    };

    init();
})();
