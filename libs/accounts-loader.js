const fs = require('fs');
const os = require('os');
const path = require("path");

// Get the user's home directory
const homeDir = os.homedir();

// Construct the path to the .microbot folder
const microbotDir = path.join(homeDir, '.microbot');
const filePath = path.resolve(microbotDir, 'accounts.json');

const readAccountsJson = () => {
    try {

        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            let accounts = JSON.parse(data);
            accounts.sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
            // Use a Set to track unique display names
            const uniqueDisplayNames = new Set();

            // Filter the accounts array
            return accounts.filter(account => {
                if (uniqueDisplayNames.has(account.displayName)) {
                    // If the displayName is already in the set, skip this account
                    return false;
                } else {
                    // Otherwise, add the displayName to the set and include this account
                    if (!account.displayName) {
                        account.displayName = 'Not set'
                        return true;
                    } else {
                        uniqueDisplayNames.add(account.displayName);
                        return true;
                    }
                }
            })
        }
    } catch (err) {
        console.error('Error reading properties file:', err);
        return {};
    }
};

const removeAccountsJson = () => {
    try {

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (err) {
        console.error('Error reading properties file:', err);
        return {};
    }
}

let lastModifiedTime = null;

// Function to check the file's modification time
function checkFileModification() {
    if (fs.existsSync(filePath)) {

        fs.stat(filePath, (err, stats) => {
            if (err) {
                console.error(`Error checking file: ${err.message}`);
                return false;
            }

            const modifiedTime = stats.mtime;

            // Check if the modification time has changed
            if (!lastModifiedTime || modifiedTime > lastModifiedTime) {
                console.log('File has been modified!');
                lastModifiedTime = modifiedTime; // Update the last modification time
                return true
            }
            return false
        });
    }
}

module.exports = {
    readAccountsJson,
    removeAccountsJson,
    checkFileModification
}