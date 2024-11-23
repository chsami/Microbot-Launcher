const { exec } = require('child_process');
const {logMessage} = require("./logger");

// Check Java and run the JAR
function checkJavaAndRunJar(command, dialog, shell, mainWindow) {
    logMessage(command)
    isJavaInstalled((isInstalled, error) => {
        if (isInstalled) {
            console.log('Java is installed, running the JAR...');
            executeJar(command, dialog);
        } else {
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Java Not Found',
                message: 'Java Development Kit (JDK) is required to run this application. Would you like to download it now?',
                buttons: ['Yes, Download JDK', 'Cancel']
            }).then((result) => {
                if (result.response === 0) {
                    // Open JDK download page in the default browser
                    shell.openExternal('https://www.oracle.com/java/technologies/downloads/');
                } else {
                    console.log('User chose not to download Java.');
                }
            });
        }
    });
}

function isJavaInstalled(callback) {
    exec('java -version', (error, stdout, stderr) => {
        console.log(stderr, stderr)
        if (error) {
            callback(false, stderr);
        } else {
            callback(true);
        }
    });
}

function executeJar(command, dialog) {
    // Execute the JAR file
    logMessage(command)
    exec(command, (error, stdout, stderr) => {
        try {
            if (error) {
                logMessage(error.message)
                if (dialog) {
                    dialog.showErrorBox('Error running jar!', error.message)
                }
            }
        } catch(exception) {
            logMessage(exception?.message)
        }

    });
}


module.exports = {
    checkJavaAndRunJar,
    executeJar
};