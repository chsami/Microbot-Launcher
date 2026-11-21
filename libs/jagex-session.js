const { toProxyUri, startLoginProxy } = require('./login-proxy.js');

const EXPIRED_STATUSES = [401, 403];

async function refreshSession({ writeAccountsToFile, log }, sessionId, proxyIp) {
    const proxyUri = toProxyUri(proxyIp);
    if (!proxyUri) return writeAccountsToFile(sessionId);
    let loginProxy;
    try {
        loginProxy = await startLoginProxy(proxyUri);
    } catch (error) {
        log.error(`Could not start the proxy for a Jagex session: ${error.message}`);
        return { ok: false, error: error.message };
    }
    try {
        return await writeAccountsToFile(sessionId, loginProxy.httpOptions);
    } finally {
        await loginProxy.close();
    }
}

function sessionExpired(result) {
    return EXPIRED_STATUSES.includes(result?.status);
}

module.exports = { refreshSession, sessionExpired };
