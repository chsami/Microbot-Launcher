let accounts = [];
let iii = null;

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
                selectedAccount
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
 * @returns {void}
 */
function updateCharacterSelection(accountId) {
    const characterSelect = document.getElementById('character');
    if (characterSelect) {
        characterSelect.value = accountId;
        // Manually dispatch a change event to trigger the onChange handler
        const changeEvent = new Event('change');
        characterSelect.dispatchEvent(changeEvent);
    }
}

async function handleJagexAccountLogic(properties) {
    setInterval(async () => {
        const hasChanged = await window.electron.checkFileChange();
        if (hasChanged) {
            const oldNumberOfAccounts = accounts.length;
            accounts = await window.electron.readAccounts();
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

window.addEventListener('load', async () => {
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
            const accounts = await window.electron.readAccounts();

            if (selectedAccount && selectedAccount !== 'none') {
                const account = accounts.find(
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
        updateCharacterSelection(selectedAccount);
    }
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
    const characterSelect = document.getElementById('character');
    const characterSelectLabel = document.querySelector(
        'label[for="character"]'
    );

    if (amountOfAccounts > 0) {
        playJagexButton.innerHTML = 'Play With Jagex Account';
        logoutButton.style.display = 'block';
        playButtonsDiv.style.display = 'flex';
        characterSelectLabel.style.display = 'block';
        characterSelect.style.display = 'block';
        addAccountsButton.style.display = 'block';
        populateAccountSelector(accounts, selectedAccount);
        // Note: populateAccountSelector uses updateCharacterSelection which
        // triggers the profile update via the change event
        setupLogoutButton();
        setupAddAccountsButton();
    } else {
        // Reset UI for no accounts state
        playJagexButton.innerHTML = 'Login Jagex Account';
        logoutButton.style.display = 'none';
        playButtonsDiv.style.display = 'block';
        characterSelectLabel.style.display = 'none';
        characterSelect.style.display = 'none';
        addAccountsButton.style.display = 'none';

        // Clear character selector and make sure 'none' is selected
        populateAccountSelector([], 'none');

        // Also update the profile to use non-Jagex profile or default
        updateProfileBasedOnCharacter();
    }
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
                    proxy
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

    const accounts = await window.electron.readAccounts();
    await setupSidebarLayout(accounts?.length || 0);

    const orderedClientJars = await orderClientJarsByVersion();
    populateSelectElement('client', orderedClientJars);

    // Get profiles and initialize profile selector
    const profiles = await window.electron.listProfiles();
    populateProfileSelector(profiles, null);

    // Update the profile based on the selected character
    await updateProfileBasedOnCharacter();

    await setVersionPreference(properties);
    document.querySelector('.game-info').style = 'display:block';

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
async function setupProxyInput() {
    const proxyInput = document.getElementById('proxy-ip');
    if (!proxyInput) {
        console.error('Proxy input element not found');
        return;
    }

    const properties = await window.electron.readProperties();
    const savedProxy = properties['proxyip'];
    if (savedProxy && savedProxy !== '') {
        console.log('Loaded saved proxy:', savedProxy);
        proxyInput.value = savedProxy;
    } else {
        console.log('No saved proxy found');
    }

    proxyInput.addEventListener('input', async (event) => {
        const value = event.target.value;
        const properties = await window.electron.readProperties();
        properties['proxyip'] = value;
        await window.electron.writeProperties(properties);
        console.log('Saved proxy on input:', value);
    });

    proxyInput.addEventListener('blur', async (event) => {
        const value = event.target.value;
        const properties = await window.electron.readProperties();
        properties['proxyip'] = value;
        await window.electron.writeProperties(properties);
        console.log('Saved proxy on blur:', value);
    });
}
