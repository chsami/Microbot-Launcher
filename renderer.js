let accounts = []
let iii = null

async function openLauncher() {

    if (!await window.electron.jcefExists()) {
        document.getElementById('loader-container').style.display = 'block';
        await window.electron.downloadJcef()
    }

    if (!await window.electron.launcherExists()) {
        document.getElementById('loader-container').style.display = 'block';
        await window.electron.downloadMicrobotLauncher()
    }

    document.getElementById('loader-container').style.display = 'none';
    console.log("fire!")
    await window.electron.openLauncher()
}

async function openClient(version) {
    if (!await window.electron.clientExists()) {
        document.getElementById('loader-container').style.display = 'block';
        await window.electron.downloadClient(version)
    }

    const proxy = getProxyValues()

    document.getElementById('loader-container').style.display = 'none';

    // Get the select element by its ID
    const selectElement = document.getElementById('character');

    // Get the selected value
    const selectedValue = selectElement.value;

    const selectedAccount = accounts?.find(x => x.accountId === selectedValue)
    if (selectedAccount) {
        await window.electron.overwriteCredentialProperties(selectedAccount)
        await window.electron.openClient(version, proxy)
    } else {
        alert('Account not found. Please restart your client.')
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

async function handleJagexAccountLogic(clientVersion) {
    setInterval(async () => {
        const hasChanged = await window.electron.checkFileChange()
        console.log(hasChanged)
        if (hasChanged) {
            document.getElementById(('play')).innerHTML = 'Play With Jagex Account'
            document.getElementById(('logout')).style.display = 'block'
            document.getElementById(('add-accounts')).style.display = 'block'
            accounts = await window.electron.readAccounts()
            populateAccountSelector(accounts)
            logoutButton()
            addAccountsButton()
            accounts = await window.electron.readAccounts()
            populateAccountSelector(accounts)
            populateSelectElement('client', [clientVersion])
            document.getElementById(('logout')).style.display = 'block'
            document.getElementById(('add-accounts')).style.display = 'block'
        }
    }, 1000)
}

window.addEventListener('load', async () => {

    const properties = await window.electron.readProperties()

    const launcherVersion = await window.electron.fetchLauncherVersion()
    const clientVersion = await window.electron.fetchClientVersion()
    const launcherHtmlVersion = await window.electron.fetchLauncherHtmlVersion()


    if (properties['launcher'] !== launcherVersion) {
        document.getElementById('loader-container').style.display = 'block';
        if (!await window.electron.jcefExists()) {
            await window.electron.downloadJcef()
        }
        properties['launcher'] = launcherVersion
        await window.electron.downloadMicrobotLauncher()
    }

    if (properties['client'] === '0.0.0') {
        document.getElementById('loader-container').style.display = 'block';
        properties['client'] = clientVersion
        await window.electron.downloadClient(clientVersion)
    }

    if (properties['launcher_html'] !== launcherHtmlVersion) {
        document.getElementById('loader-container').style.display = 'block';
        properties['launcher_html'] = launcherHtmlVersion
        await window.electron.downloadLauncherHtml()
    }

    document.getElementById('loader-container').style.display = 'none';

    await window.electron.writeProperties(properties)

    document.getElementById('play').addEventListener('click', async () => {
        if (document.getElementById('play')?.innerText.toLowerCase() === 'Play With Jagex Account'.toLowerCase()) {
            const proxy = getProxyValues()
            const selectedVersion = document.getElementById('client').value
            await openClient(selectedVersion, proxy)
        } else {
            await openLauncher()
        }
    })

    //Init buttons and UI
    await initUI(properties)

    await checkForClientUpdate(properties)

    iii = setInterval(async () => {
        const properties = await window.electron.readProperties()
        await checkForClientUpdate(properties)
    }, 5 * 60 * 1000); // 5 minutes

    await handleJagexAccountLogic(clientVersion);

    document.querySelectorAll('.loadingButton').forEach(button => {
        button.addEventListener('click', startLoading);
    });

    document.getElementById('website').src = "https://www.themicrobot.com?source=launcher"
});


function populateSelectElement(selectId, options) {
    const selectElement = document.getElementById(selectId);

    // Clear any existing options
    selectElement.innerHTML = '';

    // Add each option from the array to the select element
    options.forEach(optionText => {
        const optionElement = document.createElement('option');
        optionElement.value = optionText;
        optionElement.textContent = optionText;
        selectElement.appendChild(optionElement);
    });
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


function populateAccountSelector(characters = []) {
    // Get the select element by its ID
    const characterSelect = document.getElementById('character');

// Clear any existing options (optional)
    characterSelect.innerHTML = "";

// Iterate over the characters array and create option elements
    characters.forEach(character => {
        const option = document.createElement('option');
        option.value = character.accountId; // Set sessionId as the value
        option.textContent = character.displayName; // Set displayName as the text
        characterSelect.appendChild(option); // Add the option to the select element
    });
}

function logoutButton() {
    const logoutBtn = document.getElementById('logout');
    logoutBtn?.addEventListener('click', async () => {
        const userConfirmed = confirm("Are you sure you want to proceed?");
        if (!userConfirmed) return
        await window.electron.removeAccounts()
        document.getElementById(('play')).innerHTML = 'Login Jagex Account'
        document.querySelector('#add-accounts').style = 'display:none'
        document.querySelector('#logout').style = 'display:none'
        accounts = []
        populateAccountSelector([])
    })
}

function addAccountsButton() {
    const addAccounts = document.getElementById('add-accounts');
    addAccounts?.addEventListener('click', async () => {
        await openLauncher()
    })
}

function playNoJagexAccount() {
    document.querySelector('#play-no-jagex-account').addEventListener('click', async () => {
        const proxy = getProxyValues()
        const selectedVersion = document.getElementById('client').value
        await window.electron.playNoJagexAccount(selectedVersion, proxy)
    })
}

function updateNowBtn() {
    document.querySelector('#update-now-btn').addEventListener('click', async () => {
        if (iii) clearInterval(iii)
        document.querySelector('#update-available').style = 'display:none'
        document.getElementById('loader-container').style.display = 'block';
        const clientVersion = await window.electron.fetchClientVersion()
        await window.electron.downloadClient(clientVersion)
        addSelectElement('client', ['microbot-' + clientVersion + '.jar'])
        const properties = await window.electron.readProperties()
        properties['client'] = clientVersion
        await window.electron.writeProperties(properties)
        document.getElementById('loader-container').style.display = 'none';
    })
}

function reminderMeLaterBtn() {
    document.querySelector('#remind-me-later-btn').addEventListener('click', async () => {
        document.querySelector('#update-available').style = 'display:none'
    })
}

function getProxyValues() {
    // Get the value of the proxy IP
    var proxyIp = document.getElementById('proxy-ip').value;

// Get the selected value of the proxy type
    var proxyType = document.getElementById('proxy-type').value;

    return {
        proxyIp,
        proxyType,
    }
}

function startLoading(event) {
    const button = event.target;
    button.classList.add('loading');

    setTimeout(() => {
        button.classList.remove('loading');
    }, 1000);
}

async function setVersionPreference(properties) {
    if (properties['version_pref'] && properties['version_pref'] !== '0.0.0') {
        document.getElementById('client').value = properties['version_pref']
    } else {
        properties['version_pref'] = document.getElementById('client').value
        await window.electron.writeProperties(properties)
    }
    document.getElementById('client').addEventListener('change', async (event) => {
        const selectedValue = event.target.value
        const properties = await window.electron.readProperties()
        properties['version_pref'] = selectedValue
        await window.electron.writeProperties(properties)
    })
}

async function initUI(properties) {
    updateNowBtn()
    reminderMeLaterBtn()
    playNoJagexAccount()
    const listOfJars = await window.electron.listJars()
    populateSelectElement('client', listOfJars)
    await setVersionPreference(properties)
    document.querySelector('.game-info').style = 'display:block'
}

async function checkForClientUpdate(properties) {
    const clientVersion = await window.electron.fetchClientVersion()
    const listOfJars = await window.electron.listJars()

    if (properties['client'] !== clientVersion && listOfJars.every(file => file.indexOf(clientVersion) < 0)) {
        document.querySelector('#update-available').style = 'display:block'
    } else if (properties['client'] !== clientVersion) {
        properties['client'] = clientVersion
        await window.electron.writeProperties(properties)
    }
}