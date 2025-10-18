const crypto = require('crypto');

/**
 * Sets up an in-memory mock authentication system when MOCK_AUTH is enabled.
 * @param {{ipcMain: import('electron').IpcMain, log: import('electron-log')}} deps
 */
module.exports = function setupMockAuth(deps) {
    const { ipcMain, log } = deps;

    const isMockEnabled = false;

    const latency = Number.parseInt(process.env.MOCK_LATENCY_MS || '0', 10) || 0;
    const failurePct = Number.parseFloat(process.env.MOCK_FAIL_PCT || '0') || 0;

    /** @type {Map<string, MockUser>} */
    const users = new Map();
    let currentUser = null;

    if (isMockEnabled) {
        seedUsers(users, log);
    }

    ipcMain.handle('auth:status', async () => {
        if (!isMockEnabled) {
            return { authenticated: true, mock: false };
        }
        await simulateLatencyAndFailure(latency, failurePct);
        return {
            authenticated: Boolean(currentUser),
            mock: true,
            user: currentUser ? { email: currentUser.email } : null
        };
    });

    ipcMain.handle('auth:signup', async (_event, payload) => {
        if (!isMockEnabled) {
            return { error: 'Mock authentication disabled' };
        }
        try {
            await simulateLatencyAndFailure(latency, failurePct);
            const { email, password } = sanitizeCredentials(payload);
            const validationError = validateCredentials(email, password);
            if (validationError) {
                return { error: validationError };
            }

            const normalized = normalizeEmail(email);
            if (users.has(normalized)) {
                return { error: 'Email already exists' };
            }

            const user = createUser(email, password);
            users.set(user.normalizedEmail, user);
            currentUser = user;
            return {
                success: true,
                user: { email: user.email }
            };
        } catch (error) {
            logError(log, error);
            return {
                error: error?.message || 'Temporary error'
            };
        }
    });

    ipcMain.handle('auth:signin', async (_event, payload) => {
        if (!isMockEnabled) {
            return { error: 'Mock authentication disabled' };
        }
        try {
            await simulateLatencyAndFailure(latency, failurePct);
            const { email, password } = sanitizeCredentials(payload);
            if (!email || !password) {
                return { error: 'Email and password are required' };
            }
            const normalized = normalizeEmail(email);
            const user = users.get(normalized);
            if (!user) {
                return { error: 'Invalid email or password.' };
            }

            if (isLocked(user)) {
                return { error: 'Account locked.' };
            }

            const hashed = hashPassword(password);
            if (hashed !== user.passwordHash) {
                registerFailure(user);
                if (user.lockedUntil && user.lockedUntil > Date.now()) {
                    return { error: 'Account locked.' };
                }
                return { error: 'Invalid email or password.' };
            }

            resetFailures(user);
            currentUser = user;
            return {
                success: true,
                user: { email: user.email }
            };
        } catch (error) {
            logError(log, error);
            return {
                error: error?.message || 'Temporary error'
            };
        }
    });

    ipcMain.handle('auth:signout', async () => {
        if (!isMockEnabled) {
            return { error: 'Mock authentication disabled' };
        }
        try {
            await simulateLatencyAndFailure(latency, failurePct);
            currentUser = null;
            return { success: true };
        } catch (error) {
            logError(log, error);
            return { error: error?.message || 'Temporary error' };
        }
    });

    ipcMain.handle('auth:changepw', async (_event, payload) => {
        if (!isMockEnabled) {
            return { error: 'Mock authentication disabled' };
        }
        try {
            await simulateLatencyAndFailure(latency, failurePct);
            if (!currentUser) {
                return { error: 'Not authenticated.' };
            }
            const newPassword = String(payload?.newPassword || '').trim();
            if (newPassword.length < 8) {
                return { error: 'Password must be at least 8 characters.' };
            }
            const user = users.get(currentUser.normalizedEmail);
            if (!user) {
                return { error: 'Not authenticated.' };
            }
            user.passwordHash = hashPassword(newPassword);
            resetFailures(user);
            return { success: true };
        } catch (error) {
            logError(log, error);
            return { error: error?.message || 'Temporary error' };
        }
    });
};

