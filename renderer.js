let accounts = [];
let iii = null;
let lastAccountsReadError = null;
let cleanupAccountsDropdownListeners = null;

const DEFAULT_CLIENT_RAM = '1g';
let launcherInitialized = false;
let authUiReady = false;
let mockAuthEnabled = false;
let currentSessionEmail = '';

function $(id) {
    return document.getElementById(id);
}

function toggleClass(element, className, shouldAdd) {
    if (!element) return;
    if (shouldAdd) {
        element.classList.add(className);
    } else {
        element.classList.remove(className);
    }
}

function setButtonLoading(button, isLoading, loadingText) {
    if (!button) return;
    if (isLoading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }
        if (loadingText) {
            button.textContent = loadingText;
        }
        button.disabled = true;
    } else {
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
        button.disabled = false;
    }
}

function setAuthError(message, elementId = 'auth-error', isSuccess = false) {
    const element = $(elementId);
    if (!element) return;
    element.textContent = message || '';
    toggleClass(element, 'success', Boolean(isSuccess && message));
}

function setActiveAuthTab(target) {
    const signinTab = $('auth-tab-signin');
    const signupTab = $('auth-tab-signup');
    const signinForm = $('signin-form');
    const signupForm = $('signup-form');
    const isSignin = target === 'signin';

    toggleClass(signinTab, 'active', isSignin);
    toggleClass(signupTab, 'active', !isSignin);
    if (signinTab) signinTab.setAttribute('aria-selected', isSignin ? 'true' : 'false');
    if (signupTab) signupTab.setAttribute('aria-selected', isSignin ? 'false' : 'true');
    toggleClass(signinForm, 'auth-hidden', !isSignin);
    toggleClass(signupForm, 'auth-hidden', isSignin);
    setAuthError('');
}

function showAuthModal() {
    const modal = $('auth-modal');
    if (!modal) return;
    modal.classList.remove('auth-hidden');
    $('signin-form')?.reset();
    $('signup-form')?.reset();
    setActiveAuthTab('signin');
}

function hideAuthModal() {
    const modal = $('auth-modal');
    if (!modal) return;
    modal.classList.add('auth-hidden');
    setAuthError('');
}

function showChangePasswordModal() {
    if (!mockAuthEnabled) return;
    const modal = $('change-password-modal');
    if (!modal) return;
    $('change-password-form')?.reset();
    setAuthError('', 'change-password-error');
    modal.classList.remove('auth-hidden');
    const input = $('change-password-input');
    if (input) {
        setTimeout(() => input.focus(), 0);
    }
}

function hideChangePasswordModal() {
    const modal = $('change-password-modal');
    if (!modal) return;
    modal.classList.add('auth-hidden');
    setAuthError('', 'change-password-error');
}

function updateSessionEmail(email) {
    currentSessionEmail = email || '';
    const sessionContainer = $('user-session');
    const emailLabel = $('session-email');
    if (!sessionContainer || !emailLabel) return;
    if (!mockAuthEnabled || !currentSessionEmail) {
        sessionContainer.classList.add('hidden');
        emailLabel.textContent = '';
    } else {
        emailLabel.textContent = currentSessionEmail;
        sessionContainer.classList.remove('hidden');
    }
}

async function handleSignIn(event) {
    event.preventDefault();
    if (!mockAuthEnabled) {
        hideAuthModal();
        await ensureLauncherInitialized();
        return;
    }
    const email = $('signin-email')?.value?.trim();
    const password = $('signin-password')?.value || '';
    if (!email || !password) {
        setAuthError('Email and password are required');
        return;
    }
    setAuthError('');
    const button = $('signin-submit');
    setButtonLoading(button, true, 'Signing In...');
    try {
        const result = await window.electron.auth.signin({ email, password });
        if (result?.success) {
            await refreshAuthStatus();
        } else {
            setAuthError(result?.error || 'Unable to sign in');
        }
    } catch (error) {
        setAuthError(error?.message || 'Unable to sign in');
    } finally {
        setButtonLoading(button, false);
    }
}

async function handleSignUp(event) {
    event.preventDefault();
    if (!mockAuthEnabled) {
        hideAuthModal();
        await ensureLauncherInitialized();
        return;
    }
    const email = $('signup-email')?.value?.trim();
    const password = $('signup-password')?.value || '';
    if (!email || !password) {
        setAuthError('Email and password are required');
        return;
    }
    if (password.length < 8) {
        setAuthError('Password must be at least 8 characters.');
        return;
    }
    setAuthError('');
    const button = $('signup-submit');
    setButtonLoading(button, true, 'Creating Account...');
    try {
        const result = await window.electron.auth.signup({ email, password });
        if (result?.success) {
            await refreshAuthStatus();
        } else {
            setAuthError(result?.error || 'Unable to create account');
        }
    } catch (error) {
        setAuthError(error?.message || 'Unable to create account');
    } finally {
        setButtonLoading(button, false);
    }
}

async function handleSignOut() {
    if (!mockAuthEnabled) return;
    const button = $('signout-btn');
    setButtonLoading(button, true, 'Signing Out...');
    try {
        const result = await window.electron.auth.signout();
        if (result?.success) {
            await refreshAuthStatus();
        } else if (result?.error) {
            window.electron.errorAlert(result.error);
        }
    } catch (error) {
        window.electron.errorAlert(error?.message || 'Unable to sign out.');
    } finally {
        setButtonLoading(button, false);
        hideChangePasswordModal();
    }
}

async function handleChangePassword(event) {
    event.preventDefault();
    if (!mockAuthEnabled) return;
    const newPassword = $('change-password-input')?.value || '';
    if (newPassword.length < 8) {
        setAuthError('Password must be at least 8 characters.', 'change-password-error');
        return;
    }
    setAuthError('', 'change-password-error');
    const button = $('change-password-submit');
    setButtonLoading(button, true, 'Saving...');
    try {
        const result = await window.electron.auth.changePassword({
            newPassword
        });
        if (result?.success) {
            $('change-password-form')?.reset();
            setAuthError('Password updated successfully.', 'change-password-error', true);
            setTimeout(() => {
                hideChangePasswordModal();
                setAuthError('', 'change-password-error');
            }, 1200);
        } else if (result?.error) {
            setAuthError(result.error, 'change-password-error');
        }
    } catch (error) {
        setAuthError(error?.message || 'Unable to change password.', 'change-password-error');
    } finally {
        setButtonLoading(button, false);
    }
}

