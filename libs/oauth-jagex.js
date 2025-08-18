const { chromium } = require('patchright');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { getAvailableBrowser } = require('./browser-util.js');

const userHome = process.env.HOME || process.env.USERPROFILE;
const ACCOUNTS_DIR = path.join(userHome, '.microbot');
const ACCOUNTS_FILE_PATH = path.join(ACCOUNTS_DIR, 'accounts.json');

const state = generateRandomState(8);
const codeVerifier = generateCodeVerifier(45);
const codeChallenge = getCodeChallenge(codeVerifier);

/**
 * Auth complete HTML to better show the user that the auth process is complete
 * and soon gonna be redirected to the launcher.
 */
const AUTH_COMPLETE_HTML =
    /* HTML */
    `<!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <title>Authentication Complete</title>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
                <style>
                    html,
                    body {
                        height: 100%;
                        margin: 0;
                        font-family: system-ui, -apple-system, Segoe UI, Roboto,
                            Helvetica, Arial, sans-serif;
                        background: #0d1117;
                        color: #e6edf3;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .container {
                        text-align: center;
                        max-width: 760px;
                        padding: 2rem;
                    }
                    h1 {
                        font-size: 2.4rem;
                        margin: 0 0 1rem;
                        letter-spacing: 0.5px;
                    }
                    p {
                        font-size: 1.15rem;
                        margin: 0;
                        opacity: 0.85;
                    }
                    .spinner {
                        width: 54px;
                        height: 54px;
                        border: 6px solid #2d333b;
                        border-top-color: #2f81f7;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                        margin: 2.25rem auto 0;
                    }
                    @keyframes spin {
                        to {
                            transform: rotate(360deg);
                        }
                    }
                    .fade-in {
                        animation: fade 0.6s ease-in-out;
                    }
                    @keyframes fade {
                        from {
                            opacity: 0;
                            transform: translateY(6px);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0);
                        }
                    }
                </style>
                <script>
                    // Try to close automatically after a short delay (ignored in most browsers unless opened programmatically)
                    setTimeout(function () {
                        try {
                            window.close();
                        } catch (_) {}
                    }, 2600);
                </script>
            </head>
            <body>
                <div class="container fade-in">
                    <h1>Authentication Complete</h1>
                    <p>
                        Successfully completed the authentication, returning to
                        the launcher...
                    </p>
                    <div class="spinner" aria-hidden="true"></div>
                </div>
            </body>
        </html>`;

/**
 * Generates a cryptographically secure random string.
 * @param {number} length The length of the random string.
 * @returns {string} The generated random string.
 */
function generateCodeVerifier(length) {
    return crypto.randomBytes(length).toString('base64url');
}

/**
 * Creates a SHA-256 hash of the code verifier.
 * @param {string} verifier The code verifier string.
 * @returns {string} The base64url encoded SHA-256 hash.
 */
function getCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generates a random state string for OAuth.
 * @param {number} length The desired length of the state string.
 * @returns {string} The random state string.
 */
function generateRandomState(length) {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Extracts the id_token from a URL fragment, mirroring Java's extractIdTokenFromUrl.
 * @param {string} url The URL containing the fragment.
 * @returns {string|null} The id_token or null if not found.
 */
function extractIdTokenFromUrl(url) {
    try {
        const urlObject = new URL(url);
        const fragment = urlObject.hash.substring(1); // Get the fragment part of the URL (after #)
        if (fragment) {
            const params = new URLSearchParams(fragment);
            return params.get('id_token');
        }
        return null;
    } catch (error) {
        console.error('Error parsing URL fragment for id_token:', error);
        return null;
    }
}

/**
 * Extracts the code from a URL query parameter, similar to Java's extractCodeFromUrl.
 * @param {string} url The URL containing the code parameter.
 * @returns {string|null} The code or null if not found.
 */
function extractCodeFromUrl(url) {
    try {
        const urlObject = new URL(url);
        const params = new URLSearchParams(urlObject.search);
        return params.get('code');
    } catch (error) {
        console.error('Error parsing URL for code:', error);
        return null;
    }
}

/**
 * Exchanges an authorization code for an access token and ID token.
 * @param {string} code The authorization code from the redirect.
 * @returns {Promise<string|null>} The ID token or null on failure.
 */
async function getToken(code) {
    console.log('Exchanging authorization code for token...');
    try {
        const response = await axios.post(
            'https://account.jagex.com/oauth2/token',
            new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: 'com_jagex_auth_desktop_launcher',
                code: code,
                code_verifier: codeVerifier,
                redirect_uri:
                    'https://secure.runescape.com/m=weblogin/launcher-redirect'
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );
        console.log('Token exchange successful.');
        console.log('ID Token:', response.data.id_token);
        // Return the ID token
        return response.data.id_token;
    } catch (error) {
        console.error(
            'Error getting token:',
            error.response ? error.response.data : error.message
        );
        return null;
    }
}

/**
 * Gets a game session ID using the ID token.
 * @param {string} idToken The ID token.
 * @returns {Promise<string|null>} The session ID or null on failure.
 */
async function getSessionId(idToken) {
    console.log('Fetching game session ID...');
    try {
        const response = await axios.post(
            'https://auth.jagex.com/game-session/v1/sessions',
            { idToken },
            { headers: { 'Content-Type': 'application/json' } }
        );
        console.log('Session ID fetched successfully.');
        return response.data.sessionId;
    } catch (error) {
        console.error(
            'Error getting session ID:',
            error.response ? error.response.data : error.message
        );
        return null;
    }
}

/**
 * Fetches account details and writes them to a JSON file.
 * @param {string} sessionId The game session ID.
 */
async function writeAccountsToFile(sessionId) {
    console.log('Fetching account information...');
    try {
        const response = await axios.get(
            'https://auth.jagex.com/game-session/v1/accounts',
            {
                headers: { Authorization: `Bearer ${sessionId}` }
            }
        );

        const newAccounts = response.data.map((acc) => ({
            ...acc,
            sessionId,
            createdOn: new Date().toISOString()
        }));

        await fs.mkdir(ACCOUNTS_DIR, { recursive: true });

        let existingAccounts = [];
        try {
            const fileContent = await fs.readFile(ACCOUNTS_FILE_PATH, 'utf-8');
            existingAccounts = JSON.parse(fileContent);
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.error('Error reading existing accounts file:', e);
            }
        }

        const existingAccountIds = new Set(
            existingAccounts.map((acc) => acc.accountId)
        );
        const nonDuplicateNewAccounts = newAccounts.filter(
            (acc) => !existingAccountIds.has(acc.accountId)
        );

        if (nonDuplicateNewAccounts.length > 0) {
            const allAccounts = [
                ...existingAccounts,
                ...nonDuplicateNewAccounts
            ];
            await fs.writeFile(
                ACCOUNTS_FILE_PATH,
                JSON.stringify(allAccounts, null, 2)
            );
            console.log(
                `Successfully wrote ${nonDuplicateNewAccounts.length} new account(s) to ${ACCOUNTS_FILE_PATH}`
            );
        } else {
            console.log('No new accounts to add.');
        }
    } catch (error) {
        console.error(
            'Error writing accounts to file:',
            error.response ? error.response.data : error.message
        );
    }
}

