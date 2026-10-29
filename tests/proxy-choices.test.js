const fs = require('fs');
const os = require('os');
const path = require('path');

const setupProxyChoices = require('../libs/proxy-choices.js');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-choices-'));

describe('proxy choices', () => {
    test('ids stay the same across restarts, and the key is only readable by the owner', () => {
        const microbotDir = tempDir();
        const first = setupProxyChoices({ fs, path, microbotDir }).idFor('10.0.0.8:1080');
        const second = setupProxyChoices({ fs, path, microbotDir }).idFor(' 10.0.0.8:1080 ');
        expect(second).toBe(first);
        expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
        if (process.platform !== 'win32') {
            expect(fs.statSync(path.join(microbotDir, 'proxy-id-key')).mode & 0o777).toBe(0o600);
        }
    });

    test('another PC gives the same proxy a different id, so ids cannot be matched to addresses', () => {
        const one = setupProxyChoices({ fs, path, microbotDir: tempDir() }).idFor('10.0.0.8:1080');
        const other = setupProxyChoices({ fs, path, microbotDir: tempDir() }).idFor('10.0.0.8:1080');
        expect(one).not.toBe(other);
    });

    test('reads every address form the launcher accepts, skips duplicates and ones it cannot use', () => {
        const { savedProxies } = setupProxyChoices({ fs, path, microbotDir: tempDir() });
        const proxies = savedProxies(
            {
                proxies: [
                    { name: 'A', address: 'socks5://u:p@1.1.1.1:1080' },
                    { name: 'B', address: 'u:p@2.2.2.2:1080' },
                    { name: '', address: '3.3.3.3:1080:user:pa:ss' },
                    { name: 'dup', address: '3.3.3.3:1080:user:pa:ss' },
                    { name: 'http', address: 'http://4.4.4.4:8080' },
                    { name: 'bad port', address: '5.5.5.5:99999' }
                ],
                proxyip: ''
            },
            [{ proxyIp: '' }, {}]
        );
        expect(proxies.map((proxy) => proxy.label)).toEqual(['A (1.1.1.1:1080)', 'B (2.2.2.2:1080)', '3.3.3.3:1080']);
    });

    test('replaces a damaged key file', () => {
        const microbotDir = tempDir();
        fs.writeFileSync(path.join(microbotDir, 'proxy-id-key'), 'garbage');
        const id = setupProxyChoices({ fs, path, microbotDir }).idFor('10.0.0.8:1080');
        expect(fs.readFileSync(path.join(microbotDir, 'proxy-id-key'), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
        expect(setupProxyChoices({ fs, path, microbotDir }).idFor('10.0.0.8:1080')).toBe(id);
    });

    test('account and profile ids use the same key, stay stable and never collide with proxy ids', () => {
        const microbotDir = tempDir();
        const choices = setupProxyChoices({ fs, path, microbotDir });
        const again = setupProxyChoices({ fs, path, microbotDir });
        expect(choices.accountIdFor('123')).toMatch(/^a_[A-Za-z0-9_-]{22}$/);
        expect(choices.profileIdFor('main')).toMatch(/^p_[A-Za-z0-9_-]{22}$/);
        expect(again.accountIdFor('123')).toBe(choices.accountIdFor('123'));
        expect(again.profileIdFor('main')).toBe(choices.profileIdFor('main'));
        expect(choices.profileIdFor('123').slice(2)).not.toBe(choices.accountIdFor('123').slice(2));
        expect(choices.accountIdFor('123').slice(2)).not.toBe(choices.idFor('123'));
        expect(setupProxyChoices({ fs, path, microbotDir: tempDir() }).profileIdFor('main')).not.toBe(choices.profileIdFor('main'));
    });
});