/**
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

/**
 * @param {string} password
 * @returns {string}
 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password)).digest('hex');
}

/**
 * @param {MockUser} user
 */
function registerFailure(user) {
    const now = Date.now();
    user.failedAttempts.push(now);
    user.failedAttempts = user.failedAttempts.filter(
        (attempt) => now - attempt <= 15 * 60 * 1000
    );
    if (user.failedAttempts.length >= 5) {
        user.lockedUntil = now + 15 * 60 * 1000;
        user.failedAttempts = [];
    }
}

/**
 * @param {MockUser} user
 */
function resetFailures(user) {
    user.failedAttempts = [];
    user.lockedUntil = null;
}

/**
 * @param {MockUser} user
 * @returns {boolean}
 */
function isLocked(user) {
    if (!user.lockedUntil) {
        return false;
    }
    if (user.lockedUntil <= Date.now()) {
        user.lockedUntil = null;
        return false;
    }
    return true;
}

/**
 * @param {{ email?: string, password?: string }} payload
 */
function sanitizeCredentials(payload) {
    return {
        email: String(payload?.email || '').trim(),
        password: String(payload?.password || '')
    };
}

/**
 * @param {string} email
 * @param {string} password
 */
function validateCredentials(email, password) {
    if (!email || !password) {
        return 'Email and password are required';
    }
    const emailRegex = /.+@.+\..+/;
    if (!emailRegex.test(email)) {
        return 'Invalid email address';
    }
    if (password.length < 8) {
        return 'Password must be at least 8 characters.';
    }
    return null;
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {MockUser}
 */
function createUser(email, password) {
    const normalizedEmail = normalizeEmail(email);
    return {
        email: String(email || '').trim(),
        normalizedEmail,
        passwordHash: hashPassword(password),
        failedAttempts: [],
        lockedUntil: null
    };
}

/**
 * Seeds mock users from the MOCK_USERS environment variable.
 * Accepts either a JSON array (e.g., '[{"email":"a","password":"b"}]')
 * or a comma/semicolon-separated list like 'a@example.com:Password1,b@example.com:Password2'.
 * @param {Map<string, MockUser>} users
 * @param {import('electron-log')} log
 */
function seedUsers(users, log) {
    const seed = process.env.MOCK_USERS;
    if (!seed) {
        return;
    }

    const entries = parseSeed(seed, log);
    for (const entry of entries) {
        const { email, password } = entry;
        if (!email || !password) {
            continue;
        }
        const normalized = normalizeEmail(email);
        if (users.has(normalized)) {
            continue;
        }
        users.set(normalized, createUser(email, password));
    }
}

/**
 * @param {string} raw
 * @param {import('electron-log')} log
 * @returns {{email: string, password: string}[]}
 */
function parseSeed(raw, log) {
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed
                .map((item) => ({
                    email: String(item?.email || '').trim(),
                    password: String(item?.password || '')
                }))
                .filter((item) => item.email && item.password);
        }
    } catch (error) {
        // Ignore JSON parsing errors and fall back to string format
        logError(log, error, 'Failed to parse MOCK_USERS as JSON; falling back to delimited list.');
    }

    return raw
        .split(/[,;\n]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((pair) => {
            const [email, password] = pair.split(':');
            return {
                email: String(email || '').trim(),
                password: String(password || '').trim()
            };
        })
        .filter((item) => item.email && item.password);
}

/**
 * @param {number} latencyMs
 * @param {number} failurePercentage
 */
async function simulateLatencyAndFailure(latencyMs, failurePercentage) {
    if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }
    if (failurePercentage > 0) {
        const roll = Math.random() * 100;
        if (roll < failurePercentage) {
            throw new Error('Temporary error');
        }
    }
}

/**
 * @param {import('electron-log')} log
 * @param {unknown} error
 * @param {string} [context]
 */
function logError(log, error, context) {
    if (!log) {
        return;
    }
    const message = error instanceof Error ? error.stack || error.message : String(error);
    if (context) {
        log.warn(`${context} ${message}`);
    } else {
        log.warn(message);
    }
}

/**
 * @typedef {{
 *  email: string;
 *  normalizedEmail: string;
 *  passwordHash: string;
 *  failedAttempts: number[];
 *  lockedUntil: number|null;
 * }} MockUser
 */