/**
 * Starts the authentication flow using Playwright.
 * @returns {Promise<string>} A promise that resolves when the authentication is complete.
 * @throws {Error} If the authentication fails or is interrupted.
 * @description This function launches a Chromium browser, navigates to the Jagex OAuth login page,
 * and handles the authentication flow. It captures the ID token and session ID, then writes
 * the account information to a JSON file.
 * It uses Playwright's Chromium browser for the UI interaction (Patchwright for bot detection bypass).
 * It also handles the redirect to localhost after successful authentication.
 */
async function startAuthFlow() {
    return new Promise(async (resolve, reject) => {
        let finished = false;

        function fail(err) {
            if (finished) return;
            finished = true;
            reject(err);
        }

        const availableBrowser = await getAvailableBrowser();

        if (!availableBrowser) {
            return fail(
                new Error(
                    'No supported browser found on the system, please have a Chromium-based browser installed.'
                )
            );
        }

        const browser = await chromium.launch({
            headless: false,
            executablePath: availableBrowser.executable
        });
        const context = await browser.newContext();
        const page = await context.newPage();

        const initialUrl = `https://account.jagex.com/oauth2/auth?auth_method=&login_type=&flow=launcher&response_type=code&client_id=com_jagex_auth_desktop_launcher&redirect_uri=https%3A%2F%2Fsecure.runescape.com%2Fm%3Dweblogin%2Flauncher-redirect&code_challenge=${codeChallenge}&code_challenge_method=S256&prompt=login&scope=openid+offline+gamesso.token.create+user.profile.read&state=${state}`;

        console.log('Starting authentication flow...');

        /**
         * Handles the unexpected closure of the authentication flow.
         */
        page.once('close', () => {
            if (finished) return;
            browser.close();
            fail(
                new Error(
                    'Browser was closed before authentication flow completed.'
                )
            );
        });

        page.on('framenavigated', async (frame) => {
            if (finished) return;
            const url = frame.url();

            try {
                if (url.includes('id_token=')) {
                    console.log(
                        'Found the URL with the id_token query parameter.'
                    );
                    const idToken = extractIdTokenFromUrl(url);
                    if (idToken) {
                        const sessionId = await getSessionId(idToken);
                        if (sessionId) {
                            await writeAccountsToFile(sessionId);
                        }

                        console.log(
                            'Authentication flow complete. Closing browser.'
                        );
                        finished = true;
                        await browser.close();
                        resolve('Authentication successful.');
                    }
                } else if (url.includes('code=') && !url.includes('locale?')) {
                    console.log('Found the url with the code query parameter.');
                    const code = extractCodeFromUrl(url);
                    if (code) {
                        console.log(
                            'The URL contains the specified code query parameter.'
                        );
                        const idTokenFromCode = await getToken(code);
                        if (idTokenFromCode) {
                            const nonce = generateRandomState(48);
                            const nextAuthUrl =
                                `https://account.jagex.com/oauth2/auth?id_token_hint=${idTokenFromCode}` +
                                `&nonce=${nonce}` +
                                `&prompt=consent` +
                                `&redirect_uri=http%3A%2F%2Flocalhost` +
                                `&response_type=id_token+code` +
                                `&state=${state}` +
                                `&client_id=1fddee4e-b100-4f4e-b2b0-097f9088f9d2` +
                                `&scope=openid+offline`;

                            console.log('Navigating to NextAuth URL.');
                            await page.goto(nextAuthUrl);
                        }
                    }
                }
            } catch (error) {
                await browser.close();
                fail(
                    new Error(
                        'An error occurred during the authentication flow.'
                    )
                );
            }
        });

        await page.route('http://localhost/', async (route) => {
            if (finished) return;
            console.log('Intercepted navigation to localhost.');

            await page.waitForTimeout(50); // Small delay to ensure the URL is updated
            finalUrl = page.url();

            // Fulfill with the auth complete HTML which indicates the auth process is complete
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: AUTH_COMPLETE_HTML
            });
        });

        await page.goto(initialUrl);
    });
}

module.exports = { startAuthFlow };