function setupAuthUI() {
    if (authUiReady) return;
    authUiReady = true;
    $('signin-form')?.addEventListener('submit', handleSignIn);
    $('signup-form')?.addEventListener('submit', handleSignUp);
    $('auth-tab-signin')?.addEventListener('click', () => setActiveAuthTab('signin'));
    $('auth-tab-signup')?.addEventListener('click', () => setActiveAuthTab('signup'));
    $('signout-btn')?.addEventListener('click', handleSignOut);
    $('change-password-btn')?.addEventListener('click', showChangePasswordModal);
    $('change-password-cancel')?.addEventListener('click', hideChangePasswordModal);
    $('change-password-form')?.addEventListener('submit', handleChangePassword);
    setActiveAuthTab('signin');
}

async function refreshAuthStatus() {
    let status = null;
    try {
        status = await window.electron.auth.status();
    } catch (error) {
        status = { authenticated: true, mock: false };
    }

    mockAuthEnabled = Boolean(status?.mock);
    if (!mockAuthEnabled) {
        hideAuthModal();
        hideChangePasswordModal();
        updateSessionEmail(status?.user?.email || '');
        await ensureLauncherInitialized();
        return;
    }

    if (status?.authenticated) {
        hideAuthModal();
        updateSessionEmail(status?.user?.email || '');
        await ensureLauncherInitialized();
    } else {
        showAuthModal();
        updateSessionEmail('');
    }
}

async function ensureLauncherInitialized() {
    if (launcherInitialized) return;
    launcherInitialized = true;
    await initializeLauncher();
}

/**
 * Properties object used for client versioning, etc.
 * @typedef {{client: string, launcher_html: string, launcher: string, version_pref: string}} MicrobotProperties
 */

async function openClient() {
    const clientValue = document.getElementById('client').value;

    // Check if a valid client version is selected
    if (
        !clientValue ||
        clientValue === '' ||
        !clientValue.includes('microbot-')
    ) {
        window.electron.errorAlert('Please select a valid client version');
        return;
    }

    const version = extractVersion(clientValue);

    const result = await downloadClientIfNotExist(version);
    if (!result.exists) return;

    const proxy = getProxyValues();
    const ramPreference = getClientRamPreference();

    document.getElementById('loader-container').style.display = 'none';

    // Get the select element by its ID
    const selectElement = document.getElementById('character');

    // Get the selected value
    const selectedValue = selectElement.value;

    const selectedAccount = accounts?.find(
        (x) => x.accountId === selectedValue
    );
    if (selectedAccount) {
        try {
            const result = await window.electron.updateClientJarTTL(version);
            if (result?.error) {
                window.electron.logError(result.error);
            }
            await window.electron.overwriteCredentialProperties(
                selectedAccount
            );
            const launchResult = await window.electron.openClient(
                version,
                proxy,
                selectedAccount,
                ramPreference
            );
            if (launchResult?.error) {
                window.electron.errorAlert(launchResult.error);
            }
        } catch (err) {
            window.electron.errorAlert(err?.message || String(err));
        }
    } else {
        alert('Account not found. Please restart your client.');
    }
}

window.electron.ipcRenderer.receive('progress', (event, data) => {
    if (data) {
        updateProgress(data.percent, data.status);
    }
});

function updateProgress(percent, status) {
    const progressBar = document.getElementById('progress-bar');
    const statusText = document.getElementById('status');

    progressBar.style.width = percent + '%';
    progressBar.textContent = percent + '%';
    statusText.textContent = status;
}

function reportAccountsError(message) {
    if (!message) {
        return;
    }

    if (lastAccountsReadError === message) {
        window.electron?.logError?.(message);
        return;
    }

    lastAccountsReadError = message;
    window.electron?.errorAlert?.(message);
}

async function safeReadAccounts() {
    const result = await window.electron.readAccounts();
    if (result?.error) {
        reportAccountsError(`Failed to load accounts: ${result.error}`);
        return null;
    }

    if (!Array.isArray(result)) {
        reportAccountsError('Accounts data is in an unexpected format.');
        return null;
    }

    lastAccountsReadError = null;
    return result;
}

/**
 * Gets the selected client version from the UI.
 * @returns {string} The selected client version string.
 */
function getSelectedClientVersion() {
    const clientSelect = document.getElementById('client');
    return extractVersion(clientSelect.value);
}

/**
 * Handles the play button click event of Jagex account
 */
async function playButtonClickHandler() {
    await checkForOutdatedLaunch();
    const playBtn = document.getElementById('play');

    if (
        playBtn?.innerText.toLowerCase() ===
        'Play With Jagex Account'.toLowerCase()
    ) {
        await openClient();
    } else {
        playBtn?.classList.add('disabled');
        try {
            const authResult = await window.electron.startAuthFlow();
            if (authResult?.error) {
                window.electron.errorAlert(authResult.error);
            }
        } catch (err) {
            window.electron.errorAlert(err?.message || String(err));
        } finally {
            playBtn?.classList.remove('disabled');
        }
    }
}

/**
 * Helper function to update character select and trigger profile update
 * @param {string} accountId - The account ID to select
 * @param {{suppressRender?: boolean}} [options] - Optional flags
 * @returns {void}
 */
function updateCharacterSelection(accountId, options = {}) {
    const characterSelect = document.getElementById('character');
    if (characterSelect) {
        characterSelect.value = accountId;
        // Manually dispatch a change event to trigger the onChange handler
        const changeEvent = new Event('change');
        characterSelect.dispatchEvent(changeEvent);
    }

    if (!options?.suppressRender) {
        renderAccountsList();
    }
}

