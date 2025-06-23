const fs = require('fs');
const path = require('path');
const os = require('os');
const {microbotDir} = require("./dir-module");

// Determine the log file path
const logFilePath =  path.join(microbotDir, 'debug.log');

// Function to log messages to the file
function logMessage(message) {
    if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, '', 'utf8');
    }
    const logEntry = `${new Date().toISOString()} - ${message}\n`;
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