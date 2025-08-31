let accounts = [];
let iii = null;

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
    await downloadClientIfNotExist(version);

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
        await window.electron.overwriteCredentialProperties(selectedAccount);
        await window.electron.openClient(version, proxy, selectedAccount);
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
 * Prompts the user to update if the selected version is outdated.
 * @param {string} selectedVersion
 * @param {string} latestVersion
 * @returns {Promise<boolean>} True if user wants to update, false otherwise.
 */
async function promptUserToUpdate(selectedVersion, latestVersion) {
    return confirm(
        `A newer client version (${latestVersion}) is available.\nYou are about to launch version ${selectedVersion}.\nDo you want to download and use the latest version?`
    );
}

/**
 * Downloads the latest client version and updates the UI and properties.
 * @param {string} latestVersion
 */
async function downloadAndSwitchToLatestVersion(latestVersion) {
    document.getElementById('loader-container').style.display = 'block';
    await window.electron.downloadClient(latestVersion);
    // Refresh client versions list after download and set to the latest one
    const orderedClientJars = await orderClientJarsByVersion();
    populateSelectElement('client', orderedClientJars);
    document.getElementById('client').value = orderedClientJars[0];
    // Update version preference
    const properties = await window.electron.readProperties();
    properties['version_pref'] = orderedClientJars[0];
    properties['client'] = latestVersion;
    await window.electron.writeProperties(properties);
    document.getElementById('loader-container').style.display = 'none';
}