async function handleJagexAccountLogic(properties) {
    setInterval(async () => {
        const hasChanged = await window.electron.checkFileChange();
        if (hasChanged) {
            const oldNumberOfAccounts = accounts.length;
            const latestAccounts = await safeReadAccounts();
            if (!latestAccounts) {
                return;
            }
            accounts = latestAccounts;
            const newNumberOfAccounts = accounts.length;

            const selectedProfile = document.getElementById('profile')?.value;
            const selectedCharacter =
                document.getElementById('character')?.value;

            // If accounts were deleted externally, ensure UI is updated properly
            if (oldNumberOfAccounts > 0 && newNumberOfAccounts === 0) {
                window.electron.logError(
                    'All accounts were removed externally'
                );
                // Force UI update for removed accounts
                document.getElementById('play').innerHTML =
                    'Login Jagex Account';
            }

            await setupSidebarLayout(accounts.length);

            const orderedClientJars = await orderClientJarsByVersion();
            populateSelectElement('client', orderedClientJars);
            populateProfileSelector(
                await window.electron.listProfiles(),
                selectedProfile
            );
            await setVersionPreference(properties);

            if (newNumberOfAccounts === 0) {
                /**
                 * All accounts were removed
                 * Profile will be updated by setupSidebarLayout
                 * which calls populateAccountSelector with empty accounts
                 */
                await updateProfileBasedOnCharacter();
            } else if (oldNumberOfAccounts !== newNumberOfAccounts) {
                const latestAccount = accounts[0];
                if (latestAccount) {
                    updateCharacterSelection(latestAccount.accountId);
                }
            } else {
                // Check if the selectedCharacter still exists in the accounts array
                const characterExists = accounts.some(
                    (acc) => acc.accountId === selectedCharacter
                );
                if (characterExists) {
                    updateCharacterSelection(selectedCharacter);
                } else if (accounts.length > 0) {
                    // If character no longer exists but there are accounts, select the first one
                    window.electron.logError(
                        'Selected character no longer exists, selecting first available'
                    );
                    updateCharacterSelection(accounts[0].accountId);
                }
            }
        }
    }, 1000);
}

window.onerror = function myErrorHandler(errorMsg) {
    alert(`Error occurred: ${errorMsg}`);
    window.electron.logError(errorMsg);
    return false;
};
window.addEventListener('error', function (e) {
    if (e.error) {
        alert(`Error occurred: ${e.error.stack}`);
        window.electron.logError(e.error.stack);
    } else if (e.reason) {
        alert(`Error occurred: ${e.reason.stack}`);
        window.electron.logError(e.reason.stack);
    }
    return false;
});

window.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
    alert(`Error occurred: ${e.reason.stack}`);
    window.electron.logError(e.reason.stack);
});

async function initializeLauncher() {
    const properties = await window.electron.readProperties();

    const clientVersion = await window.electron.fetchClientVersion();

    const microbotLauncherVersion = await window.electron.launcherVersion();

    document.querySelector('.titlebar-title').innerText =
        'Microbot Launcher - ' + microbotLauncherVersion;

    if (properties['client'] === '0.0.0') {
        document.getElementById('loader-container').style.display = 'block';
        const result = await window.electron.downloadClient(clientVersion);
        if (result?.error) {
            window.electron.errorAlert(result.error);
            properties['client'] = '0.0.0';
        } else {
            properties['client'] = clientVersion;
        }
    }

    document.getElementById('loader-container').style.display = 'none';

    await window.electron.writeProperties(properties);

    const result = await window.electron.cleanUnusedClients(clientVersion);
    if (result?.error) {
        window.electron.logError(result.error);
    }

    /*
     * Whenever the profile select changes, we set the "preferred" profile on accounts.json
     * for the current selected account, if no jagex account is selected, we set on
     * the non-jagex-preferred-profile.json
     */
    document
        .getElementById('profile')
        .addEventListener('change', async (event) => {
            const selectedProfile = event.target.value;
            const selectedAccount = document.getElementById('character')?.value;
            if (selectedAccount && selectedAccount !== 'none') {
                await window.electron.setProfileJagexAccount(
                    selectedAccount,
                    selectedProfile
                );
            } else {
                await window.electron.setProfileNoJagexAccount(selectedProfile);
            }
        });

    /*
     * Whenever the character select changes, we attempt to set the "preferred" profile
     * for the selected account if it exists, otherwise we set the profile
     * to the default
     */
    document
        .getElementById('character')
        .addEventListener('change', async (event) => {
            const selectedAccount = event.target.value;
            const latestAccounts = await safeReadAccounts();
            if (latestAccounts) {
                accounts = latestAccounts;
            }
            const accountsData = latestAccounts ?? accounts;

            if (selectedAccount && selectedAccount !== 'none') {
                const account = accountsData.find(
                    (x) => x.accountId === selectedAccount
                );
                if (account) {
                    const profile = account.profile || 'default';
                    document.getElementById('profile').value = profile;
                }
            } else {
                // If no account is selected, set the profile to the preferred non-Jagex account profile
                // If no profile is set, default to "default"
                const nonJagexProfile =
                    await window.electron.readNonJagexProfile();
                const profile = nonJagexProfile || 'default';
                document.getElementById('profile').value = profile;
            }
        });

    //Init buttons and UI
    await initUI(properties);

    await checkForClientUpdate(properties);

    iii = setInterval(async () => {
        const properties = await window.electron.readProperties();
        await checkForClientUpdate(properties);
    }, 5 * 60 * 1000); // 5 minutes

    await handleJagexAccountLogic(properties);

    document.querySelectorAll('.loadingButton').forEach((button) => {
        button.addEventListener('click', startLoading);
    });

    loadLandingPageWebview();
}

window.addEventListener('load', async () => {
    setupAuthUI();
    await refreshAuthStatus();
});

function populateSelectElement(selectId, options) {
    const selectElement = document.getElementById(selectId);

    // Clear any existing options
    selectElement.innerHTML = '';

    // Add each option from the array to the select element
    options.forEach((optionText) => addSelectElement(selectId, optionText));
}

function addSelectElement(selectId, option) {
    // Get the select element by its ID
    const selectElement = document.getElementById(selectId);

    // Create a new option element
    const newOption = document.createElement('option');

    // Set the value and text of the new option
    newOption.value = option;
    newOption.text = option;

    // Add the new option to the select element
    selectElement.appendChild(newOption);
}

function populateProfileSelector(profiles = [], selectedProfile = null) {
    // Get the select element by its ID
    const profileSelect = document.getElementById('profile');

    // Clear any existing options (optional)
    profileSelect.innerHTML = '';

    // Create a default "default" option
    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = 'Default';
    profileSelect.appendChild(defaultOption);

    // Only try to populate if profiles are available and not empty
    if (Array.isArray(profiles) && profiles.length > 0) {
        profiles.forEach((profile) => {
            addSelectElement('profile', profile);
        });
    }

    if (selectedProfile) {
        profileSelect.value = selectedProfile;
    }
}

function populateAccountSelector(characters = [], selectedAccount = null) {
    // Get the select element by its ID
    const characterSelect = document.getElementById('character');

    // Clear any existing options (optional)
    characterSelect.innerHTML = '';

    // Create a default "none" option
    const defaultOption = document.createElement('option');
    defaultOption.value = 'none';
    defaultOption.textContent = 'None';
    characterSelect.appendChild(defaultOption);

    // Iterate over the characters array and create option elements
    characters.forEach((character) => {
        const option = document.createElement('option');
        option.value = character.accountId; // Set sessionId as the value
        option.textContent = character.displayName; // Set displayName as the text
        characterSelect.appendChild(option); // Add the option to the select element
    });

    if (selectedAccount) {
        updateCharacterSelection(selectedAccount, { suppressRender: true });
    }
}

