let accounts =  []

async  function openLauncher() {

    if (!await window.electron.jcefExists()) {
        document.getElementById('loader-container').style.display = 'block';
        await window.electron.downloadJcef()
    }

    if (!await window.electron.launcherExists()) {
        document.getElementById('loader-container').style.display = 'block';
        await window.electron.downloadMicrobotLauncher()
    }

    document.getElementById('loader-container').style.display = 'none';
    await window.electron.openLauncher()
}

async  function openClient(version) {
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

    const selectedAccount = accounts.find(x => x.accountId === selectedValue)
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

window.addEventListener('load', async (event) => {

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

    if (properties['client'] !== clientVersion) {
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
            await openClient(clientVersion)
        } else {
            await openLauncher()
        }
    })

    const ii = setInterval(async () => {
        const exists = await window.electron.accountsExists()
        if (exists) {
            document.getElementById(('play')).innerHTML = 'Play With Jagex Account'
            document.querySelector('.game-info').style = 'display:block'
            document.getElementById(('logout')).style.display = 'block'
            document.getElementById(('add-accounts')).style.display = 'block'
            accounts = await window.electron.readAccounts()
            populateAccountSelector(accounts)
            populateSelectElement('client', ['Microbot-' + clientVersion])
            logoutButton()
            playNoJagexAccount(clientVersion)
            addAccountsButton()
            clearInterval(ii)
            setInterval(async () => {
                const hasChanged = await window.electron.checkFileChange()
                if (hasChanged) {
                    accounts = await window.electron.readAccounts()
                    populateAccountSelector(accounts)
                    populateSelectElement('client', ['Microbot-' + clientVersion])
                }
            }, 1000)
        }
    }, 1000)

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
        document.getElementById(('play')).innerHTML = 'Login'
        document.querySelector('.game-info').style = 'display:none'
        document.querySelector('#logout').style = 'display:none'
    })
}

function addAccountsButton() {
    const logoutBtn = document.getElementById('add-accounts');
    logoutBtn?.addEventListener('click', async () => {
        await openLauncher()
    })
}

function playNoJagexAccount(version) {
    document.querySelector('#play-no-jagex-account').addEventListener('click', async () => {
        const proxy = getProxyValues()
        await window.electron.playNoJagexAccount(version, proxy)
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