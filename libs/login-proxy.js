const { Server } = require('proxy-chain');
const { HttpsProxyAgent } = require('https-proxy-agent');

const DEFAULT_SCHEME = 'socks5';

function toProxyUri(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    raw = raw.trim();
    if (raw.includes('://')) return raw;

    const parts = raw.split(':');
    if (parts.length === 2) {
        const [host, port] = parts;
        return `${DEFAULT_SCHEME}://${host}:${port}`;
    }
    if (parts.length >= 4) {
        const [host, port, user] = parts;
        const pass = parts.slice(3).join(':');
        return `${DEFAULT_SCHEME}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
    }
    return `${DEFAULT_SCHEME}://${raw}`;
}

async function startLoginProxy(proxyUri) {
    const server = new Server({
        host: '127.0.0.1',
        port: 0,
        prepareRequestFunction: () => ({ upstreamProxyUrl: proxyUri })
    });
    await server.listen();
    const url = `http://127.0.0.1:${server.port}`;
    const agent = new HttpsProxyAgent(url);
    return {
        url,
        httpOptions: { httpAgent: agent, httpsAgent: agent, proxy: false },
        close: () => server.close(true)
    };
}

module.exports = { toProxyUri, startLoginProxy };