function renderAccountsList() {
    const listContainer = document.getElementById(
        'accounts-dropdown-container'
    );
    if (!listContainer) {
        return;
    }

    listContainer.innerHTML = '';

    if (typeof cleanupAccountsDropdownListeners === 'function') {
        cleanupAccountsDropdownListeners();
        cleanupAccountsDropdownListeners = null;
    }

    if (!Array.isArray(accounts) || accounts.length === 0) {
        listContainer.style.display = 'none';
        return;
    }

    listContainer.style.display = 'block';

    const dropdown = document.createElement('div');
    dropdown.className = 'accounts-dropdown';

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'accounts-dropdown-toggle';
    toggleButton.setAttribute('aria-haspopup', 'listbox');
    toggleButton.setAttribute('aria-expanded', 'false');

    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'accounts-dropdown-label';

    const countBadge = document.createElement('span');
    countBadge.className = 'accounts-dropdown-count';
    countBadge.textContent = String(accounts.length);

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'accounts-dropdown-icon';
    toggleIcon.setAttribute('aria-hidden', 'true');
    toggleIcon.textContent = '▾';

    const characterSelect = document.getElementById('character');
    const initialSelectedValue = characterSelect?.value || 'none';
    let currentSelectedValue = initialSelectedValue;

    const getAccountLabel = (account) => {
        const label = account?.displayName?.trim();
        return label && label.length > 0 ? label : 'Not set';
    };

    const updateToggleLabel = (value) => {
        if (value === 'none') {
            toggleLabel.textContent = 'None';
            toggleButton.setAttribute('aria-label', 'No Jagex account selected');
            toggleButton.title = 'No Jagex account selected';
            return;
        }

        const matchingAccount = accounts.find(
            (account) => account.accountId === value
        );

        if (matchingAccount) {
            const label = getAccountLabel(matchingAccount);
            toggleLabel.textContent = label;
            toggleButton.setAttribute('aria-label', `Selected ${label}`);
            toggleButton.title = `Selected ${label}`;
        } else {
            toggleLabel.textContent = 'Select Jagex account';
            toggleButton.setAttribute('aria-label', 'Select a Jagex account');
            toggleButton.title = 'Select a Jagex account';
        }
    };

    updateToggleLabel(currentSelectedValue);

    toggleButton.append(toggleLabel, countBadge, toggleIcon);

    const panel = document.createElement('div');
    panel.className = 'accounts-dropdown-panel';
    panel.setAttribute('role', 'listbox');

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'accounts-search-wrapper';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'accounts-search-input';
    searchInput.placeholder = 'Search accounts…';
    searchInput.setAttribute('aria-label', 'Search saved accounts');

    searchWrapper.appendChild(searchInput);

    const optionsList = document.createElement('div');
    optionsList.className = 'accounts-options';

    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'accounts-options-empty';
    emptyMessage.textContent = 'No accounts match your search.';

    const closeDropdown = () => {
        dropdown.classList.remove('open');
        toggleButton.setAttribute('aria-expanded', 'false');
        searchInput.value = '';
    };

    const setSelectedAccount = (value) => {
        currentSelectedValue = value;
        updateToggleLabel(value);
        updateCharacterSelection(value, { suppressRender: true });
        closeDropdown();
        toggleButton.focus();
    };

    const createNoneOption = () => {
        const optionRow = document.createElement('div');
        optionRow.className = 'account-option';
        optionRow.setAttribute('role', 'option');
        if (currentSelectedValue === 'none') {
            optionRow.classList.add('selected');
            optionRow.setAttribute('aria-selected', 'true');
        } else {
            optionRow.setAttribute('aria-selected', 'false');
        }

        const nameButton = document.createElement('button');
        nameButton.type = 'button';
        nameButton.className = 'account-option-name';
        nameButton.textContent = 'None';
        nameButton.title = 'Use no Jagex account';
        nameButton.addEventListener('click', () => {
            setSelectedAccount('none');
        });

        optionRow.appendChild(nameButton);
        return optionRow;
    };

    const createAccountOption = (account) => {
        const optionRow = document.createElement('div');
        optionRow.className = 'account-option';
        optionRow.setAttribute('role', 'option');
        optionRow.dataset.accountId = account.accountId;

        if (account.accountId === currentSelectedValue) {
            optionRow.classList.add('selected');
            optionRow.setAttribute('aria-selected', 'true');
        } else {
            optionRow.setAttribute('aria-selected', 'false');
        }

        const label = getAccountLabel(account);

        const nameButton = document.createElement('button');
        nameButton.type = 'button';
        nameButton.className = 'account-option-name';
        nameButton.textContent = label;
        nameButton.title = `Select ${label}`;
        nameButton.addEventListener('click', () => {
            setSelectedAccount(account.accountId);
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'account-option-delete';
        deleteButton.dataset.accountId = account.accountId;
        deleteButton.title = `Delete ${label}`;
        deleteButton.setAttribute('aria-label', `Delete ${label}`);
        deleteButton.innerHTML = '<span aria-hidden="true">🗑️</span>';
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            closeDropdown();
            await handleAccountDelete(account.accountId);
        });

        optionRow.append(nameButton, deleteButton);
        return optionRow;
    };

    const renderOptions = (filterText = '') => {
        optionsList.innerHTML = '';
        const normalizedFilter = filterText.trim().toLowerCase();
        let visibleCount = 0;

        const shouldShowNone =
            normalizedFilter.length === 0 ||
            'none'.includes(normalizedFilter);

        if (shouldShowNone) {
            optionsList.appendChild(createNoneOption());
            visibleCount += 1;
        }

        accounts.forEach((account) => {
            const displayName = getAccountLabel(account).toLowerCase();
            if (
                normalizedFilter &&
                !displayName.includes(normalizedFilter)
            ) {
                return;
            }

            optionsList.appendChild(createAccountOption(account));
            visibleCount += 1;
        });

        if (visibleCount === 0) {
            optionsList.appendChild(emptyMessage.cloneNode(true));
        }
    };

    const openDropdown = () => {
        dropdown.classList.add('open');
        toggleButton.setAttribute('aria-expanded', 'true');
        renderOptions(searchInput.value);
        requestAnimationFrame(() => {
            searchInput.focus();
        });
    };

    toggleButton.addEventListener('click', () => {
        if (dropdown.classList.contains('open')) {
            closeDropdown();
        } else {
            openDropdown();
        }
    });

    searchInput.addEventListener('input', (event) => {
        renderOptions(event.target.value);
    });

    const handleOutsideClick = (event) => {
        if (!dropdown.contains(event.target)) {
            closeDropdown();
        }
    };

    const handleEscapeKey = (event) => {
        if (event.key === 'Escape') {
            if (dropdown.classList.contains('open')) {
                closeDropdown();
                toggleButton.focus();
            }
        }
    };

    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleEscapeKey);

    cleanupAccountsDropdownListeners = () => {
        document.removeEventListener('click', handleOutsideClick);
        document.removeEventListener('keydown', handleEscapeKey);
    };

    panel.append(searchWrapper, optionsList);
    dropdown.append(toggleButton, panel);
    listContainer.appendChild(dropdown);
}

