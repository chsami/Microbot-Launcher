const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    closeLauncher: () => ipcRenderer.invoke('close-launcher'),
    minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
    maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
    startAuthFlow: () => ipcRenderer.invoke('start-auth-flow'),
    downloadAndExtractBrowser: () =>
        ipcRenderer.invoke('download-and-extract-browser'),
    isBrowserDownloaded: () => ipcRenderer.invoke('is-browser-downloaded'),
    downloadMicrobotLauncher: () =>
        ipcRenderer.invoke('download-microbot-launcher'),
    downloadClient: (version) => ipcRenderer.invoke('download-client', version),
    readProperties: () => ipcRenderer.invoke('read-properties'),
    writeProperties: (data) => ipcRenderer.invoke('write-properties', data),
    fetchLauncherVersion: () => ipcRenderer.invoke('fetch-launcher-version'), //jagex launcher
    fetchClientVersion: () => ipcRenderer.invoke('fetch-client-version'),
    openLauncher: () => ipcRenderer.invoke('open-launcher'),
    openClient: (version, proxy, account) =>
        ipcRenderer.invoke('open-client', version, proxy, account),
    readAccounts: () => ipcRenderer.invoke('read-accounts'),
    removeAccounts: () => ipcRenderer.invoke('remove-accounts'),
    setProfileJagexAccount: (account, profile) =>
        ipcRenderer.invoke('set-profile-jagex', account, profile),
    setProfileNoJagexAccount: (profile) =>
        ipcRenderer.invoke('set-profile-no-jagex', profile),
    readNonJagexProfile: () => ipcRenderer.invoke('read-non-jagex-profile'),
    clientExists: (version) => ipcRenderer.invoke('client-exists', version),
    launcherExists: () => ipcRenderer.invoke('launcher-exists'),
    overwriteCredentialProperties: (character) =>
        ipcRenderer.invoke('overwrite-credential-properties', character),
    checkFileChange: () => ipcRenderer.invoke('check-file-change'),
    playNoJagexAccount: (version, proxy) =>
        ipcRenderer.invoke('play-no-jagex-account', version, proxy),
    listJars: () => ipcRenderer.invoke('list-jars'),
    listProfiles: () => ipcRenderer.invoke('list-profiles'),
    launcherVersion: () => ipcRenderer.invoke('launcher-version'),
    logError: (message) => ipcRenderer.invoke('log-error', message),
    errorAlert: (options) => ipcRenderer.invoke('error-alert', options),
    showConfirmationDialog: (message, detail, title, yesButton, noButton) =>
        ipcRenderer.invoke(
            'show-confirmation-dialog',
            message,
            detail,
            title,
            yesButton,
            noButton
        ),
    openLocation: (locationKey) =>
        ipcRenderer.invoke('open-location', locationKey),
    cleanUnusedClients: (latestVersion) =>
        ipcRenderer.invoke('cleanup-unused-clients-jar', latestVersion),
    updateClientJarTTL: (version) =>
        ipcRenderer.invoke('update-client-jar-ttl', version),
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        receive: (channel, func) =>
            ipcRenderer.on(channel, (event, ...args) => func(event, ...args)),
        invoke: (channel, data) => ipcRenderer.invoke(channel, data)
    }
});
