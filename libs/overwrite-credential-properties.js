const fs = require('fs');
const path = require('path');


function overwrite(characterData) {
    // Path to the credentials.properties file in your home directory
    const homeDirectory = require('os').homedir();
    const filePath = path.join(homeDirectory, '.runelite', 'credentials.properties');
// Generate the file content in the same format
    const fileContent = `#Do not share this file with anyone
#${new Date().toString()}
JX_CHARACTER_ID=${characterData.accountId}
JX_SESSION_ID=${characterData.sessionId}
JX_REFRESH_TOKEN=
JX_DISPLAY_NAME=${characterData.displayName}
JX_ACCESS_TOKEN=
`;
    // Write the content to the file, overwriting the existing file
    fs.writeFile(filePath, fileContent, 'utf8', (err) => {
        if (err) {
            console.error('An error occurred while writing to the file:', err);
        } else {
            console.log('credentials.properties file updated successfully.');
        }
    });

}


module.exports = {
    overwrite
}