async function handleAccountDelete(accountId) {
    if (!accountId) {
        return;
    }

    const account = accounts.find((acc) => acc.accountId === accountId);
    if (!account) {
        window.electron.errorAlert('Account not found.');
        return;
    }

    const confirmation = await window.electron.showConfirmationDialog(
        'Delete account?',
        'This will permanently remove this account. This action cannot be undone.',
        'Delete account?',
        'Cancel',
        'Delete',
        {
            defaultId: 0,
            cancelId: 0,
            confirmIndex: 1
        }
    );

    if (typeof confirmation !== 'boolean') {
        if (confirmation?.error) {
            window.electron.errorAlert(
                `Failed to confirm deletion: ${confirmation.error}`
            );
        }
        return;
    }

    if (!confirmation) {
        return;
    }

    const result = await window.electron.deleteAccount(accountId);
    if (result?.error) {
        window.electron.errorAlert(
            `Failed to delete account: ${result.error}`
        );
        return;
    }

    const updatedAccounts = await safeReadAccounts();
    if (!updatedAccounts) {
        return;
    }

    accounts = updatedAccounts;
    await setupSidebarLayout(accounts.length);
    await updateProfileBasedOnCharacter();
}

async function removeAccountsHandler() {
    const userConfirmed = confirm('Are you sure you want to proceed?');
    if (!userConfirmed) return;

    // Remove accounts via the Electron API
    await window.electron.removeAccounts();

    // Update the global accounts array
    accounts = [];

    // Reset UI to show no accounts state
    await setupSidebarLayout(0);

    // Update the profile to non-Jagex profile or default
    await updateProfileBasedOnCharacter();

    // Update the play button text
    document.getElementById('play').innerHTML = 'Login Jagex Account';
}

function setupLogoutButton() {
    const logoutBtn = document.getElementById('logout');
    logoutBtn?.removeEventListener('click', removeAccountsHandler);
    logoutBtn?.addEventListener('click', removeAccountsHandler);
}

async function setupSidebarLayout(amountOfAccounts) {
    const selectedAccount = document.getElementById('character')?.value;
    const playJagexButton = document.getElementById('play');
    const playButtonsDiv = document.querySelector('.play-buttons');
    const logoutButton = document.getElementById('logout');
    const addAccountsButton = document.getElementById('add-accounts');
    const characterSelectLabel = document.querySelector(
        'label[for="character"]'
    );
    const accountsDropdownContainer = document.getElementById(
        'accounts-dropdown-container'
    );

    if (amountOfAccounts > 0) {
        playJagexButton.innerHTML = 'Play With Jagex Account';
        logoutButton.style.display = 'block';
        playButtonsDiv.style.display = 'flex';
        if (characterSelectLabel) {
            characterSelectLabel.style.display = 'block';
        }
        if (accountsDropdownContainer) {
            accountsDropdownContainer.style.display = 'block';
        }
        addAccountsButton.style.display = 'block';
        populateAccountSelector(accounts, selectedAccount);
        const accountStillExists = accounts.some(
            (acc) => acc.accountId === selectedAccount
        );
        if (!accountStillExists) {
            if (accounts.length > 0) {
                updateCharacterSelection(accounts[0].accountId, {
                    suppressRender: true
                });
            } else {
                updateCharacterSelection('none', { suppressRender: true });
            }
        }
        // Note: populateAccountSelector uses updateCharacterSelection which
        // triggers the profile update via the change event
        setupLogoutButton();
        setupAddAccountsButton();
    } else {
        // Reset UI for no accounts state
        playJagexButton.innerHTML = 'Login Jagex Account';
        logoutButton.style.display = 'none';
        playButtonsDiv.style.display = 'block';
        if (characterSelectLabel) {
            characterSelectLabel.style.display = 'none';
        }
        if (accountsDropdownContainer) {
            accountsDropdownContainer.style.display = 'none';
        }
        addAccountsButton.style.display = 'none';

        // Clear character selector and make sure 'none' is selected
        populateAccountSelector([], 'none');

        // Also update the profile to use non-Jagex profile or default
        updateProfileBasedOnCharacter();
    }

    renderAccountsList();
}

async function addAccountsHandler() {
    const addAccountsButton = document.getElementById('add-accounts');
    addAccountsButton.classList.add('disabled');
    try {
        const authResult = await window.electron.startAuthFlow();
        if (authResult?.error) {
            window.electron.errorAlert(authResult.error);
        }
    } catch (err) {
        window.electron.errorAlert(err?.message || String(err));
    } finally {
        document.getElementById('add-accounts').classList.remove('disabled');
    }
}

function setupAddAccountsButton() {
    const addAccountsButton = document.getElementById('add-accounts');
    addAccountsButton?.removeEventListener('click', addAccountsHandler);
    addAccountsButton?.addEventListener('click', addAccountsHandler);
}

/**
 * Extracts the version number from a string.
 * e.g., "microbot-1.9.6.1.jar" becomes "1.9.6.1"
 * @param {string} versionString - The string containing the version.
 * @returns {string} The extracted version number.
 */
function extractVersion(versionString) {
    const s = String(versionString ?? '');
    return s.replace(/^microbot-/, '').replace(/\.jar$/, '');
}

/**
 * Setup play button for launching without Jagex account
 *
 * First checks for the attempt of launching an outdated version of the client.
 * If for some reason the client selected doesn't exist, it will trigger a download.
 */