async function playButtonClickHandler(event) {
    await checkForOutdatedLaunch();

    const selectedVersion = getSelectedClientVersion();
    const latestVersion = await fetchLatestClientVersionFromApi();
    if (latestVersion && selectedVersion !== latestVersion) {
        const userWantsUpdate = await promptUserToUpdate(selectedVersion, latestVersion);
        if (userWantsUpdate) {
            await downloadAndSwitchToLatestVersion(latestVersion);
            return; // Stop further execution, user should click play again
        }
    }

    if (event.target.id === 'play') {
        if (
            document.getElementById('play')?.innerText.toLowerCase() ===
            'Play With Jagex Account'.toLowerCase()
        ) {
            await openClient();
        } else {
            document.getElementById('play').classList.add('disabled');
            const result = await window.electron.startAuthFlow();
            if (result.error) {
                window.electron.errorAlert(result.error);
            }
            document.getElementById('play').classList.remove('disabled');
        }
    } else if (event.target.id === 'play-no-jagex-account') {
        await playNoJagexAccount();
        document
            .getElementById('play-no-jagex-account')
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

    const launcherVersion = await window.electron.fetchLauncherVersion(); // jagex launcher version
    const clientVersion = await window.electron.fetchClientVersion();

    const microbotLauncherVersion = await window.electron.launcherVersion();

    document.querySelector('.titlebar-title').innerText =
        'Microbot Launcher - ' + microbotLauncherVersion;

    if (properties['launcher'] !== launcherVersion) {
        document.getElementById('loader-container').style.display = 'block';

        properties['launcher'] = launcherVersion;
        await window.electron.downloadMicrobotLauncher();
    }

    if (properties['client'] === '0.0.0') {
        document.getElementById('loader-container').style.display = 'block';
        properties['client'] = clientVersion;
        await window.electron.downloadClient(clientVersion);
    }

    document.getElementById('loader-container').style.display = 'none';

    await window.electron.writeProperties(properties);

    const playJagexButton = document.getElementById('play');
    playJagexButton?.removeEventListener('click', playButtonClickHandler);
    playJagexButton?.addEventListener('click', playButtonClickHandler);
    const playButton = document.getElementById('play-no-jagex-account');
    playButton?.removeEventListener('click', playButtonClickHandler);
    playButton?.addEventListener('click', playButtonClickHandler);

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
    const result = await window.electron.startAuthFlow();
    if (result.error) {
        window.electron.errorAlert(result.error);
    }
    document.getElementById('add-accounts').classList.remove('disabled');
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
    return versionString.replace(/^microbot-/, '').replace(/\.jar$/, '');
}

function playNoJagexAccount() {
    document
        .querySelector('#play-no-jagex-account')
        .addEventListener('click', async () => {
            await checkForOutdatedLaunch();

            const proxy = getProxyValues();
            const selectedVersion = document.getElementById('client').value;

            // Check if a valid client version is selected
            if (
                !selectedVersion ||
                selectedVersion === '' ||
                !selectedVersion.includes('microbot-')
            ) {
                window.electron.errorAlert(
                    'Please select a valid client version'
                );
                return;
            }

            const version = extractVersion(selectedVersion);

            const selectedProfile =
                document.getElementById('profile').value || 'default';
            await window.electron.setProfileNoJagexAccount(selectedProfile);

            await downloadClientIfNotExist(version);
            await window.electron.playNoJagexAccount(version, proxy);
        });
}

async function downloadClientIfNotExist(version) {
    if (!(await window.electron.clientExists(version))) {
        window.electron.logError(
            `Client ${version} does not exist. Downloading...`
        );
        document.getElementById('loader-container').style.display = 'block';
        await window.electron.downloadClient(version);

        // Refresh client versions list after download
        const orderedClientJars = await orderClientJarsByVersion();
        populateSelectElement('client', orderedClientJars);

        // Set the newly downloaded version as the selected value
        const clientSelect = document.getElementById('client');
        for (let i = 0; i < clientSelect.options.length; i++) {
            if (clientSelect.options[i].value.includes(version)) {
                clientSelect.selectedIndex = i;
                break;
            }
        }
    }
    window.electron.logError(`Client ${version} is ready.`);
}

function updateNowBtn() {
    document
        .querySelector('#update-now-btn')
        .addEventListener('click', async () => {
            if (iii) clearInterval(iii);
            document.querySelector('#update-available').style = 'display:none';
            document.getElementById('loader-container').style.display = 'block';
            const clientVersion = await window.electron.fetchClientVersion();
            await window.electron.downloadClient(clientVersion);

            // Refresh client versions list after download and set to the latest one
            const orderedClientJars = await orderClientJarsByVersion();
            populateSelectElement('client', orderedClientJars);
            document.getElementById('client').value = orderedClientJars[0];

            // Manually trigger the version preference update after setting the value
            const properties = await window.electron.readProperties();
            properties['version_pref'] = orderedClientJars[0];
            properties['client'] = clientVersion;
            await window.electron.writeProperties(properties);

            document.getElementById('loader-container').style.display = 'none';
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
    var proxyIp = document.getElementById('proxy-ip').value;

    // Get the selected value of the proxy type
    var proxyType = document.getElementById('proxy-type').value;

    return {
        proxyIp,
        proxyType
    };
}

function startLoading(event) {
    const button = event.target;
    button.classList.add('loading');

    setTimeout(() => {
        button.classList.remove('loading');
    }, 1000);
}

async function setVersionPreference(properties) {
    if (
        properties &&
        properties['version_pref'] &&
        properties['version_pref'] !== '0.0.0'
    ) {
        document.getElementById('client').value = properties['version_pref'];
    } else {
        properties['version_pref'] = document.getElementById('client').value;
        await window.electron.writeProperties(properties);
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
    const selectedValue = event.target.value;
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
    playNoJagexAccount();
    titlebarButtons();
    setupHamburgerMenu();

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

async function checkForClientUpdate(properties) {
    const clientVersion = await window.electron.fetchClientVersion();
    window.electron.logError(
        `Current client version: ${clientVersion}, properties client version: ${properties['client']}`
    );
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
        properties['client'] !== clientVersion &&
        listOfJars.every((file) => file.indexOf(clientVersion) < 0)
    ) {
        document.querySelector('#update-available').style = 'display:flex';
    } else if (properties['client'] !== clientVersion) {
        properties['client'] = clientVersion;
        await window.electron.writeProperties(properties);
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
 * Check if the selected client version is outdated compared to the latest version
 * before launch.
 */
async function checkForOutdatedLaunch() {
    const selectedVersion = document.getElementById('client').value;
    const orderedClientJars = await orderClientJarsByVersion();
    const latestVersion = orderedClientJars[0];

    window.electron.logError(
        `Selected version: ${selectedVersion}, Latest version: ${latestVersion}`
    );
    if (
        selectedVersion !== latestVersion &&
        latestVersion !== localStorage.getItem('skippedVersion')
    ) {
        const userConfirmed = await window.electron.showConfirmationDialog(
            'Do you want to proceed?',
            `You are about to launch an older version (${extractVersion(
                selectedVersion
            )}).\r\rThe latest version is ${extractVersion(latestVersion)}.`,
            'Outdated Version Warning',
            'Skip latest version',
            'Launch with the latest version'
        );

        if (userConfirmed) {
            localStorage.setItem('skippedVersion', latestVersion);
        } else {
            document.getElementById('client').value = latestVersion;
            await updateVersionPreference({
                target: { value: latestVersion }
            });
        }
    }
}

/**
 * Fetches the latest client version from the remote API endpoint.
 * @returns {Promise<string>} The latest client version string.
 */
async function fetchLatestClientVersionFromApi() {
    try {
        const response = await fetch('https://microbot.cloud/api/version/client');
        if (!response.ok) throw new Error('Failed to fetch latest client version');
        const data = await response.text();
        return data.trim();
    } catch (err) {
        window.electron.logError('Error fetching latest client version: ' + err.message);
        // Exception is logged, no need to throw again
        return null;
    }
}
