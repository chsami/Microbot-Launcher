const os = require('os');
const path = require('path');
// Get the user's home directory
const homeDir = os.homedir();

// Construct the path to the .microbot folder
const microbotDir = path.join(homeDir, '.microbot');

module.exports = {
    microbotDir
}