function playNoJagexAccount() {
    const playNoJagexButton = document.getElementById('play-no-jagex-account');
    playNoJagexButton?.removeEventListener('click', playButtonClickHandler);
    playNoJagexButton?.addEventListener('click', async () => {
        await checkForOutdatedLaunch();

        const proxy = getProxyValues();
        const ramPreference = getClientRamPreference();
        const selectedVersion = document.getElementById('client').value;

        // Check if a valid client version is selected
        if (
            !selectedVersion ||
            selectedVersion === '' ||
            !selectedVersion.includes('microbot-')
        ) {
            window.electron.errorAlert('Please select a valid client version');
            return;
        }

        const version = extractVersion(selectedVersion);

        const selectedProfile =
            document.getElementById('profile').value || 'default';
        await window.electron.setProfileNoJagexAccount(selectedProfile);
        const result = await downloadClientIfNotExist(version);
        if (result?.exists) {
            try {
                const result = await window.electron.updateClientJarTTL(
                    version
                );
                if (result?.error) {
                    window.electron.logError(result.error);
                }
                const playResult = await window.electron.playNoJagexAccount(
                    version,
                    proxy,
                    ramPreference
                );
                if (playResult?.error) {
                    window.electron.errorAlert(playResult.error);
                }
            } catch (err) {
                window.electron.errorAlert(err?.message || String(err));
            }
        }
    });
}

/**
 * Checks if the client exists, and downloads it if it doesn't.
 *
 * @async
 * @param {*} version
 * @returns {Promise<{exists: boolean}>}
 */
async function downloadClientIfNotExist(version) {
    if (!(await window.electron.clientExists(version))) {
        window.electron.logError(
            `Client ${version} does not exist. Downloading...`
        );
        document.getElementById('loader-container').style.display = 'block';

        /** @type {{success: boolean, error?: string, path?: string}} */
        const result = await window.electron.downloadClient(version);
        if (result?.error) {
            window.electron.errorAlert(result.error);
            return { exists: false };
        }
    }
    window.electron.logError(`Client ${version} is ready.`);
    await populateAndSelectClientVersion(version);
    return { exists: true };
}

function updateNowBtn() {
    document
        .querySelector('#update-now-btn')
        .addEventListener('click', async () => {
            if (iii) clearInterval(iii);
            document.querySelector('#update-available').style = 'display:none';
            document.getElementById('loader-container').style.display = 'block';
            const clientVersion = await window.electron.fetchClientVersion();
            const result = await window.electron.downloadClient(clientVersion);
            if (result?.error) {
                window.electron.errorAlert(result.error);
                document.getElementById('loader-container').style.display =
                    'none';
                return;
            }

            await populateAndSelectClientVersion(clientVersion);

            // Update client field in properties to the latest version
            const properties = await window.electron.readProperties();
            properties['client'] = clientVersion;
            await window.electron.writeProperties(properties);

            document.getElementById('loader-container').style.display = 'none';
        });
}

/**
 * Populate and select client version
 *
 * @async
 * @param {string} version
 */
async function populateAndSelectClientVersion(version) {
    // Extract the version
    version = extractVersion(version);

    // Refresh client versions list after download
    const orderedClientJars = await orderClientJarsByVersion();
    populateSelectElement('client', orderedClientJars);

    // Set the newly downloaded version as the selected value
    await selectClientVersion(version);
}

/**
 * Select client version select element value
 *
 * @async
 * @param {string} version - The version to select (e.g. "1.9.9.1")
 */
async function selectClientVersion(version) {
    const clientSelect = document.getElementById('client');
    for (let i = 0; i < clientSelect.options.length; i++) {
        if (clientSelect.options[i].value.includes(version)) {
            clientSelect.selectedIndex = i;
            clientSelect.value = clientSelect.options[i].value;
            break;
        }
    }
    await updateVersionPreference({
        target: { value: version }
    });
}

function reminderMeLaterBtn() {
    document
        .querySelector('#remind-me-later-btn')
        .addEventListener('click', async () => {
            document.querySelector('#update-available').style = 'display:none';
        });
}

function getProxyValues() {
    // Get the value of the proxy IP
    return { proxyIp: document.getElementById('proxy-ip')?.value || '' };
}

function getClientRamPreference() {
    const ramSelect = document.getElementById('client-ram');
    if (!ramSelect) {
        return DEFAULT_CLIENT_RAM;
    }

    return sanitizeRamPreference(ramSelect.value);
}

function startLoading(event) {
    const button = event.target;
    button.classList.add('loading');

    setTimeout(() => {
        button.classList.remove('loading');
    }, 1000);
}

/**
 * Reads the current preferred version and selects it on the launcher UI.
 *
 * @async
 * @param {*} properties
 */
async function setVersionPreference(properties) {
    if (
        properties &&
        properties['version_pref'] &&
        properties['version_pref'] !== '0.0.0'
    ) {
        await selectClientVersion(properties['version_pref']);
    } else {
        await updateVersionPreference({
            target: { value: document.getElementById('client').value }
        });
    }

    /**
     * Remove any other listeners before adding a new one
     */
    const clientSelect = document.getElementById('client');
    clientSelect.replaceWith(clientSelect.cloneNode(true));

    document
        .getElementById('client')
        .addEventListener('change', async (event) => {
            await updateVersionPreference(event);
        });
}

async function updateVersionPreference(event) {
    const selectedValue = extractVersion(event.target.value);
    const properties = await window.electron.readProperties();
    properties['version_pref'] = selectedValue;
    await window.electron.writeProperties(properties);
}

async function titlebarButtons() {
    document.getElementById('minimize-btn').addEventListener('click', () => {
        window.electron.minimizeWindow();
    });

    document.getElementById('maximize-btn').addEventListener('click', () => {
        window.electron.maximizeWindow();
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        window.electron.closeLauncher();
    });
}

/**
 * Updates the profile selector based on the selected character or default settings
 *
 * @async
 * @returns {Promise<void>}
 */
async function updateProfileBasedOnCharacter() {
    const characterSelect = document.getElementById('character');
    const selectedAccountId = characterSelect?.value;
    const profileSelect = document.getElementById('profile');

    if (
        selectedAccountId &&
        selectedAccountId !== 'none' &&
        accounts.length > 0
    ) {
        const selectedAccount = accounts.find(
            (acc) => acc.accountId === selectedAccountId
        );
        if (selectedAccount && selectedAccount.profile) {
            profileSelect.value = selectedAccount.profile;
        } else {
            // If account exists but has no profile preference, use default
            profileSelect.value = 'default';
        }
    } else {
        // If no account is selected or no accounts exist, use the non-Jagex preferred profile
        const nonJagexProfile = await window.electron.readNonJagexProfile();
        if (nonJagexProfile) {
            profileSelect.value = nonJagexProfile;
        } else {
            // If no non-Jagex profile preference exists, use default
            profileSelect.value = 'default';
        }
    }
}

