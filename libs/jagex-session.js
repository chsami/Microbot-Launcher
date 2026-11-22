const { toProxyUri, startLoginProxy } = require('./login-proxy.js');

const EXPIRED_STATUSES = [401, 403];

async function refreshSession({ writeAccountsToFile, log }, sessionId, proxyIp, { timeoutMs } = {}) {
    const proxyUri = toProxyUri(proxyIp);
    const timeout = timeoutMs ? { timeout: timeoutMs } : null;
    if (!proxyUri) return timeout ? writeAccountsToFile(sessionId, timeout) : writeAccountsToFile(sessionId);
    let loginProxy;
    try {
        loginProxy = await startLoginProxy(proxyUri);
    } catch (error) {
        log.error(`Could not start the proxy for a Jagex session: ${error.message}`);
        return { ok: false, error: error.message };
    }
    try {
        return await writeAccountsToFile(sessionId, { ...loginProxy.httpOptions, ...timeout });
    } finally {
        await loginProxy.close();
    }
}

const ACCOUNTS_URL = 'https://auth.jagex.com/game-session/v1/accounts';

async function peekSession({ axios, log }, sessionId, proxyIp, { timeoutMs } = {}) {
    const proxyUri = toProxyUri(proxyIp);
    let loginProxy = null;
    try {
        if (proxyUri) loginProxy = await startLoginProxy(proxyUri);
        await axios.get(ACCOUNTS_URL, {
            ...(loginProxy ? loginProxy.httpOptions : {}),
            ...(timeoutMs ? { timeout: timeoutMs } : {}),
            headers: { Authorization: `Bearer ${sessionId}` }
        });
        return { ok: true };
    } catch (error) {
        log.warn(`Could not check a saved Jagex login: ${error?.response ? `status ${error.response.status}` : error?.code || 'no answer'}`);
        return { ok: false, status: error?.response?.status };
    } finally {
        if (loginProxy) await loginProxy.close();
    }
}

function sessionExpired(result) {
    return EXPIRED_STATUSES.includes(result?.status);
}

module.exports = { refreshSession, peekSession, sessionExpired };
