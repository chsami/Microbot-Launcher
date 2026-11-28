const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    closeLauncher: () => ipcRenderer.invoke('close-launcher'),
    theme: {
        read: () => ipcRenderer.invoke('theme:read'),
        write: (value) => ipcRenderer.invoke('theme:write', value)
    },
    themes: {
        list: () => ipcRenderer.invoke('themes:list'),
        save: (theme, id) => ipcRenderer.invoke('themes:save', theme, id),
        remove: (id) => ipcRenderer.invoke('themes:delete', id),
        images: () => ipcRenderer.invoke('themes:images'),
        image: (name) => ipcRenderer.invoke('themes:image', name),
        exportFile: (id) => ipcRenderer.invoke('themes:export', id),
        openFolder: () => ipcRenderer.invoke('themes:open-folder'),
        openGuide: () => ipcRenderer.invoke('themes:open-guide')
    },
    minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
    maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
    startAuthFlow: (proxy) => ipcRenderer.invoke('start-auth-flow', proxy),
    cancelAuthFlow: () => ipcRenderer.invoke('cancel-auth-flow'),
    downloadMicrobotLauncher: () =>
        ipcRenderer.invoke('download-microbot-launcher'),
    downloadClient: (version) => ipcRenderer.invoke('download-client', version),
    prepareNightly: () => ipcRenderer.invoke('prepare-nightly'),
    nightlyStatus: (checkRemote) => ipcRenderer.invoke('nightly-status', checkRemote),
    readProperties: () => ipcRenderer.invoke('read-properties'),
    writeProperties: (data) => ipcRenderer.invoke('write-properties', data),
    fetchLauncherVersion: () => ipcRenderer.invoke('fetch-launcher-version'), //jagex launcher
    fetchClientVersion: () => ipcRenderer.invoke('fetch-client-version'),
    openLauncher: () => ipcRenderer.invoke('open-launcher'),
    openClient: (version, proxy, account, ramPreference, hwidSpoof) =>
        ipcRenderer.invoke(
            'open-client',
            version,
            proxy,
            account,
            ramPreference,
            hwidSpoof
        ),
    readAccounts: () => ipcRenderer.invoke('read-accounts'),
    deleteAccount: (accountId) =>
        ipcRenderer.invoke('delete-account', accountId),
    removeAccounts: () => ipcRenderer.invoke('remove-accounts'),
    setProfileJagexAccount: (account, profile) =>
        ipcRenderer.invoke('set-profile-jagex', account, profile),
    clientExists: (version) => ipcRenderer.invoke('client-exists', version),
    launcherExists: () => ipcRenderer.invoke('launcher-exists'),
    overwriteCredentialProperties: (character) =>
        ipcRenderer.invoke('overwrite-credential-properties', character),
    checkFileChange: () => ipcRenderer.invoke('check-file-change'),
    listJars: () => ipcRenderer.invoke('list-jars'),
    listClientJars: (latestVersion) =>
        ipcRenderer.invoke('list-client-jars', latestVersion),
    loadCustomClientJar: () => ipcRenderer.invoke('load-custom-client-jar'),
    removeCustomClientJar: (version) =>
        ipcRenderer.invoke('remove-custom-client-jar', version),
    listProfiles: () => ipcRenderer.invoke('list-profiles'),
    launcherVersion: () => ipcRenderer.invoke('launcher-version'),
    logError: (message) => ipcRenderer.invoke('log-error', message),
    errorAlert: (options) => ipcRenderer.invoke('error-alert', options),
    showConfirmationDialog: (
        message,
        detail,
        title,
        yesButton,
        noButton,
        options
    ) =>
        ipcRenderer.invoke(
            'show-confirmation-dialog',
            message,
            detail,
            title,
            yesButton,
            noButton,
            options
        ),
    openLocation: (locationKey) =>
        ipcRenderer.invoke('open-location', locationKey),
    openHelpLink: (linkKey) => ipcRenderer.invoke('open-help-link', linkKey),
    cleanUnusedClients: (latestVersion) =>
        ipcRenderer.invoke('cleanup-unused-clients-jar', latestVersion),
    updateClientJarTTL: (version) =>
        ipcRenderer.invoke('update-client-jar-ttl', version),
    refreshAccounts: (proxy) => ipcRenderer.invoke('refresh-accounts', proxy),
    auth: {
        signup: (credentials) => ipcRenderer.invoke('auth:signup', credentials),
        signin: (credentials) => ipcRenderer.invoke('auth:signin', credentials),
        signout: () => ipcRenderer.invoke('auth:signout'),
        changePassword: (payload) =>
            ipcRenderer.invoke('auth:changepw', payload),
        resendVerification: (payload) =>
            ipcRenderer.invoke('auth:resend-verification', payload),
        requestPasswordReset: (payload) =>
            ipcRenderer.invoke('auth:request-password-reset', payload),
        status: () => ipcRenderer.invoke('auth:status')
    },
    dashboard: {
        open: () => ipcRenderer.invoke('dashboard:open')
    },
    background: {
        status: () => ipcRenderer.invoke('background:status'),
        setEnabled: (enabled) => ipcRenderer.invoke('background:set-enabled', enabled)
    },
    remoteStart: {
        status: () => ipcRenderer.invoke('remote-start:status'),
        setEnabled: (enabled) => ipcRenderer.invoke('remote-start:set-enabled', enabled)
    },
    alerts: {
        accountStatus: (accountIds) => ipcRenderer.invoke('alerts:accounts', accountIds),
        setAccountEnabled: (accountId, enabled) =>
            ipcRenderer.invoke('alerts:set-account-enabled', accountId, enabled)
    },
    runeliteLoader: {
        state: () => ipcRenderer.invoke('runelite-loader:state'),
        install: () => ipcRenderer.invoke('runelite-loader:install'),
        remove: () => ipcRenderer.invoke('runelite-loader:remove'),
        setMode: (mode) => ipcRenderer.invoke('runelite-loader:set-mode', mode),
        open: () => ipcRenderer.invoke('runelite-loader:open'),
        find: () => ipcRenderer.invoke('runelite-loader:find'),
        characters: () => ipcRenderer.invoke('runelite-loader:characters'),
        setCharacter: (accountId) => ipcRenderer.invoke('runelite-loader:set-character', accountId),
        login: (accountId) => ipcRenderer.invoke('runelite-loader:login', accountId),
        onLaunchStatus: (func) => ipcRenderer.on('runelite-loader:launch-status', (event, data) => func(data)),
        onProgress: (func) => ipcRenderer.on('runelite-loader:progress', (event, data) => func(data))
    },
    sessionRecorder: {
        state: () => ipcRenderer.invoke('session-recorder:state'),
        setOn: (on) => ipcRenderer.invoke('session-recorder:set-on', on),
        open: () => ipcRenderer.invoke('session-recorder:open'),
        onStatus: (func) => ipcRenderer.on('session-recorder:status', (event, data) => func(data))
    },
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        receive: (channel, func) =>
            ipcRenderer.on(channel, (event, ...args) => func(event, ...args)),
        invoke: (channel, data) => ipcRenderer.invoke(channel, data)
    }
});