async function initUI(properties) {
    updateNowBtn();
    reminderMeLaterBtn();
    titlebarButtons();
    setupHamburgerMenu();

    // Setup play button for non-Jagex accounts
    playNoJagexAccount();

    // Setup play button for Jagex accounts
    const playJagexButton = document.getElementById('play');
    playJagexButton?.removeEventListener('click', playButtonClickHandler);
    playJagexButton?.addEventListener('click', playButtonClickHandler);

    const accountsData = await safeReadAccounts();
    accounts = accountsData ?? [];
    await setupSidebarLayout(accounts.length);

    const orderedClientJars = await orderClientJarsByVersion();
    populateSelectElement('client', orderedClientJars);

    // Get profiles and initialize profile selector
    const profiles = await window.electron.listProfiles();
    populateProfileSelector(profiles, null);

    // Update the profile based on the selected character
    await updateProfileBasedOnCharacter();

    await setVersionPreference(properties);
    document.querySelector('.game-info').style = 'display:block';

    await setupRamInput();
    await setupProxyInput();
}

/**
 * Setup the hamburger menu for the app.
 * Has some functional behavior for showing and hiding the menu
 * depending on user interaction.
 * @returns {void}
 */
function setupHamburgerMenu() {
    const menuBtn = document.getElementById('menu-btn');
    const menu = document.getElementById('app-menu');
    if (!menuBtn || !menu) return;

    const hideMenu = () => {
        if (!menu.classList.contains('hidden')) {
            menu.classList.add('hidden');
            menu.setAttribute('aria-hidden', 'true');
            menu.classList.remove('closing');
        }
    };

    const showMenu = () => {
        menu.classList.remove('hidden');
        menu.setAttribute('aria-hidden', 'false');
    };

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.classList.contains('hidden')) showMenu();
        else hideMenu();
    });

    // if clicked outside we hide the menu
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && e.target !== menuBtn) {
            hideMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideMenu();
    });

    menu.querySelectorAll('.submenu-item').forEach((item) => {
        item.addEventListener('click', async (e) => {
            const key = item.getAttribute('data-location');
            if (key) {
                const res = await window.electron.openLocation(key);
                if (res?.error) {
                    window.electron.errorAlert(res.error);
                }
            }
            hideMenu();
        });
    });

    let hideTimeout = null;
    const scheduleHide = () => {
        hideTimeout = setTimeout(() => hideMenu(), 200);
    };
    const cancelHide = () => {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
    };

    menu.addEventListener('pointerleave', () => {
        // Mark as closing to keep submenu visible until root hides
        if (!menu.classList.contains('closing')) menu.classList.add('closing');
        scheduleHide();
    });
    menu.addEventListener('pointerenter', () => {
        cancelHide();
        menu.classList.remove('closing');
    });
}

/**
 * Check for client updates and prompt the user if necessary.
 *
 * @async
 * @param {MicrobotProperties} properties - The properties object containing client information.
 */
async function checkForClientUpdate(properties) {
    const clientVersion = await window.electron.fetchClientVersion();
    window.electron.logError(
        `Current client version: ${clientVersion}, properties client version: ${properties['client']}`
    );

    /** @type {Array<string>} List of available client jars in the Microbot directory. */
    const listOfJars = await window.electron.listJars();

    if (listOfJars.length === 0) {
        window.electron.logError(
            'No client jars found. Please download a client.'
        );
    } else {
        window.electron.logError(
            `Available client jars: ${listOfJars.join(', ')}`
        );
    }
    if (
        await shouldPromptForClientDownload(
            clientVersion,
            listOfJars,
            properties
        )
    ) {
        document.querySelector('#update-available').style = 'display:flex';
    }
}

/**
 * Initialize the webview for the embedded site.
 * This webview will load the Microbot landing page and manipulate some elements
 * so it looks more integrated with the launcher.
 */
function loadLandingPageWebview() {
    const webview = document.getElementById('website');
    const webviewOverlay = document.getElementById('embed-overlay');
    if (webview) {
        webview.src = 'https://www.themicrobot.com?source=launcher';
        webview.addEventListener('dom-ready', () => {
            try {
                webview
                    .executeJavaScript(
                        `(() => {
                            try {
                                const topDiscordHeaderContainer = document.querySelector("body > header > div.c-events-block.py-2 > div");
                                if (topDiscordHeaderContainer) topDiscordHeaderContainer.remove();
                                const topSeparator = document.querySelector("body > header > div.c-border-red.mb-2");
                                if (topSeparator) topSeparator.remove();
                                const cookieBanner = document.getElementById("cookie-banner");
                                if (cookieBanner) cookieBanner.remove();
                                const navContainer = document.querySelector("body > header > nav > div");
                                if (navContainer) navContainer.style.maxWidth = "100%";
                                const bodyHero = document.querySelector("body > main > section.c-main-header.c-main-header--home.py-5.d-flex.flex-column.justify-content-center");
                                if (bodyHero) bodyHero.style.minHeight = "600px";
                            } catch (err) {
                                console.error('Webview DOM manipulation error:', err);
                            }
                            return true; // signal completion
                        })();`
                    )
                    .then(() => {
                        setTimeout(() => {
                            if (webviewOverlay) {
                                webviewOverlay.classList.add('hidden');
                                const removeAfter = () => {
                                    webviewOverlay?.removeEventListener(
                                        'transitionend',
                                        removeAfter
                                    );
                                };
                                webviewOverlay.addEventListener(
                                    'transitionend',
                                    removeAfter
                                );
                            }
                        }, 50);
                    })
                    .catch((err) =>
                        console.error('executeJavaScript failed', err)
                    );
            } catch (injectionError) {
                console.error('Failed to inject into webview:', injectionError);
                if (webviewOverlay) {
                    webviewOverlay.classList.add('hidden');
                }
            }
        });
    }
}

/**
 * Order the client jars by version from latest to oldest.
 *
 * @async
 * @returns {Promise<string[]>} A promise that resolves to the ordered list of client jar file names.
 */
