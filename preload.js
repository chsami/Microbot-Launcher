const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    downloadMicrobotLauncher: () =>
        ipcRenderer.invoke('download-microbot-launcher'),
    downloadClient: (version) => ipcRenderer.invoke('download-client', version),
    downloadLauncherHtml: () => ipcRenderer.invoke('download-client'),
    readProperties: () => ipcRenderer.invoke('read-properties'),
    writeProperties: (data) => ipcRenderer.invoke('write-properties', data),
    fetchLauncherVersion: () => ipcRenderer.invoke('fetch-launcher-version'), //jagex launcher
    fetchClientVersion: () => ipcRenderer.invoke('fetch-client-version'),
    fetchLauncherHtmlVersion: () =>
        ipcRenderer.invoke('fetch-launcher-html-version'),
    openClient: (version, proxy) =>
        ipcRenderer.invoke('open-client', version, proxy),
    readAccounts: () => ipcRenderer.invoke('read-accounts'),
    removeAccounts: () => ipcRenderer.invoke('remove-accounts'),
    clientExists: (version) => ipcRenderer.invoke('client-exists', version),
    launcherExists: () => ipcRenderer.invoke('launcher-exists'),
    overwriteCredentialProperties: (character) =>
        ipcRenderer.invoke('overwrite-credential-properties', character),
    checkFileChange: () => ipcRenderer.invoke('check-file-change'),
    playNoJagexAccount: (version, proxy) =>
        ipcRenderer.invoke('play-no-jagex-account', version, proxy),
    listJars: () => ipcRenderer.invoke('list-jars'),
    launcherVersion: () => ipcRenderer.invoke('launcher-version'),
    logError: (message) => ipcRenderer.invoke('log-error', message),
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        receive: (channel, func) =>
            ipcRenderer.on(channel, (event, ...args) => func(event, ...args)),
        invoke: (channel, data) => ipcRenderer.invoke(channel, data)
    }
});
