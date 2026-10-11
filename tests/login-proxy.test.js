const net = require('net');
const http = require('http');
const axios = require('axios');
const { toProxyUri, startLoginProxy } = require('../libs/login-proxy.js');

function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function startSocks5Server({ user, pass }) {
    const seen = { auths: [], targets: [] };
    const server = net.createServer((client) => {
        client.once('data', (greeting) => {
            if (!greeting.includes(0x02)) {
                client.end(Buffer.from([0x05, 0xff]));
                return;
            }
            client.write(Buffer.from([0x05, 0x02]));
            client.once('data', (auth) => {
                const userLen = auth[1];
                const u = auth.subarray(2, 2 + userLen).toString();
                const passLen = auth[2 + userLen];
                const p = auth.subarray(3 + userLen, 3 + userLen + passLen).toString();
                seen.auths.push(`${u}:${p}`);
                if (u !== user || p !== pass) {
                    client.end(Buffer.from([0x01, 0x01]));
                    return;
                }
                client.write(Buffer.from([0x01, 0x00]));
                client.once('data', (req) => {
                    let host;
                    let offset;
                    if (req[3] === 0x01) {
                        host = Array.from(req.subarray(4, 8)).join('.');
                        offset = 8;
                    } else if (req[3] === 0x03) {
                        host = req.subarray(5, 5 + req[4]).toString();
                        offset = 5 + req[4];
                    } else {
                        client.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                        return;
                    }
                    const port = req.readUInt16BE(offset);
                    seen.targets.push(`${host}:${port}`);
                    const upstream = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
                        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                        client.pipe(upstream).pipe(client);
                    });
                    upstream.on('error', () => client.destroy());
                });
            });
        });
        client.on('error', () => {});
    });
    return { server, seen };
}

describe('toProxyUri', () => {
    test.each([
        ['', null],
        ['   ', null],
        [undefined, null],
        ['1.2.3.4:1080', 'socks5://1.2.3.4:1080'],
        ['1.2.3.4:1080:bob:hunter2', 'socks5://bob:hunter2@1.2.3.4:1080'],
        ['1.2.3.4:1080:bob:pa:ss@w', 'socks5://bob:pa%3Ass%40w@1.2.3.4:1080'],
        [' http://bob:pw@proxy:8080 ', 'http://bob:pw@proxy:8080'],
        ['1.2.3.4:1080:bob', 'socks5://1.2.3.4:1080:bob'],
        ['proxyhost', 'socks5://proxyhost']
    ])('%p -> %p', (input, expected) => {
        expect(toProxyUri(input)).toBe(expected);
    });
});

describe('startLoginProxy', () => {
    let target;
    let targetPort;
    let socks;
    let socksPort;
    let loginProxy;

    beforeEach(async () => {
        target = http.createServer((req, res) => res.end(`hello ${req.url}`));
        targetPort = await listen(target);
        socks = startSocks5Server({ user: 'bob', pass: 'pa:ss@w' });
        socksPort = await listen(socks.server);
    });

    afterEach(async () => {
        await loginProxy?.close();
        loginProxy = null;
        target.close();
        socks.server.close();
    });

    test('exposes a local proxy without a password that forwards to the SOCKS5 proxy with credentials', async () => {
        loginProxy = await startLoginProxy(toProxyUri(`127.0.0.1:${socksPort}:bob:pa:ss@w`));

        expect(loginProxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        const response = await axios.get(`http://localhost:${targetPort}/session`, loginProxy.httpOptions);

        expect(response.data).toBe('hello /session');
        expect(socks.seen.auths).toEqual(['bob:pa:ss@w']);
        expect(socks.seen.targets).toEqual([`localhost:${targetPort}`]);
    });

    test('fails the request when the SOCKS5 proxy rejects the credentials', async () => {
        loginProxy = await startLoginProxy(toProxyUri(`127.0.0.1:${socksPort}:bob:wrong`));

        await expect(
            axios.get(`http://localhost:${targetPort}/session`, loginProxy.httpOptions)
        ).rejects.toThrow();
        expect(socks.seen.auths).toEqual(['bob:wrong']);
    });

    test('resolves plain HTTP target hostnames at the SOCKS5 proxy instead of locally', async () => {
        loginProxy = await startLoginProxy(toProxyUri(`127.0.0.1:${socksPort}:bob:pa:ss@w`));
        const proxyUrl = new URL(loginProxy.url);

        const body = await new Promise((resolve, reject) => {
            http.get(
                {
                    host: proxyUrl.hostname,
                    port: proxyUrl.port,
                    path: `http://localhost:${targetPort}/plain`,
                    headers: { Host: `localhost:${targetPort}` }
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () => resolve(data));
                }
            ).on('error', reject);
        });

        expect(body).toBe('hello /plain');
        expect(socks.seen.targets).toEqual([`localhost:${targetPort}`]);
    });

    test.each([
        ['file:///etc/passwd', 'Unsupported proxy type "file".'],
        ['ftp://bob:hunter2@proxy:21', 'Unsupported proxy type "ftp".'],
        [toProxyUri('1.2.3.4:1080:bob'), 'The proxy address is not valid.']
    ])('refuses to start for %p without echoing it', async (proxyUri, message) => {
        await expect(startLoginProxy(proxyUri)).rejects.toThrow(message);
        await expect(startLoginProxy(proxyUri)).rejects.not.toThrow(/hunter2|bob/);
    });

    test('stops accepting connections after close', async () => {
        loginProxy = await startLoginProxy(toProxyUri(`127.0.0.1:${socksPort}`));
        const port = Number(new URL(loginProxy.url).port);
        await loginProxy.close();
        loginProxy = null;

        await expect(
            new Promise((resolve, reject) => {
                const s = net.connect(port, '127.0.0.1', () => {
                    s.destroy();
                    resolve();
                });
                s.on('error', reject);
            })
        ).rejects.toThrow(/ECONNREFUSED/);
    });
});
