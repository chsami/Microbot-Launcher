const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Determine the log file path
const logFilePath =  path.join(__dirname, '../debug.log');

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

module.exports = {
    logMessage
}