async function orderClientJarsByVersion() {
    const clientJars = await window.electron.listJars();
    clientJars.sort((a, b) => {
        const versionA_match = a.match(/-([\d.]+)\.jar$/);
        const versionB_match = b.match(/-([\d.]+)\.jar$/);

        if (versionA_match && versionB_match) {
            const partsA = versionA_match[1].split('.').map(Number);
            const partsB = versionB_match[1].split('.').map(Number);

            for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
                const partA = partsA[i] || 0;
                const partB = partsB[i] || 0;
                if (partA !== partB) {
                    return partB - partA; // Sort descending
                }
            }
        }
        return 0;
    });
    return clientJars;
}

/**
 * Check if the latest client available is installed.
 * If not, make sure it's not written on properties file so it can be prompted
 * for re-download again.
 *
 * @async
 * @param {string} latestClientVersion - The version of the latest client available.
 * @param {Array<string>} installedClientVersions - The list of installed client versions.
 * @param {MicrobotProperties} properties - The properties object to update if necessary.
 * @returns {Promise<boolean>} True if the latest client is installed, false otherwise.
 */
async function shouldPromptForClientDownload(
    latestClientVersion,
    installedClientVersions,
    properties
) {
    const isLatestInstalled = installedClientVersions.some((file) =>
        file.includes(latestClientVersion)
    );
    const isClientVersionOnPropertiesLatest =
        properties['client'] === latestClientVersion;

    // Latest version is installed, set on properties if not already set
    if (isLatestInstalled) {
        if (!isClientVersionOnPropertiesLatest) {
            properties['client'] = latestClientVersion;
            await window.electron.writeProperties(properties);
        }
        return false;
    }

    /**
     * Latest version is not installed.
     * Properties file is out of sync (e.g., client JAR was deleted).
     * Correct the properties to the latest version actually installed.
     */
    if (isClientVersionOnPropertiesLatest) {
        const orderedClientJars = await orderClientJarsByVersion();
        if (orderedClientJars.length > 0) {
            properties['client'] = extractVersion(orderedClientJars[0]);
        } else {
            properties['client'] = '0.0.0';
        }
        await window.electron.writeProperties(properties);
    }

    // Latest is not installed, prompt for download.
    return true;
}

/**
 * Check if the selected client version is outdated compared to the latest version
 * available before launch.
 *
 * If it is outdated, prompt the user to either skip the latest version or
 * download/launch the latest version.
 *
 * @async
 */
async function checkForOutdatedLaunch() {
    const selectedVersion = extractVersion(
        document.getElementById('client').value
    );
    const latestVersion = extractVersion(
        await window.electron.fetchClientVersion()
    );

    window.electron.logError(
        `Selected version: ${selectedVersion}, Latest version: ${latestVersion}`
    );
    if (
        selectedVersion !== latestVersion &&
        latestVersion !== sessionStorage.getItem('skippedVersion')
    ) {
        // Show confirmation dialog
        // Proceed = Skip latest version
        const userWantsToProceed = await window.electron.showConfirmationDialog(
            'Do you want to proceed?',
            `You are about to launch an older version (${selectedVersion}).\r\rThe latest version is ${latestVersion}.`,
            'Outdated Version Warning',
            'Skip latest version',
            'Launch with the latest version'
        );
        window.electron.logError(`User chose: ${userWantsToProceed}`);

        if (userWantsToProceed) {
            // User chose to skip the latest version
            sessionStorage.setItem('skippedVersion', latestVersion);
        } else {
            // User chose to launch with the latest version, download if not exist
            await downloadClientIfNotExist(latestVersion);
        }
    }
}

/**
 * Check if there is a saved Proxy IP as a cookie and set it to the input field.
 * Also setup Proxy IP input field for change events so we can save to a cookie
 * and persist the value between sessions.
 */
async function setupRamInput() {
    const ramSelect = document.getElementById('client-ram');
    if (!ramSelect) {
        return;
    }

    const properties = await window.electron.readProperties();
    const savedPreference = sanitizeRamPreference(properties['client_ram']);

    if (savedPreference !== properties['client_ram']) {
        properties['client_ram'] = savedPreference;
        await window.electron.writeProperties(properties);
    }

    ensureRamOption(ramSelect, savedPreference);

    const persistPreference = async (rawValue) => {
        const normalized = sanitizeRamPreference(rawValue);
        ensureRamOption(ramSelect, normalized);

        const latestProperties = await window.electron.readProperties();
        if (latestProperties['client_ram'] !== normalized) {
            latestProperties['client_ram'] = normalized;
            await window.electron.writeProperties(latestProperties);
        }
    };

    ramSelect.addEventListener('change', async (event) => {
        await persistPreference(event.target.value);
    });

    ramSelect.addEventListener('blur', async (event) => {
        await persistPreference(event.target.value);
    });
}

async function setupProxyInput() {
    const proxyInput = document.getElementById('proxy-ip');
    if (!proxyInput) {
        return;
    }

    const properties = await window.electron.readProperties();
    const savedProxy = properties['proxyip'];
    if (savedProxy && savedProxy !== '') {
        proxyInput.value = savedProxy;
    }

    proxyInput.addEventListener('input', async (event) => {
        const value = event.target.value;
        const properties = await window.electron.readProperties();
        properties['proxyip'] = value;
        await window.electron.writeProperties(properties);
    });

    proxyInput.addEventListener('blur', async (event) => {
        const value = event.target.value;
        const properties = await window.electron.readProperties();
        properties['proxyip'] = value;
        await window.electron.writeProperties(properties);
    });
}

function sanitizeRamPreference(value) {
    if (!value || typeof value !== 'string') {
        return DEFAULT_CLIENT_RAM;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === '') {
        return DEFAULT_CLIENT_RAM;
    }

    const match = normalized.match(/^(\d+(?:\.\d+)?)([mg])$/);
    if (!match) {
        return DEFAULT_CLIENT_RAM;
    }

    const amount = match[1];
    const unit = match[2];
    return `${amount}${unit}`;
}

function ensureRamOption(selectElement, value) {
    if (!selectElement) {
        return;
    }

    const options = Array.from(selectElement.options || []);
    if (!options.some((option) => option.value === value)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = formatRamLabel(value);
        option.dataset.custom = 'true';
        selectElement.appendChild(option);
    }

    selectElement.value = value;
}

function formatRamLabel(value) {
    if (typeof value !== 'string') {
        return value;
    }

    const match = value.match(/^(\d+(?:\.\d+)?)([mg])$/i);
    if (!match) {
        return value;
    }

    const [, amount, unit] = match;
    const unitLabel = unit.toLowerCase() === 'g' ? 'GB' : 'MB';
    return `${amount} ${unitLabel}`;
}
