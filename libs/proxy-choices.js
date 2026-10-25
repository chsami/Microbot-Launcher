const crypto = require('crypto');

const KEY_FILE = 'proxy-id-key';
const PROXY_URI_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/(?:(.*)@)?([^@/]+)\/?$/i;
const SUPPORTED_PROXY_SCHEMES = ['socks', 'socks5'];

function parseHostPort(value) {
    const match = value.match(/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d+)$/i);
    if (!match) return null;
    const port = Number(match[2]);
    if (port < 1 || port > 65535) return null;
    return { host: match[1], port };
}

function parseProxyEndpoint(address) {
    if (typeof address !== 'string') return null;
    const value = address.trim();
    if (value === '') return null;
    if (value.includes('://')) {
        const match = value.match(PROXY_URI_PATTERN);
        if (!match || !SUPPORTED_PROXY_SCHEMES.includes(match[1].toLowerCase())) return null;
        return parseHostPort(match[3]);
    }
    if (value.includes('@')) {
        if (value.split(':').length !== 3) return null;
        return parseHostPort(value.slice(value.lastIndexOf('@') + 1));
    }
    const parts = value.split(':');
    if (parts.length !== 2 && parts.length < 4) return null;
    return parseHostPort(`${parts[0]}:${parts[1]}`);
}

module.exports = function setupProxyChoices({ fs, path, microbotDir }) {
    let key = null;

    const loadKey = () => {
        if (key) return key;
        const file = path.join(microbotDir, KEY_FILE);
        if (fs.existsSync(file)) {
            const saved = fs.readFileSync(file, 'utf8').trim();
            if (/^[0-9a-f]{64}$/.test(saved)) {
                key = Buffer.from(saved, 'hex');
                return key;
            }
        }
        key = crypto.randomBytes(32);
        fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
        fs.chmodSync(file, 0o600);
        return key;
    };

    const idFor = (address) => crypto.createHmac('sha256', loadKey()).update(address.trim()).digest('base64url').slice(0, 22);

    const savedProxies = (properties, accounts) => {
        const proxies = [];
        const add = (name, address) => {
            const value = typeof address === 'string' ? address.trim() : '';
            if (!value || proxies.some((proxy) => proxy.address === value)) return;
            const endpoint = parseProxyEndpoint(value);
            if (!endpoint) return;
            const location = `${endpoint.host}:${endpoint.port}`;
            const label = typeof name === 'string' && name.trim() ? `${name.trim()} (${location})` : location;
            proxies.push({ address: value, label });
        };
        (Array.isArray(properties.proxies) ? properties.proxies : []).forEach((entry) => add(entry?.name, entry?.address));
        add('', properties.proxyip);
        accounts.forEach((account) => add('', account.proxyIp));
        return proxies.map((proxy) => ({ ...proxy, id: idFor(proxy.address) }));
    };

    return { savedProxies, idFor };
};

module.exports.parseProxyEndpoint = parseProxyEndpoint;
