const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const {join} = require("node:path");

module.exports = {
  packagerConfig: {
    asar: true,
    name: `${process.env.npm_package_name}-x64`, // Include x64 in the .exe name
    arch: 'x64',
    platform: 'win32',
    overwrite: true, // Overwrite existing files if necessary
    icon: join(__dirname, 'images', 'microbot_transparent')
  },
/*
    packagerConfig: {
    asar: true,
    name: `${process.env.npm_package_name}-x32`, // Include x64 in the .exe name
    arch: 'ia32',
    platform: 'win32',
    overwrite: true, // Overwrite existing files if necessary
    icon: join(__dirname, 'images', 'microbot_transparent')
  },*/

  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Microbot',
        setupIcon: join(__dirname, 'images', 'microbot_transparent.ico'),
        iconUrl: 'https://developmentb464.blob.core.windows.net/microbot/installer/microbot_transparent.ico' // Optional: URL for the icon
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
