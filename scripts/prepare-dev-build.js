const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const buildNumber = process.env.DEV_BUILD_NUMBER || '';

if (!/^[1-9]\d*$/.test(buildNumber)) {
    console.error(`DEV_BUILD_NUMBER must be a positive integer, got "${buildNumber}"`);
    process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const baseVersion = pkg.version.split('-')[0];

pkg.name = `${pkg.name}-dev`;
pkg.version = `${baseVersion}-dev.${buildNumber}`;
pkg.build.appId = `${pkg.build.appId}.dev`;
pkg.build.productName = `${pkg.build.productName} Dev`;
pkg.build.nsis.shortcutName = `${pkg.build.nsis.shortcutName} Dev`;
const releaseUrl = pkg.build.publish.url;
pkg.build.publish.url = releaseUrl.replace(/\/microbot-launcher\/?$/, '/microbot-launcher-dev/');
if (pkg.build.publish.url === releaseUrl) {
    console.error(`Cannot derive the dev feed from publish url "${releaseUrl}"`);
    process.exit(1);
}
pkg.build.publish.channel = 'latest';

fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log(pkg.version);
