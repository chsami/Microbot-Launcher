const { spawn } = require('child_process');
const { logMessage } = require('./logger');

// Check Java and run the JAR
function checkJavaAndRunJar(commandArgs, dialog, shell, mainWindow) {
    logMessage(`java ${commandArgs.join(' ')}`);
    isJavaInstalled((isInstalled, error) => {
        if (isInstalled) {
            console.log('Java is installed, running the JAR...');
            executeJar(commandArgs, dialog);
        } else {
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Java Not Found',
                message: 'Java Development Kit (JDK) is required to run this application. Would you like to download it now?',
                buttons: ['Yes, Download JDK', 'Cancel']
            }).then((result) => {
                if (result.response === 0) {
                    shell.openExternal('https://www.oracle.com/java/technologies/downloads/');
                } else {
                    console.log('User chose not to download Java.');
                }
            });
        }
    });
}

function isJavaInstalled(callback) {
    const javaProcess = spawn('java', ['-version']);

    let stderrData = '';

    javaProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
    });

    javaProcess.on('error', (err) => {
        callback(false, err.message);
    });

    javaProcess.on('close', (code) => {
        callback(code === 0, stderrData);
    });
}

function executeJar(commandArgs, dialog) {
    logMessage(`java ${commandArgs.join(' ')}`);

    const jarProcess = spawn('java', commandArgs);

    jarProcess.stdout.on('data', (data) => {
        logMessage(`[stdout] ${data}`);
    });

    jarProcess.stderr.on('data', (data) => {
        logMessage(`[stddata] ${data}`);
    });

    jarProcess.on('error', (err) => {
        logMessage(`[error] ${err.message}`);
        if (dialog) {
            dialog.showErrorBox('Error running jar!', err.message);
        }
    });

    jarProcess.on('close', (code) => {
        logMessage(`JAR exited with code ${code}`);
    });
}

module.exports = {
    checkJavaAndRunJar,
    executeJar
};