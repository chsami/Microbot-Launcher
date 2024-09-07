const fs = require('fs');
const path = require('path');
const os = require('os');
const {appInsights} = require("./appinsights");

// Get the user's home directory
const homeDir = os.homedir();

// Construct the path to the .microbot folder
const microbotDir = path.join(homeDir, '.microbot');

// Determine the log file path
const logFilePath =  path.join(microbotDir, 'debug.log');

// Function to log messages to the file
function logMessage(message) {
    if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, '', 'utf8');
    }
    const logEntry = `${new Date().toISOString()} - ${message}\n`;
    appInsights.defaultClient.trackTrace({ message: message, severity: 1});
    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            console.error('Failed to write to log file:', err);
        }
    });
}
function logError(message) {
    if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, '', 'utf8');
    }
    const logEntry = `${new Date().toISOString()} - ${message}\n`;
    console.log(message)
    appInsights.defaultClient.trackException({ exception: new Error(message) });
    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            console.error('Failed to write to log file:', err);
        }
    });
}
module.exports = {
    logMessage,
    logError
}