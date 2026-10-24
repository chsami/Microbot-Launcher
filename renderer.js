let accounts = [];
let restoringSelectedAccount = false;
let iii = null;
let lastAccountsReadError = null;
let accountInfoReturnFocus = null;
let latestClientVersion = null;
let cleanupAccountsDropdownListeners = null;

const DEFAULT_CLIENT_RAM = '1g';
let launcherInitialized = false;
let authUiReady = false;
let mockAuthEnabled = false;
let apiAuthEnabled = false;
let currentSessionEmail = '';

function authAvailable() {
    return mockAuthEnabled || apiAuthEnabled;
}

function $(id) {
    return document.getElementById(id);
}

function toggleClass(element, className, shouldAdd) {
    if (!element) return;
    if (shouldAdd) {
        element.classList.add(className);
    } else {
        element.classList.remove(className);
    }
}

function setButtonLoading(button, isLoading, loadingText) {
    if (!button) return;
    if (isLoading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }
        if (loadingText) {
            button.textContent = loadingText;
        }
        button.disabled = true;
    } else {
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
        button.disabled = false;
    }
}

function setAuthError(message, elementId = 'auth-error', isSuccess = false) {
    const element = $(elementId);
    if (!element) return;
    element.textContent = message || '';
    toggleClass(element, 'success', Boolean(isSuccess && message));
}

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;
const EYE_ICON =
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const EYE_OFF_ICON =
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path><path d="M2 2l20 20"></path></svg>';

function passwordLengthProblem(password) {
    if (password.length < PASSWORD_MIN_LENGTH) return 'short';
    if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'long';
    return null;
}

function setPasswordVisible(input, button, visible) {
    input.type = visible ? 'text' : 'password';
    button.innerHTML = visible ? EYE_OFF_ICON : EYE_ICON;
    const label = visible ? 'Hide password' : 'Show password';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    button.title = label;
}

function setupPasswordToggles() {
    document.querySelectorAll('.auth-form input[type="password"]').forEach((input) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'password-field';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'password-toggle';
        wrapper.appendChild(button);
        setPasswordVisible(input, button, false);
        button.addEventListener('click', () => {
            setPasswordVisible(input, button, input.type === 'password');
            input.focus();
        });
        input.form?.addEventListener('reset', () => setPasswordVisible(input, button, false));
    });
}

function setHint(element, text, state) {
    if (!element) return;
    element.textContent = text;
    toggleClass(element, 'is-error', state === 'error');
    toggleClass(element, 'is-ok', state === 'ok');
}

function updateSignupPasswordChecks() {
    const passwordInput = $('signup-password');
    const confirmInput = $('signup-confirm-password');
    if (!passwordInput || !confirmInput) return;
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;
    const problem = password ? passwordLengthProblem(password) : null;
    const hint = $('signup-password-hint');
    if (!password) {
        setHint(hint, 'At least 8 characters.', null);
    } else if (problem === 'short') {
        const missing = PASSWORD_MIN_LENGTH - password.length;
        setHint(hint, `${missing} more character${missing === 1 ? '' : 's'} needed (at least 8).`, 'error');
    } else if (problem === 'long') {
        setHint(hint, 'Too long. Use at most 72 characters.', 'error');
    } else {
        setHint(hint, 'Password length looks good.', 'ok');
    }
    passwordInput.setAttribute('aria-invalid', problem ? 'true' : 'false');

    const confirmHint = $('signup-confirm-hint');
    const mismatch = Boolean(confirmPassword) && confirmPassword !== password;
    if (!confirmPassword) setHint(confirmHint, '', null);
    else if (mismatch) setHint(confirmHint, "Passwords don't match yet.", 'error');
    else setHint(confirmHint, 'Passwords match.', 'ok');
    confirmInput.setAttribute('aria-invalid', mismatch ? 'true' : 'false');
}

function setActiveAuthTab(target) {
    const signinTab = $('auth-tab-signin');
    const signupTab = $('auth-tab-signup');
    const signinForm = $('signin-form');
    const signupForm = $('signup-form');
    const isSignin = target === 'signin';

    toggleClass(signinTab, 'active', isSignin);
    toggleClass(signupTab, 'active', !isSignin);
    if (signinTab) signinTab.setAttribute('aria-selected', isSignin ? 'true' : 'false');
    if (signupTab) signupTab.setAttribute('aria-selected', isSignin ? 'false' : 'true');
    toggleClass(signinForm, 'auth-hidden', !isSignin);
    toggleClass(signupForm, 'auth-hidden', isSignin);
    const subtitle = $('auth-subtitle');
    if (subtitle) {
        subtitle.textContent = isSignin ? 'Sign in to your Microbot account' : 'Create your Microbot account';
    }
    toggleClass($('auth-resend'), 'auth-hidden', true);
    setAuthError('');
}

function authModalDismissible() {
    return !mockAuthEnabled;
}

function onAuthModalKeydown(event) {
    if (event.key === 'Escape' && authModalDismissible()) {
        hideAuthModal();
    }
}

function showAuthModal() {
    const modal = $('auth-modal');
    if (!modal) return;
    modal.classList.remove('auth-hidden');
    $('signin-form')?.reset();
    $('signup-form')?.reset();
    setActiveAuthTab('signin');
    toggleClass($('auth-forgot'), 'auth-hidden', !apiAuthEnabled);
    toggleClass($('auth-dismiss'), 'auth-hidden', !authModalDismissible());
    document.addEventListener('keydown', onAuthModalKeydown);
    setTimeout(() => $('signin-email')?.focus(), 0);
}

function hideAuthModal() {
    const modal = $('auth-modal');
    if (!modal) return;
    modal.classList.add('auth-hidden');
    document.removeEventListener('keydown', onAuthModalKeydown);
    setAuthError('');
}

function onAccountInfoKeydown(event) {
    if (event.key !== 'Escape') return;
    event.stopImmediatePropagation();
    hideAccountInfo();
}

function showAccountInfo() {
    const modal = $('account-info-modal');
    if (!modal) return;
    toggleClass($('account-info-create'), 'auth-hidden', Boolean(currentSessionEmail) || !authAvailable());
    accountInfoReturnFocus = document.activeElement;
    modal.classList.remove('auth-hidden');
    window.addEventListener('keydown', onAccountInfoKeydown, true);
    setTimeout(() => $('account-info-close')?.focus(), 0);
}

function hideAccountInfo() {
    $('account-info-modal')?.classList.add('auth-hidden');
    window.removeEventListener('keydown', onAccountInfoKeydown, true);
    const returnFocus = accountInfoReturnFocus;
    accountInfoReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus();
}

function showCreateAccountFromInfo() {
    hideAccountInfo();
    if ($('auth-modal')?.classList.contains('auth-hidden')) showAuthModal();
    setActiveAuthTab('signup');
    setTimeout(() => $('signup-email')?.focus(), 0);
}

function showChangePasswordModal() {
    if (!mockAuthEnabled) return;
    const modal = $('change-password-modal');
    if (!modal) return;
    $('change-password-form')?.reset();
    setAuthError('', 'change-password-error');
    modal.classList.remove('auth-hidden');
    const input = $('current-password-input');
    if (input) {
        setTimeout(() => input.focus(), 0);
    }
}

function hideChangePasswordModal() {
    const modal = $('change-password-modal');
    if (!modal) return;
    modal.classList.add('auth-hidden');
    setAuthError('', 'change-password-error');
}

const ACCOUNT_ICON =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>';

function updateSessionEmail(email) {
    currentSessionEmail = email || '';
    const sessionContainer = $('user-session');
    const emailLabel = $('session-email');
    if (!sessionContainer || !emailLabel) return;
    const signedIn = Boolean(currentSessionEmail);
    toggleClass(sessionContainer, 'hidden', !authAvailable() || (mockAuthEnabled && !signedIn));
    toggleClass(sessionContainer, 'signed-in', signedIn);
    emailLabel.textContent = signedIn ? currentSessionEmail : 'Not signed in';
    emailLabel.title = signedIn ? currentSessionEmail : '';
    const hint = $('session-hint');
    if (hint) hint.textContent = signedIn ? 'Microbot account' : 'Sign in or create a free account';
    const avatar = $('account-avatar');
    if (avatar) {
        if (signedIn) avatar.textContent = currentSessionEmail.charAt(0).toUpperCase();
        else avatar.innerHTML = ACCOUNT_ICON;
    }
    toggleClass($('signin-btn'), 'hidden', signedIn);
    toggleClass($('signout-btn'), 'hidden', !signedIn);
    toggleClass($('change-password-btn'), 'hidden', !signedIn || !mockAuthEnabled);
}

function signinEmail() {
    return $('signin-email')?.value?.trim() || '';
}

async function handleResendVerification() {
    const email = signinEmail();
    const button = $('auth-resend');
    setButtonLoading(button, true, 'Sending...');
    try {
        const result = await window.electron.auth.resendVerification({ email });
        if (result?.success) {
            setAuthError(`We sent a new verification link to ${email}.`, 'auth-error', true);
        } else {
            setAuthError(result?.error || 'Could not send the verification email.');
        }
    } catch (error) {
        setAuthError(error?.message || 'Could not send the verification email.');
    } finally {
        setButtonLoading(button, false);
    }
}

async function handleForgotPassword() {
    const email = signinEmail();
    if (!email) {
        setAuthError('Enter your email above, then click "Forgot password?" again.');
        $('signin-email')?.focus();
        return;
    }
    const button = $('auth-forgot');
    setButtonLoading(button, true, 'Sending...');
    try {
        const result = await window.electron.auth.requestPasswordReset({ email });
        if (result?.success) {
            setAuthError(
                `If an account exists for ${email}, we sent a password reset link. It expires in 15 minutes.`,
                'auth-error',
                true
            );
        } else {
            setAuthError(result?.error || 'Could not send the reset email.');
        }
    } catch (error) {
        setAuthError(error?.message || 'Could not send the reset email.');
    } finally {
        setButtonLoading(button, false);
    }
}

async function handleSignIn(event) {
    event.preventDefault();
    if (!authAvailable()) {
        hideAuthModal();
        await ensureLauncherInitialized();
        return;
    }
    const email = $('signin-email')?.value?.trim();
    const password = $('signin-password')?.value || '';
    if (!email || !password) {
        setAuthError('Email and password are required');
        return;
    }
    setAuthError('');
    toggleClass($('auth-resend'), 'auth-hidden', true);
    const button = $('signin-submit');
    setButtonLoading(button, true, 'Signing In...');
    try {
        const result = await window.electron.auth.signin({ email, password });
        if (result?.success) {
            await refreshAuthStatus();
        } else {
            setAuthError(result?.error || 'Unable to sign in');
            toggleClass($('auth-resend'), 'auth-hidden', result?.code !== 'unverified');
        }
    } catch (error) {
        setAuthError(error?.message || 'Unable to sign in');
    } finally {
        setButtonLoading(button, false);
    }
}

async function handleSignUp(event) {
    event.preventDefault();
    if (!authAvailable()) {
        hideAuthModal();
        await ensureLauncherInitialized();
        return;
    }
    const email = $('signup-email')?.value?.trim();
    const password = $('signup-password')?.value || '';
    if (!email || !password) {
        setAuthError('Email and password are required');
        return;
    }
    const lengthProblem = passwordLengthProblem(password);
    if (lengthProblem) {
        setAuthError(
            lengthProblem === 'short' ? 'Password must be at least 8 characters.' : 'Password must be at most 72 characters.'
        );
        return;
    }
    const confirmPassword = $('signup-confirm-password')?.value || '';
    if (password !== confirmPassword) {
        setAuthError('Passwords do not match.');
        return;
    }
    setAuthError('');
    const button = $('signup-submit');
    setButtonLoading(button, true, 'Creating Account...');
    try {
        const result = await window.electron.auth.signup({ email, password });
        if (result?.pendingVerification) {
            setActiveAuthTab('signin');
            $('signup-form')?.reset();
            const signinEmailInput = $('signin-email');
            if (signinEmailInput) signinEmailInput.value = email;
            setAuthError(
                result.verificationEmailSent
                    ? `Account created. We sent a verification link to ${email}. Verify your email, then sign in here.`
                    : `Account created, but we couldn't send the verification email. Click "Resend verification email" below.`,
                'auth-error',
                result.verificationEmailSent
            );
            toggleClass($('auth-resend'), 'auth-hidden', false);
        } else if (result?.success) {
            await refreshAuthStatus();
        } else {
            setAuthError(result?.error || 'Unable to create account');
        }
    } catch (error) {
        setAuthError(error?.message || 'Unable to create account');
    } finally {
        setButtonLoading(button, false);
    }
}

async function handleSignOut() {
    if (!authAvailable()) return;
    const button = $('signout-btn');
    setButtonLoading(button, true, 'Signing Out...');
    try {
        const result = await window.electron.auth.signout();
        if (result?.success) {
            await refreshAuthStatus();
        } else if (result?.error) {
            window.electron.errorAlert(result.error);
        }
    } catch (error) {
        window.electron.errorAlert(error?.message || 'Unable to sign out.');
    } finally {
        setButtonLoading(button, false);
        hideChangePasswordModal();
    }
}

async function handleChangePassword(event) {
    event.preventDefault();
    if (!mockAuthEnabled) return;
    const currentPassword = $('current-password-input')?.value || '';
    const newPassword = $('change-password-input')?.value || '';

    if (!currentPassword) {
        setAuthError('Current password is required.', 'change-password-error');
        return;
    }
    if (newPassword.length < 8) {
        setAuthError('New password must be at least 8 characters.', 'change-password-error');
        return;
    }
    setAuthError('', 'change-password-error');
    const button = $('change-password-submit');
    setButtonLoading(button, true, 'Saving...');
    try {
        const result = await window.electron.auth.changePassword({
            currentPassword,
            newPassword
        });
        if (result?.success) {
            $('change-password-form')?.reset();
            setAuthError('Password updated successfully.', 'change-password-error', true);
            setTimeout(() => {
                hideChangePasswordModal();
                setAuthError('', 'change-password-error');
            }, 1200);
        } else if (result?.error) {
            setAuthError(result.error, 'change-password-error');
        }
    } catch (error) {
        setAuthError(error?.message || 'Unable to change password.', 'change-password-error');
    } finally {
        setButtonLoading(button, false);
    }
}

function setupAuthUI() {
    if (authUiReady) return;
    authUiReady = true;
    $('signin-form')?.addEventListener('submit', handleSignIn);
    $('signup-form')?.addEventListener('submit', handleSignUp);
    setupPasswordToggles();
    $('signup-password')?.addEventListener('input', updateSignupPasswordChecks);
    $('signup-confirm-password')?.addEventListener('input', updateSignupPasswordChecks);
    $('signup-form')?.addEventListener('reset', () => setTimeout(updateSignupPasswordChecks, 0));
    $('auth-tab-signin')?.addEventListener('click', () => setActiveAuthTab('signin'));
    $('auth-tab-signup')?.addEventListener('click', () => setActiveAuthTab('signup'));
    $('signout-btn')?.addEventListener('click', handleSignOut);
    $('change-password-btn')?.addEventListener('click', showChangePasswordModal);
    $('change-password-cancel')?.addEventListener('click', hideChangePasswordModal);
    $('change-password-form')?.addEventListener('submit', handleChangePassword);
    $('signin-btn')?.addEventListener('click', showAuthModal);
    $('auth-dismiss')?.addEventListener('click', hideAuthModal);
    $('account-info-btn')?.addEventListener('click', showAccountInfo);
    $('auth-account-info')?.addEventListener('click', showAccountInfo);
    $('account-info-close')?.addEventListener('click', hideAccountInfo);
    $('account-info-create')?.addEventListener('click', showCreateAccountFromInfo);
    $('auth-resend')?.addEventListener('click', handleResendVerification);
    $('auth-forgot')?.addEventListener('click', handleForgotPassword);
    setActiveAuthTab('signin');
}

async function refreshAuthStatus() {
    let status = null;
    try {
        status = await window.electron.auth.status();
    } catch (error) {
        status = { authenticated: false, mock: false, api: false };
    }

    mockAuthEnabled = Boolean(status?.mock);
    apiAuthEnabled = Boolean(status?.api);

    if (mockAuthEnabled && !status?.authenticated) {
        showAuthModal();
        updateSessionEmail('');
        return;
    }

    hideAuthModal();
    if (!status?.authenticated) hideChangePasswordModal();
    updateSessionEmail(status?.authenticated ? status?.user?.email || '' : '');
    await ensureLauncherInitialized();
    updateEmbeddedPage();
}

async function ensureLauncherInitialized() {
    if (launcherInitialized) return;
    launcherInitialized = true;
    await initializeLauncher();
}

/**
 * Properties object used for client versioning, etc.
 * @typedef {{client: string, launcher_html: string, launcher: string, version_pref: string}} MicrobotProperties
 */

async function openClient() {
    const clientValue = document.getElementById('client').value;

    // Check if a valid client version is selected
    if (
        !clientValue ||
        clientValue === '' ||
        !clientValue.includes('microbot-')
    ) {
        window.electron.errorAlert('Please select a valid client version');
        return;
    }

    const version = extractVersion(clientValue);

    const result = await downloadClientIfNotExist(version);
    if (!result.exists) return;

    const proxy = getProxyValues();
    const ramPreference = getClientRamPreference();
    const hwidSpoof = getHwidSpoofPreference();

    document.getElementById('loader-container').style.display = 'none';

    // Get the select element by its ID
    const selectElement = document.getElementById('character');

    // Get the selected value
    const selectedValue = selectElement.value;

    const selectedAccount = accounts?.find(
        (x) => x.accountId === selectedValue
    );
    if (selectedAccount) {
        try {
            const result = await window.electron.updateClientJarTTL(version);
            if (result?.error) {
                window.electron.logError(result.error);
            }
            await window.electron.overwriteCredentialProperties(
                selectedAccount
            );
            const launchResult = await window.electron.openClient(
                version,
                proxy,
                selectedAccount,
                ramPreference,
                hwidSpoof
            );
            if (launchResult?.error) {
                window.electron.errorAlert(launchResult.error);
            }
        } catch (err) {
            window.electron.errorAlert(err?.message || String(err));
        }
    } else {
        alert('Account not found. Please restart your client.');
    }
}

window.electron.ipcRenderer.receive('progress', (event, data) => {
    if (data) {
        updateProgress(data.percent, data.status);
    }
});

let launcherUpdateState = null;
let launcherUpdateVersion = '';

window.electron.ipcRenderer.receive('launcher-update', (event, status) => {
    const banner = document.getElementById('launcher-update-banner');
    if (!banner) {
        return;
    }
    // A failed background check (offline, no feed) stays silent; only failures after the banner appeared show.
    if (status.state === 'error' && !launcherUpdateState) {
        return;
    }
    launcherUpdateState = status.state;
    launcherUpdateVersion = status.version || launcherUpdateVersion;
    const percent = status.percent ?? 0;
    const [text, button] = {
        available: [`Launcher out of date (v${status.current})`, `Update to v${launcherUpdateVersion}`],
        downloading: [`Downloading v${launcherUpdateVersion}… ${percent}%`, 'Downloading'],
        ready: [`v${launcherUpdateVersion} is ready to install`, 'Restart now'],
        error: ['Launcher update failed', 'Retry']
    }[status.state];
    banner.hidden = false;
    banner.dataset.state = status.state;
    // Hold screen-reader announcements until the download settles instead of reading every percent.
    banner.setAttribute('aria-busy', status.state === 'downloading');
    banner.style.setProperty('--progress', `${status.state === 'downloading' ? percent : 0}%`);
    document.getElementById('launcher-update-text').textContent = text;
    const btn = document.getElementById('launcher-update-btn');
    btn.textContent = button;
    btn.disabled = status.state === 'downloading';
});

document.getElementById('launcher-update-btn')?.addEventListener('click', () => {
    if (launcherUpdateState === 'ready') {
        window.electron.ipcRenderer.invoke('launcher-update:install').catch(() => {});
    } else {
        launcherUpdateState = 'downloading';
        // Failures reach the banner through the 'error' status event.
        window.electron.ipcRenderer.invoke('launcher-update:download').catch(() => {});
    }
});

function updateProgress(percent, status) {
    const progressBar = document.getElementById('progress-bar');
    const statusText = document.getElementById('status');

    progressBar.style.width = percent + '%';
    progressBar.textContent = percent + '%';
    statusText.textContent = status;
}

function reportAccountsError(message) {
    if (!message) {
        return;
    }

    if (lastAccountsReadError === message) {
        window.electron?.logError?.(message);
        return;
    }

    lastAccountsReadError = message;
    window.electron?.errorAlert?.(message);
}

async function safeReadAccounts() {
    const result = await window.electron.readAccounts();
    if (result?.error) {
        reportAccountsError(`Failed to load accounts: ${result.error}`);
        return null;
    }

    if (!Array.isArray(result)) {
        reportAccountsError('Accounts data is in an unexpected format.');
        return null;
    }

    lastAccountsReadError = null;
    // Sort alphabetically by displayName (case-insensitive); fallback to accountId
    try {
        result.sort((a, b) => {
            const nameA = (a?.displayName || a?.accountId || '').toString().trim().toLowerCase();
            const nameB = (b?.displayName || b?.accountId || '').toString().trim().toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
        });
    } catch (_) {
        // Ignore sort errors
    }
    return result;
}

/**
 * Gets the selected client version from the UI.
 * @returns {string} The selected client version string.
 */
function getSelectedClientVersion() {
    const clientSelect = document.getElementById('client');
    return extractVersion(clientSelect.value);
}

const CANCEL_LOGIN_TEXT = 'Cancel login';
let jagexLoginButton = null;

const HIDE_PROXY_LOGIN_INFO = 'hide_proxy_login_info';
let hideProxyLoginInfo = false;
let proxyLoginInfoShown = false;
let proxyLoginInfoOpen = null;

function showProxyLoginInfo() {
    const modal = document.getElementById('proxy-login-info-modal');
    const okButton = document.getElementById('proxy-login-info-ok');
    if (!modal || !okButton) return Promise.resolve();
    modal.classList.remove('auth-hidden');
    okButton.focus();
    return new Promise((resolve) => {
        okButton.addEventListener(
            'click',
            async () => {
                modal.classList.add('auth-hidden');
                if (document.getElementById('proxy-login-info-hide')?.checked) {
                    hideProxyLoginInfo = true;
                    const properties = await window.electron.readProperties();
                    properties[HIDE_PROXY_LOGIN_INFO] = true;
                    await window.electron.writeProperties(properties);
                }
                resolve();
            },
            { once: true }
        );
    });
}

function maybeShowProxyLoginInfo() {
    if (proxyLoginInfoOpen) return proxyLoginInfoOpen;
    if (proxyLoginInfoShown || hideProxyLoginInfo || getProxyValues().proxyIp.trim() === '') {
        return null;
    }
    proxyLoginInfoShown = true;
    proxyLoginInfoOpen = showProxyLoginInfo().finally(() => {
        proxyLoginInfoOpen = null;
    });
    return proxyLoginInfoOpen;
}

async function runJagexLogin(button) {
    if (jagexLoginButton) {
        if (jagexLoginButton === button) {
            button.classList.add('disabled');
            await window.electron.cancelAuthFlow();
        }
        return;
    }
    const proxyLoginInfo = maybeShowProxyLoginInfo();
    if (proxyLoginInfo) {
        await proxyLoginInfo;
        if (jagexLoginButton) return;
    }
    jagexLoginButton = button;
    const originalText = button.textContent;
    button.textContent = CANCEL_LOGIN_TEXT;
    button.title = 'Finish logging in to Jagex in your browser, or click to cancel.';
    try {
        const authResult = await window.electron.startAuthFlow(getProxyValues());
        if (authResult?.error) {
            window.electron.errorAlert(authResult.error);
        }
    } catch (err) {
        window.electron.errorAlert(err?.message || String(err));
    } finally {
        jagexLoginButton = null;
        if (button.textContent === CANCEL_LOGIN_TEXT) {
            button.textContent = originalText;
        }
        button.removeAttribute('title');
        button.classList.remove('disabled');
    }
}

/**
 * Handles the play button click event of Jagex account
 */
async function playButtonClickHandler() {
    const playBtn = document.getElementById('play');
    if (jagexLoginButton === playBtn) {
        await runJagexLogin(playBtn);
        return;
    }
    await checkForOutdatedLaunch();

    if (
        playBtn?.innerText.toLowerCase() ===
        'Play With Jagex Account'.toLowerCase()
    ) {
        await openClient();
    } else if (playBtn) {
        await runJagexLogin(playBtn);
    }
}

/**
 * Helper function to update character select and trigger profile update
 * @param {string} accountId - The account ID to select
 * @param {{suppressRender?: boolean}} [options] - Optional flags
 * @returns {void}
 */
function updateCharacterSelection(accountId, options = {}) {
    const characterSelect = document.getElementById('character');
    if (characterSelect) {
        characterSelect.value = accountId;
        // Manually dispatch a change event to trigger the onChange handler
        const changeEvent = new Event('change');
        characterSelect.dispatchEvent(changeEvent);
    }

    if (!options?.suppressRender) {
        renderAccountsList();
    }
}

async function handleJagexAccountLogic(properties) {
    setInterval(async () => {
        const hasChanged = await window.electron.checkFileChange();
        if (hasChanged) {
            const oldNumberOfAccounts = accounts.length;
            const latestAccounts = await safeReadAccounts();
            if (!latestAccounts) {
                return;
            }
            accounts = latestAccounts;
            const newNumberOfAccounts = accounts.length;

            const selectedProfile = document.getElementById('profile')?.value;
            const selectedCharacter =
                document.getElementById('character')?.value;

            // If accounts were deleted externally, ensure UI is updated properly
            if (oldNumberOfAccounts > 0 && newNumberOfAccounts === 0) {
                window.electron.logError(
                    'All accounts were removed externally'
                );
                // Force UI update for removed accounts
                document.getElementById('play').innerHTML =
                    'Login Jagex Account';
            }

            await setupSidebarLayout(accounts.length);

            const orderedClientJars = await orderClientJarsByVersion();
            populateSelectElement('client', orderedClientJars);
            populateProfileSelector(
                await window.electron.listProfiles(),
                selectedProfile
            );
            await setVersionPreference(properties);

            if (newNumberOfAccounts === 0) {
                /**
                 * All accounts were removed
                 * Profile will be updated by setupSidebarLayout
                 * which calls populateAccountSelector with empty accounts
                 */
                await updateProfileBasedOnCharacter();
            } else if (oldNumberOfAccounts !== newNumberOfAccounts) {
                const latestAccount = accounts[0];
                if (latestAccount) {
                    updateCharacterSelection(latestAccount.accountId);
                }
            } else {
                // Check if the selectedCharacter still exists in the accounts array
                const characterExists = accounts.some(
                    (acc) => acc.accountId === selectedCharacter
                );
                if (characterExists) {
                    updateCharacterSelection(selectedCharacter);
                } else if (accounts.length > 0) {
                    // If character no longer exists but there are accounts, select the first one
                    window.electron.logError(
                        'Selected character no longer exists, selecting first available'
                    );
                    updateCharacterSelection(accounts[0].accountId);
                }
            }
            // Attempt to restore persisted selection after any file change
            await restoreSelectedAccountIfAny();
        }
    }, 1000);
}

window.onerror = function myErrorHandler(errorMsg) {
    alert(`Error occurred: ${errorMsg}`);
    window.electron.logError(errorMsg);
    return false;
};
window.addEventListener('error', function (e) {
    if (e.error) {
        alert(`Error occurred: ${e.error.stack}`);
        window.electron.logError(e.error.stack);
    } else if (e.reason) {
        alert(`Error occurred: ${e.reason.stack}`);
        window.electron.logError(e.reason.stack);
    }
    return false;
});

window.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
    alert(`Error occurred: ${e.reason.stack}`);
    window.electron.logError(e.reason.stack);
});

async function initializeLauncher() {
    const properties = await window.electron.readProperties();

    const clientVersion = rememberLatestClientVersion(
        await window.electron.fetchClientVersion()
    );

    const microbotLauncherVersion = await window.electron.launcherVersion();

    document.querySelector('.titlebar-title').innerText =
        'Microbot Launcher - ' + microbotLauncherVersion;

    if (properties['client'] === '0.0.0') {
        document.getElementById('loader-container').style.display = 'block';
        const result = await window.electron.downloadClient(clientVersion);
        if (result?.error) {
            window.electron.errorAlert(result.error);
            properties['client'] = '0.0.0';
        } else {
            properties['client'] = clientVersion;
        }
    }

    document.getElementById('loader-container').style.display = 'none';

    await window.electron.writeProperties(properties);

    const result = await window.electron.cleanUnusedClients(clientVersion);
    if (result?.error) {
        window.electron.logError(result.error);
    }

    /*
     * Whenever the profile select changes, we set the "preferred" profile on accounts.json
     * for the current selected account, if no jagex account is selected, we set on
     * the non-jagex-preferred-profile.json
     */
    document
        .getElementById('profile')
        .addEventListener('change', async (event) => {
            const selectedProfile = event.target.value;
            const selectedAccount = document.getElementById('character')?.value;
            if (selectedAccount && selectedAccount !== 'none') {
                await window.electron.setProfileJagexAccount(
                    selectedAccount,
                    selectedProfile
                );
            } else {
                await window.electron.setProfileNoJagexAccount(selectedProfile);
            }
        });

    /*
     * Whenever the character select changes, we attempt to set the "preferred" profile
     * for the selected account if it exists, otherwise we set the profile
     * to the default
     */
    document
        .getElementById('character')
        .addEventListener('change', async (event) => {
            const selectedAccount = event.target.value;
            const latestAccounts = await safeReadAccounts();
            if (latestAccounts) {
                accounts = latestAccounts;
            }
            const accountsData = latestAccounts ?? accounts;

            if (selectedAccount && selectedAccount !== 'none') {
                const account = accountsData.find(
                    (x) => x.accountId === selectedAccount
                );
                if (account) {
                    const profile = account.profile || 'default';
                    document.getElementById('profile').value = profile;
                    await applyAccountProxy(account);
                }
            } else {
                // If no account is selected, set the profile to the preferred non-Jagex account profile
                // If no profile is set, default to "default"
                const nonJagexProfile =
                    await window.electron.readNonJagexProfile();
                const profile = nonJagexProfile || 'default';
                document.getElementById('profile').value = profile;
            }
            if (!restoringSelectedAccount) {
                await persistSelectedAccount(selectedAccount);
            }
        });

    //Init buttons and UI
    await initUI(properties);

    await checkForClientUpdate(properties);

    iii = setInterval(async () => {
        const properties = await window.electron.readProperties();
        await checkForClientUpdate(properties);
    }, 5 * 60 * 1000); // 5 minutes

    await handleJagexAccountLogic(properties);

    document.querySelectorAll('.loadingButton').forEach((button) => {
        button.addEventListener('click', startLoading);
    });

    loadLandingPageWebview();

    await window.maybeShowSetupGuide?.();
}

window.addEventListener('load', async () => {
    setupAuthUI();
    window.electron.ipcRenderer.receive('auth:changed', () => refreshAuthStatus());
    await refreshAuthStatus();
});

function populateSelectElement(selectId, options) {
    const selectElement = document.getElementById(selectId);

    // Clear any existing options
    selectElement.innerHTML = '';

    // Add each option from the array to the select element
    options.forEach((optionText) => addSelectElement(selectId, optionText));
}

function addSelectElement(selectId, option) {
    // Get the select element by its ID
    const selectElement = document.getElementById(selectId);

    // Create a new option element
    const newOption = document.createElement('option');

    // Set the value and text of the new option
    if (option && typeof option === 'object') {
        newOption.value = option.file;
        newOption.text = option.label || option.file;
        newOption.title = option.file;
    } else {
        newOption.value = option;
        newOption.text = option;
    }

    // Add the new option to the select element
    selectElement.appendChild(newOption);
}

function populateProfileSelector(profiles = [], selectedProfile = null) {
    // Get the select element by its ID
    const profileSelect = document.getElementById('profile');

    // Clear any existing options (optional)
    profileSelect.innerHTML = '';

    // Create a default "default" option
    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = 'Default';
    profileSelect.appendChild(defaultOption);

    // Only try to populate if profiles are available and not empty
    if (Array.isArray(profiles) && profiles.length > 0) {
        profiles.forEach((profile) => {
            addSelectElement('profile', profile);
        });
    }

    if (selectedProfile) {
        profileSelect.value = selectedProfile;
    }
}

function populateAccountSelector(characters = [], selectedAccount = null) {
    // Get the select element by its ID
    const characterSelect = document.getElementById('character');

    // Clear any existing options (optional)
    characterSelect.innerHTML = '';

    // Create a default "none" option
    const defaultOption = document.createElement('option');
    defaultOption.value = 'none';
    defaultOption.textContent = 'None';
    characterSelect.appendChild(defaultOption);

    // Iterate over the characters array and create option elements
    characters.forEach((character) => {
        const option = document.createElement('option');
        option.value = character.accountId; // Set sessionId as the value
        option.textContent = character.displayName; // Set displayName as the text
        characterSelect.appendChild(option); // Add the option to the select element
    });

    if (selectedAccount) {
        updateCharacterSelection(selectedAccount, { suppressRender: true });
    }
}

function renderAccountsList() {
    const listContainer = document.getElementById(
        'accounts-dropdown-container'
    );
    if (!listContainer) {
        return;
    }

    listContainer.innerHTML = '';

    if (typeof cleanupAccountsDropdownListeners === 'function') {
        cleanupAccountsDropdownListeners();
        cleanupAccountsDropdownListeners = null;
    }

    if (!Array.isArray(accounts) || accounts.length === 0) {
        listContainer.style.display = 'none';
        return;
    }

    listContainer.style.display = 'block';

    const dropdown = document.createElement('div');
    dropdown.className = 'accounts-dropdown';

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'accounts-dropdown-toggle';
    toggleButton.setAttribute('aria-haspopup', 'listbox');
    toggleButton.setAttribute('aria-expanded', 'false');

    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'accounts-dropdown-label';

    const countBadge = document.createElement('span');
    countBadge.className = 'accounts-dropdown-count';
    countBadge.textContent = String(accounts.length);

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'accounts-dropdown-icon';
    toggleIcon.setAttribute('aria-hidden', 'true');
    toggleIcon.textContent = '▾';

    const characterSelect = document.getElementById('character');
    const initialSelectedValue = characterSelect?.value || 'none';
    let currentSelectedValue = initialSelectedValue;

    const getAccountLabel = (account) => {
        const label = account?.displayName?.trim();
        return label && label.length > 0 ? label : 'Not set';
    };

    const updateToggleLabel = (value) => {
        if (value === 'none') {
            toggleLabel.textContent = 'None';
            toggleButton.setAttribute('aria-label', 'No Jagex account selected');
            toggleButton.title = 'No Jagex account selected';
            return;
        }

        const matchingAccount = accounts.find(
            (account) => account.accountId === value
        );

        if (matchingAccount) {
            const label = getAccountLabel(matchingAccount);
            toggleLabel.textContent = label;
            toggleButton.setAttribute('aria-label', `Selected ${label}`);
            toggleButton.title = `Selected ${label}`;
        } else {
            toggleLabel.textContent = 'Select Jagex account';
            toggleButton.setAttribute('aria-label', 'Select a Jagex account');
            toggleButton.title = 'Select a Jagex account';
        }
    };

    updateToggleLabel(currentSelectedValue);

    toggleButton.append(toggleLabel, countBadge, toggleIcon);

    const panel = document.createElement('div');
    panel.className = 'accounts-dropdown-panel';
    panel.setAttribute('role', 'listbox');

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'accounts-search-wrapper';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'accounts-search-input';
    searchInput.placeholder = 'Search accounts…';
    searchInput.setAttribute('aria-label', 'Search saved accounts');

    searchWrapper.appendChild(searchInput);

    const optionsList = document.createElement('div');
    optionsList.className = 'accounts-options';

    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'accounts-options-empty';
    emptyMessage.textContent = 'No accounts match your search.';

    const closeDropdown = () => {
        dropdown.classList.remove('open');
        toggleButton.setAttribute('aria-expanded', 'false');
        searchInput.value = '';
    };

    const setSelectedAccount = (value) => {
        currentSelectedValue = value;
        updateToggleLabel(value);
        updateCharacterSelection(value, { suppressRender: true });
        closeDropdown();
        toggleButton.focus();
    };

    const createNoneOption = () => {
        const optionRow = document.createElement('div');
        optionRow.className = 'account-option';
        optionRow.setAttribute('role', 'option');
        if (currentSelectedValue === 'none') {
            optionRow.classList.add('selected');
            optionRow.setAttribute('aria-selected', 'true');
        } else {
            optionRow.setAttribute('aria-selected', 'false');
        }

        const nameButton = document.createElement('button');
        nameButton.type = 'button';
        nameButton.className = 'account-option-name';
        nameButton.textContent = 'None';
        nameButton.title = 'Use no Jagex account';
        nameButton.addEventListener('click', () => {
            setSelectedAccount('none');
        });

        optionRow.appendChild(nameButton);
        return optionRow;
    };

    const createAccountOption = (account) => {
        const optionRow = document.createElement('div');
        optionRow.className = 'account-option';
        optionRow.setAttribute('role', 'option');
        optionRow.dataset.accountId = account.accountId;

        if (account.accountId === currentSelectedValue) {
            optionRow.classList.add('selected');
            optionRow.setAttribute('aria-selected', 'true');
        } else {
            optionRow.setAttribute('aria-selected', 'false');
        }

        const label = getAccountLabel(account);

        const nameButton = document.createElement('button');
        nameButton.type = 'button';
        nameButton.className = 'account-option-name';
        nameButton.textContent = label;
        nameButton.title = `Select ${label}`;
        nameButton.addEventListener('click', () => {
            setSelectedAccount(account.accountId);
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'account-option-delete';
        deleteButton.dataset.accountId = account.accountId;
        deleteButton.title = `Delete ${label}`;
        deleteButton.setAttribute('aria-label', `Delete ${label}`);
        deleteButton.innerHTML =
            '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>';
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            closeDropdown();
            await handleAccountDelete(account.accountId);
        });

        optionRow.append(nameButton, deleteButton);
        return optionRow;
    };

    const renderOptions = (filterText = '') => {
        optionsList.innerHTML = '';
        const normalizedFilter = filterText.trim().toLowerCase();
        let visibleCount = 0;

        const shouldShowNone =
            normalizedFilter.length === 0 ||
            'none'.includes(normalizedFilter);

        if (shouldShowNone) {
            optionsList.appendChild(createNoneOption());
            visibleCount += 1;
        }

        accounts.forEach((account) => {
            const displayName = getAccountLabel(account).toLowerCase();
            if (
                normalizedFilter &&
                !displayName.includes(normalizedFilter)
            ) {
                return;
            }

            optionsList.appendChild(createAccountOption(account));
            visibleCount += 1;
        });

        if (visibleCount === 0) {
            optionsList.appendChild(emptyMessage.cloneNode(true));
        }
    };

    const fitDropdownToBoundary = () => {
        const boundary = (dropdown.closest('.sidebar') || document.body).getBoundingClientRect();
        const rect = dropdown.getBoundingClientRect();
        const edgeGap = 12;
        const spaceBelow = boundary.bottom - rect.bottom - edgeGap;
        const spaceAbove = rect.top - boundary.top - edgeGap;
        const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
        const room = openUp ? spaceAbove : spaceBelow;
        dropdown.classList.toggle('open-up', openUp);
        optionsList.style.maxHeight = `${Math.max(120, Math.min(240, room - searchWrapper.offsetHeight - 12))}px`;
    };

    const openDropdown = () => {
        dropdown.classList.add('open');
        toggleButton.setAttribute('aria-expanded', 'true');
        renderOptions(searchInput.value);
        fitDropdownToBoundary();
        requestAnimationFrame(() => {
            searchInput.focus();
        });
    };

    toggleButton.addEventListener('click', () => {
        if (dropdown.classList.contains('open')) {
            closeDropdown();
        } else {
            openDropdown();
        }
    });

    searchInput.addEventListener('input', (event) => {
        renderOptions(event.target.value);
    });

    const handleOutsideClick = (event) => {
        if (!dropdown.contains(event.target)) {
            closeDropdown();
        }
    };

    const handleEscapeKey = (event) => {
        if (event.key === 'Escape') {
            if (dropdown.classList.contains('open')) {
                closeDropdown();
                toggleButton.focus();
            }
        }
    };

    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleEscapeKey);

    cleanupAccountsDropdownListeners = () => {
        document.removeEventListener('click', handleOutsideClick);
        document.removeEventListener('keydown', handleEscapeKey);
    };

    panel.append(searchWrapper, optionsList);
    dropdown.append(toggleButton, panel);
    listContainer.appendChild(dropdown);
}

async function handleAccountDelete(accountId) {
    if (!accountId) {
        return;
    }

    const account = accounts.find((acc) => acc.accountId === accountId);
    if (!account) {
        window.electron.errorAlert('Account not found.');
        return;
    }

    const confirmation = await window.electron.showConfirmationDialog(
        'Delete account?',
        'This will permanently remove this account. This action cannot be undone.',
        'Delete account?',
        'Cancel',
        'Delete',
        {
            defaultId: 0,
            cancelId: 0,
            confirmIndex: 1
        }
    );

    if (typeof confirmation !== 'boolean') {
        if (confirmation?.error) {
            window.electron.errorAlert(
                `Failed to confirm deletion: ${confirmation.error}`
            );
        }
        return;
    }

    if (!confirmation) {
        return;
    }

    const result = await window.electron.deleteAccount(accountId);
    if (result?.error) {
        window.electron.errorAlert(
            `Failed to delete account: ${result.error}`
        );
        return;
    }

    const updatedAccounts = await safeReadAccounts();
    if (!updatedAccounts) {
        return;
    }

    accounts = updatedAccounts;
    await setupSidebarLayout(accounts.length);
    await updateProfileBasedOnCharacter();
}

async function removeAccountsHandler() {
    const userConfirmed = confirm('Are you sure you want to proceed?');
    if (!userConfirmed) return;

    // Remove accounts via the Electron API
    await window.electron.removeAccounts();

    // Update the global accounts array
    accounts = [];

    // Reset UI to show no accounts state
    await setupSidebarLayout(0);

    // Update the profile to non-Jagex profile or default
    await updateProfileBasedOnCharacter();

    // Update the play button text
    document.getElementById('play').innerHTML = 'Login Jagex Account';
}

function setupLogoutButton() {
    const logoutBtn = document.getElementById('logout');
    logoutBtn?.removeEventListener('click', removeAccountsHandler);
    logoutBtn?.addEventListener('click', removeAccountsHandler);
}

async function setupSidebarLayout(amountOfAccounts) {
    const selectedAccount = document.getElementById('character')?.value;
    const playJagexButton = document.getElementById('play');
    const playButtonsDiv = document.querySelector('.play-buttons');
    const logoutButton = document.getElementById('logout');
    const addAccountsButton = document.getElementById('add-accounts');
    const characterSelectLabel = document.querySelector(
        'label[for="character"]'
    );
    const accountsDropdownContainer = document.getElementById(
        'accounts-dropdown-container'
    );

    if (amountOfAccounts > 0) {
        playJagexButton.innerHTML = 'Play With Jagex Account';
        logoutButton.style.display = 'block';
        playButtonsDiv.style.display = 'flex';
        if (characterSelectLabel) {
            characterSelectLabel.style.display = 'block';
        }
        if (accountsDropdownContainer) {
            accountsDropdownContainer.style.display = 'block';
        }
        addAccountsButton.style.display = 'block';
        populateAccountSelector(accounts, selectedAccount);
        const accountStillExists = accounts.some(
            (acc) => acc.accountId === selectedAccount
        );
        if (!accountStillExists) {
            if (accounts.length > 0) {
                updateCharacterSelection(accounts[0].accountId, {
                    suppressRender: true
                });
            } else {
                updateCharacterSelection('none', { suppressRender: true });
            }
        }
        // Note: populateAccountSelector uses updateCharacterSelection which
        // triggers the profile update via the change event
        setupLogoutButton();
        setupAddAccountsButton();
    } else {
        // Reset UI for no accounts state
        playJagexButton.innerHTML = 'Login Jagex Account';
        logoutButton.style.display = 'none';
        playButtonsDiv.style.display = 'block';
        if (characterSelectLabel) {
            characterSelectLabel.style.display = 'none';
        }
        if (accountsDropdownContainer) {
            accountsDropdownContainer.style.display = 'none';
        }
        addAccountsButton.style.display = 'none';

        // Clear character selector and make sure 'none' is selected
        populateAccountSelector([], 'none');

        // Also update the profile to use non-Jagex profile or default
        updateProfileBasedOnCharacter();
    }

    renderAccountsList();
}

async function addAccountsHandler() {
    await runJagexLogin(document.getElementById('add-accounts'));
}

function setupAddAccountsButton() {
    const addAccountsButton = document.getElementById('add-accounts');
    addAccountsButton?.removeEventListener('click', addAccountsHandler);
    addAccountsButton?.addEventListener('click', addAccountsHandler);
}

function setupRefreshAccountsButton() {
    const refreshBtn = document.getElementById('refresh-accounts');
    if (!refreshBtn) return;
    refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        try {
            const result = await window.electron.refreshAccounts(getProxyValues());
            if (result?.error) {
                window.electron.errorAlert(result.error);
                return;
            }
            const updated = result?.accounts;
            if (Array.isArray(updated)) {
                // Sort updated accounts alphabetically
                accounts = [...updated].sort((a, b) => {
                    const nameA = (a?.displayName || a?.accountId || '').toString().trim().toLowerCase();
                    const nameB = (b?.displayName || b?.accountId || '').toString().trim().toLowerCase();
                    if (nameA < nameB) return -1;
                    if (nameA > nameB) return 1;
                    return 0;
                });
                await setupSidebarLayout(accounts.length);
                await updateProfileBasedOnCharacter();
                await restoreSelectedAccountIfAny();
            } else {
                // fallback: re-read accounts via existing flow
                const latestAccounts = await safeReadAccounts();
                if (latestAccounts) {
                    accounts = latestAccounts; // already sorted in safeReadAccounts
                    await setupSidebarLayout(accounts.length);
                    await updateProfileBasedOnCharacter();
                    await restoreSelectedAccountIfAny();
                }
            }
            if (result?.warning) {
                window.electron.errorAlert(result.warning);
            }
        } catch (err) {
            window.electron.errorAlert(err?.message || String(err));
        } finally {
            refreshBtn.disabled = false;
        }
    });
}

/**
 * Extracts the version number from a string.
 * e.g., "microbot-1.9.6.1.jar" becomes "1.9.6.1"
 * @param {string} versionString - The string containing the version.
 * @returns {string} The extracted version number.
 */
function extractVersion(versionString) {
    const s = String(versionString ?? '');
    return s.replace(/^microbot-/, '').replace(/\.jar$/, '');
}

/**
 * Setup play button for launching without Jagex account
 *
 * First checks for the attempt of launching an outdated version of the client.
 * If for some reason the client selected doesn't exist, it will trigger a download.
 */
function playNoJagexAccount() {
    const playNoJagexButton = document.getElementById('play-no-jagex-account');
    playNoJagexButton?.removeEventListener('click', playButtonClickHandler);
    playNoJagexButton?.addEventListener('click', async () => {
        await checkForOutdatedLaunch();

        const proxy = getProxyValues();
        const ramPreference = getClientRamPreference();
        const hwidSpoof = getHwidSpoofPreference();
        const selectedVersion = document.getElementById('client').value;

        // Check if a valid client version is selected
        if (
            !selectedVersion ||
            selectedVersion === '' ||
            !selectedVersion.includes('microbot-')
        ) {
            window.electron.errorAlert('Please select a valid client version');
            return;
        }

        const version = extractVersion(selectedVersion);

        const selectedProfile =
            document.getElementById('profile').value || 'default';
        await window.electron.setProfileNoJagexAccount(selectedProfile);
        const result = await downloadClientIfNotExist(version);
        if (result?.exists) {
            try {
                const result = await window.electron.updateClientJarTTL(
                    version
                );
                if (result?.error) {
                    window.electron.logError(result.error);
                }
                const playResult = await window.electron.playNoJagexAccount(
                    version,
                    proxy,
                    ramPreference,
                    hwidSpoof
                );
                if (playResult?.error) {
                    window.electron.errorAlert(playResult.error);
                }
            } catch (err) {
                window.electron.errorAlert(err?.message || String(err));
            }
        }
    });
}

/**
 * Checks if the client exists, and downloads it if it doesn't.
 *
 * @async
 * @param {*} version
 * @returns {Promise<{exists: boolean}>}
 */
async function downloadClientIfNotExist(version) {
    if (!(await window.electron.clientExists(version))) {
        window.electron.logError(
            `Client ${version} does not exist. Downloading...`
        );
        document.getElementById('loader-container').style.display = 'block';

        /** @type {{success: boolean, error?: string, path?: string}} */
        const result = await window.electron.downloadClient(version);
        if (result?.error) {
            window.electron.errorAlert(result.error);
            return { exists: false };
        }
    }
    window.electron.logError(`Client ${version} is ready.`);
    await populateAndSelectClientVersion(version);
    return { exists: true };
}

function updateNowBtn() {
    document
        .querySelector('#update-now-btn')
        .addEventListener('click', async () => {
            if (iii) clearInterval(iii);
            document.querySelector('#update-available').style = 'display:none';
            document.getElementById('loader-container').style.display = 'block';
            const clientVersion = rememberLatestClientVersion(
                await window.electron.fetchClientVersion()
            );
            const result = await window.electron.downloadClient(clientVersion);
            if (result?.error) {
                window.electron.errorAlert(result.error);
                document.getElementById('loader-container').style.display =
                    'none';
                return;
            }

            await populateAndSelectClientVersion(clientVersion);

            // Update client field in properties to the latest version
            const properties = await window.electron.readProperties();
            properties['client'] = clientVersion;
            await window.electron.writeProperties(properties);

            document.getElementById('loader-container').style.display = 'none';
        });
}

/**
 * Populate and select client version
 *
 * @async
 * @param {string} version
 */
async function populateAndSelectClientVersion(version) {
    // Extract the version
    version = extractVersion(version);

    // Refresh client versions list after download
    const orderedClientJars = await orderClientJarsByVersion();
    populateSelectElement('client', orderedClientJars);

    // Set the newly downloaded version as the selected value
    await selectClientVersion(version);
}

/**
 * Select client version select element value
 *
 * @async
 * @param {string} version - The version to select (e.g. "1.9.9.1")
 */
async function selectClientVersion(version) {
    const clientSelect = document.getElementById('client');
    for (let i = 0; i < clientSelect.options.length; i++) {
        if (extractVersion(clientSelect.options[i].value) === version) {
            clientSelect.selectedIndex = i;
            clientSelect.value = clientSelect.options[i].value;
            break;
        }
    }
    await updateVersionPreference({
        target: { value: version }
    });
}

function reminderMeLaterBtn() {
    document
        .querySelector('#remind-me-later-btn')
        .addEventListener('click', async () => {
            document.querySelector('#update-available').style = 'display:none';
        });
}

function getProxyValues() {
    // Get the value of the proxy IP
    return { proxyIp: document.getElementById('proxy-ip')?.value || '' };
}

function getHwidSpoofPreference() {
    const checkbox = document.getElementById('hwid-spoof');
    return checkbox ? checkbox.checked : true;
}

function getClientRamPreference() {
    const ramSelect = document.getElementById('client-ram');
    if (!ramSelect) {
        return DEFAULT_CLIENT_RAM;
    }

    return sanitizeRamPreference(ramSelect.value);
}

function startLoading(event) {
    const button = event.target;
    button.classList.add('loading');

    setTimeout(() => {
        button.classList.remove('loading');
    }, 1000);
}

/**
 * Reads the current preferred version and selects it on the launcher UI.
 *
 * @async
 * @param {*} properties
 */
async function setVersionPreference(properties) {
    if (
        properties &&
        properties['version_pref'] &&
        properties['version_pref'] !== '0.0.0'
    ) {
        await selectClientVersion(properties['version_pref']);
    } else {
        await updateVersionPreference({
            target: { value: document.getElementById('client').value }
        });
    }

    /**
     * Remove any other listeners before adding a new one
     */
    const clientSelect = document.getElementById('client');
    clientSelect.replaceWith(clientSelect.cloneNode(true));

    document
        .getElementById('client')
        .addEventListener('change', async (event) => {
            await updateVersionPreference(event);
        });
}

async function updateVersionPreference(event) {
    const selectedValue = extractVersion(event.target.value);
    const properties = await window.electron.readProperties();
    properties['version_pref'] = selectedValue;
    await window.electron.writeProperties(properties);
}

async function titlebarButtons() {
    document.getElementById('minimize-btn').addEventListener('click', () => {
        window.electron.minimizeWindow();
    });

    document.getElementById('maximize-btn').addEventListener('click', () => {
        window.electron.maximizeWindow();
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        window.electron.closeLauncher();
    });
}

/**
 * Updates the profile selector based on the selected character or default settings
 *
 * @async
 * @returns {Promise<void>}
 */
async function updateProfileBasedOnCharacter() {
    const characterSelect = document.getElementById('character');
    const selectedAccountId = characterSelect?.value;
    const profileSelect = document.getElementById('profile');

    if (
        selectedAccountId &&
        selectedAccountId !== 'none' &&
        accounts.length > 0
    ) {
        const selectedAccount = accounts.find(
            (acc) => acc.accountId === selectedAccountId
        );
        if (selectedAccount && selectedAccount.profile) {
            profileSelect.value = selectedAccount.profile;
        } else {
            // If account exists but has no profile preference, use default
            profileSelect.value = 'default';
        }
    } else {
        // If no account is selected or no accounts exist, use the non-Jagex preferred profile
        const nonJagexProfile = await window.electron.readNonJagexProfile();
        if (nonJagexProfile) {
            profileSelect.value = nonJagexProfile;
        } else {
            // If no non-Jagex profile preference exists, use default
            profileSelect.value = 'default';
        }
    }
}

async function applyAccountProxy(account) {
    if (!document.getElementById('proxy-ip') || typeof account?.proxyIp !== 'string') return;
    const proxyIp = account.proxyIp.trim();
    if (proxyIp === '') return;
    await withProperties(async (properties) => {
        if (properties['proxyip'] === proxyIp) return;
        const proxies = readSavedProxies(properties);
        if (!proxies.some((proxy) => proxy.address === proxyIp)) {
            proxies.push({ name: '', address: proxyIp });
        }
        properties[PROXIES_KEY] = proxies;
        properties['proxyip'] = proxyIp;
        await window.electron.writeProperties(properties);
        renderProxySelect(proxies, proxyIp);
        renderProxyList(proxies, proxyIp);
    });
}

async function persistSelectedAccount(accountId) {
    try {
        const props = await window.electron.readProperties();
        if (!accountId || accountId === 'none') {
            if (props['selected_account']) {
                delete props['selected_account'];
                await window.electron.writeProperties(props);
            }
            return;
        }
        if (props['selected_account'] !== accountId) {
            props['selected_account'] = accountId;
            await window.electron.writeProperties(props);
        }
    } catch (err) {
        window.electron.logError(`Failed to persist selected account: ${err?.message || err}`);
    }
}

async function restoreSelectedAccountIfAny() {
    try {
        const props = await window.electron.readProperties();
        const saved = props['selected_account'];
        if (!saved) return;
        const exists = accounts.some((a) => a.accountId === saved);
        if (!exists) {
            delete props['selected_account'];
            await window.electron.writeProperties(props);
            return;
        }
        restoringSelectedAccount = true;
        updateCharacterSelection(saved, { suppressRender: true });
        restoringSelectedAccount = false;
        await updateProfileBasedOnCharacter();
    } catch (err) {
        window.electron.logError(`Failed to restore selected account: ${err?.message || err}`);
    }
}

async function initUI(properties) {
    updateNowBtn();
    reminderMeLaterBtn();
    titlebarButtons();
    setupHamburgerMenu();

    // Setup play button for non-Jagex accounts
    playNoJagexAccount();

    // Setup play button for Jagex accounts
    const playJagexButton = document.getElementById('play');
    playJagexButton?.removeEventListener('click', playButtonClickHandler);
    playJagexButton?.addEventListener('click', playButtonClickHandler);

    const accountsData = await safeReadAccounts();
    accounts = accountsData ?? [];
    await setupSidebarLayout(accounts.length);
    await restoreSelectedAccountIfAny();

    const orderedClientJars = await orderClientJarsByVersion();
    populateSelectElement('client', orderedClientJars);

    // Get profiles and initialize profile selector
    const profiles = await window.electron.listProfiles();
    populateProfileSelector(profiles, null);

    // Update the profile based on the selected character
    await updateProfileBasedOnCharacter();

    await setVersionPreference(properties);
    document.querySelector('.game-info').style = 'display:block';

    await setupRamInput();
    await setupHwidSpoofInput();
    await setupProxyInput();

    setupRefreshAccountsButton();
}

/**
 * Setup the hamburger menu for the app.
 * Has some functional behavior for showing and hiding the menu
 * depending on user interaction.
 * @returns {void}
 */
function setupHamburgerMenu() {
    const menuBtn = document.getElementById('menu-btn');
    const menu = document.getElementById('app-menu');
    if (!menuBtn || !menu) return;

    const hideMenu = () => {
        if (!menu.classList.contains('hidden')) {
            menu.classList.add('hidden');
            menu.setAttribute('aria-hidden', 'true');
            menu.classList.remove('closing');
        }
    };

    const showMenu = () => {
        menu.classList.remove('hidden');
        menu.setAttribute('aria-hidden', 'false');
    };

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.classList.contains('hidden')) showMenu();
        else hideMenu();
    });

    // if clicked outside we hide the menu
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && e.target !== menuBtn) {
            hideMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideMenu();
    });

    menu.querySelector('[data-action="setup-guide"]')?.addEventListener('click', () => {
        hideMenu();
        window.openSetupGuide?.();
    });

    menu.querySelectorAll('.submenu-item').forEach((item) => {
        item.addEventListener('click', async (e) => {
            const key = item.getAttribute('data-location');
            if (key) {
                const res = await window.electron.openLocation(key);
                if (res?.error) {
                    window.electron.errorAlert(res.error);
                }
            }
            hideMenu();
        });
    });

    let hideTimeout = null;
    const scheduleHide = () => {
        hideTimeout = setTimeout(() => hideMenu(), 200);
    };
    const cancelHide = () => {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
    };

    menu.addEventListener('pointerleave', () => {
        // Mark as closing to keep submenu visible until root hides
        if (!menu.classList.contains('closing')) menu.classList.add('closing');
        scheduleHide();
    });
    menu.addEventListener('pointerenter', () => {
        cancelHide();
        menu.classList.remove('closing');
    });
}

/**
 * Check for client updates and prompt the user if necessary.
 *
 * @async
 * @param {MicrobotProperties} properties - The properties object containing client information.
 */
async function checkForClientUpdate(properties) {
    const clientVersion = rememberLatestClientVersion(
        await window.electron.fetchClientVersion()
    );
    window.electron.logError(
        `Current client version: ${clientVersion}, properties client version: ${properties['client']}`
    );

    /** @type {Array<string>} List of available client jars in the Microbot directory. */
    const listOfJars = await window.electron.listJars();

    if (listOfJars.length === 0) {
        window.electron.logError(
            'No client jars found. Please download a client.'
        );
    } else {
        window.electron.logError(
            `Available client jars: ${listOfJars.join(', ')}`
        );
    }
    if (
        await shouldPromptForClientDownload(
            clientVersion,
            listOfJars,
            properties
        )
    ) {
        document.querySelector('#update-available').style = 'display:flex';
    }
}

const LANDING_PAGE_URL = 'https://www.themicrobot.com?source=launcher';
let embeddedPageReady = false;
let embeddedPageRequest = 0;

/**
 * Show the Microbot dashboard in the embedded webview while signed in, and the landing page otherwise.
 *
 * @param {{reload?: boolean, landing?: boolean}} [options] reload: load the target again even if it is already showing.
 * landing: show the landing page even while signed in.
 */
async function updateEmbeddedPage({ reload = false, landing = false } = {}) {
    const webview = document.getElementById('website');
    if (!webview || !embeddedPageReady) return;
    const request = ++embeddedPageRequest;
    let target = LANDING_PAGE_URL;
    if (!landing && currentSessionEmail && apiAuthEnabled) {
        try {
            const result = await window.electron.dashboard.open();
            if (result?.url) target = result.url;
        } catch (error) {
            console.error('Could not open the dashboard:', error);
        }
    }
    if (request !== embeddedPageRequest) return;
    if (!reload && webview.dataset.target === target) return;
    webview.dataset.target = target;
    webview.src = target;
}

/**
 * Initialize the webview for the embedded site.
 * On the Microbot landing page it manipulates some elements
 * so it looks more integrated with the launcher.
 */
function loadLandingPageWebview() {
    const webview = document.getElementById('website');
    const webviewOverlay = document.getElementById('embed-overlay');
    if (webview) {
        embeddedPageReady = true;
        updateEmbeddedPage();
        window.electron.ipcRenderer.receive('dashboard:reload', () => updateEmbeddedPage({ reload: true }));
        window.electron.ipcRenderer.receive('dashboard:unavailable', () => updateEmbeddedPage({ landing: true }));
        webview.addEventListener('dom-ready', () => {
            // Mirrors the .sidebar scrollbar in css/styles.css; auto width/color lets the webkit rules apply.
            webview
                .insertCSS(
                    `html, body { scrollbar-width: auto !important; scrollbar-color: auto !important; }
                    ::-webkit-scrollbar { width: 10px; height: 10px; }
                    ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
                    ::-webkit-scrollbar-thumb { background-color: #3a2e22; border: 2px solid transparent; border-radius: 5px; background-clip: padding-box; }
                    ::-webkit-scrollbar-thumb:hover { background-color: #e9c98f; }
                    ::-webkit-scrollbar-thumb:active { background-color: #ffb13b; }`
                )
                .catch((err) => console.error('insertCSS failed', err));
            if (!webview.getURL().startsWith('https://www.themicrobot.com')) {
                webviewOverlay?.classList.add('hidden');
                return;
            }
            try {
                webview
                    .executeJavaScript(
                        `(() => {
                            try {
                                const topDiscordHeaderContainer = document.querySelector("body > header > div.c-events-block.py-2 > div");
                                if (topDiscordHeaderContainer) topDiscordHeaderContainer.remove();
                                const topSeparator = document.querySelector("body > header > div.c-border-red.mb-2");
                                if (topSeparator) topSeparator.remove();
                                const cookieBanner = document.getElementById("cookie-banner");
                                if (cookieBanner) cookieBanner.remove();
                                const navContainer = document.querySelector("body > header > nav > div");
                                if (navContainer) navContainer.style.maxWidth = "100%";
                                const bodyHero = document.querySelector("body > main > section.c-main-header.c-main-header--home.py-5.d-flex.flex-column.justify-content-center");
                                if (bodyHero) bodyHero.style.minHeight = "600px";
                            } catch (err) {
                                console.error('Webview DOM manipulation error:', err);
                            }
                            return true; // signal completion
                        })();`
                    )
                    .then(() => {
                        setTimeout(() => {
                            if (webviewOverlay) {
                                webviewOverlay.classList.add('hidden');
                                const removeAfter = () => {
                                    webviewOverlay?.removeEventListener(
                                        'transitionend',
                                        removeAfter
                                    );
                                };
                                webviewOverlay.addEventListener(
                                    'transitionend',
                                    removeAfter
                                );
                            }
                        }, 50);
                    })
                    .catch((err) =>
                        console.error('executeJavaScript failed', err)
                    );
            } catch (injectionError) {
                console.error('Failed to inject into webview:', injectionError);
                if (webviewOverlay) {
                    webviewOverlay.classList.add('hidden');
                }
            }
        });
    }
}

/**
 * Order the client jars by version from latest to oldest.
 *
 * @async
 * @returns {Promise<Array<{file: string, version: string, kind: string, label: string}>>} Ordered client jars: official versions newest first, then custom jars.
 */
async function orderClientJarsByVersion() {
    const clientJars = await window.electron.listClientJars(
        latestClientVersion
    );
    return Array.isArray(clientJars) ? clientJars : [];
}

function rememberLatestClientVersion(version) {
    if (typeof version === 'string' && version) {
        latestClientVersion = version;
    }
    return version;
}

/**
 * Check if the latest client available is installed.
 * If not, make sure it's not written on properties file so it can be prompted
 * for re-download again.
 *
 * @async
 * @param {string} latestClientVersion - The version of the latest client available.
 * @param {Array<string>} installedClientVersions - The list of installed client versions.
 * @param {MicrobotProperties} properties - The properties object to update if necessary.
 * @returns {Promise<boolean>} True if the latest client is installed, false otherwise.
 */
async function shouldPromptForClientDownload(
    latestClientVersion,
    installedClientVersions,
    properties
) {
    const isLatestInstalled = installedClientVersions.some(
        (file) => extractVersion(file) === latestClientVersion
    );
    const isClientVersionOnPropertiesLatest =
        properties['client'] === latestClientVersion;

    // Latest version is installed, set on properties if not already set
    if (isLatestInstalled) {
        if (!isClientVersionOnPropertiesLatest) {
            properties['client'] = latestClientVersion;
            await window.electron.writeProperties(properties);
        }
        return false;
    }

    /**
     * Latest version is not installed.
     * Properties file is out of sync (e.g., client JAR was deleted).
     * Correct the properties to the latest version actually installed.
     */
    if (isClientVersionOnPropertiesLatest) {
        const orderedClientJars = await orderClientJarsByVersion();
        if (orderedClientJars.length > 0) {
            const newestOfficial =
                orderedClientJars.find((jar) => jar.kind === 'official') ||
                orderedClientJars[0];
            properties['client'] = newestOfficial.version;
        } else {
            properties['client'] = '0.0.0';
        }
        await window.electron.writeProperties(properties);
    }

    // Latest is not installed, prompt for download.
    return true;
}

/**
 * Check if the selected client version is outdated compared to the latest version
 * available before launch.
 *
 * If it is outdated, prompt the user to either skip the latest version or
 * download/launch the latest version.
 *
 * @async
 */
async function checkForOutdatedLaunch() {
    const selectedFile = document.getElementById('client').value;
    const selectedVersion = extractVersion(selectedFile);
    const latestVersion = extractVersion(
        rememberLatestClientVersion(
            await window.electron.fetchClientVersion()
        )
    );

    window.electron.logError(
        `Selected version: ${selectedVersion}, Latest version: ${latestVersion}`
    );
    const selectedJar = (await orderClientJarsByVersion()).find(
        (jar) => jar.file === selectedFile
    );
    if (selectedJar?.kind === 'custom') {
        window.electron.logError(
            `Launching custom client ${selectedVersion}; latest official is ${latestVersion}`
        );
        return;
    }
    if (
        selectedVersion !== latestVersion &&
        latestVersion !== sessionStorage.getItem('skippedVersion')
    ) {
        // Show confirmation dialog
        // Proceed = Skip latest version
        const userWantsToProceed = await window.electron.showConfirmationDialog(
            'Do you want to proceed?',
            `You are about to launch an older version (${selectedVersion}).\r\rThe latest version is ${latestVersion}.`,
            'Outdated Version Warning',
            'Skip latest version',
            'Launch with the latest version'
        );
        window.electron.logError(`User chose: ${userWantsToProceed}`);

        if (userWantsToProceed) {
            // User chose to skip the latest version
            sessionStorage.setItem('skippedVersion', latestVersion);
        } else {
            // User chose to launch with the latest version, download if not exist
            await downloadClientIfNotExist(latestVersion);
        }
    }
}

async function setupHwidSpoofInput() {
    const checkbox = document.getElementById('hwid-spoof');
    if (!checkbox) {
        return;
    }

    const properties = await window.electron.readProperties();
    checkbox.checked = properties['hwid_spoof'] !== 'false';

    checkbox.addEventListener('change', async () => {
        const latestProperties = await window.electron.readProperties();
        latestProperties['hwid_spoof'] = checkbox.checked ? 'true' : 'false';
        await window.electron.writeProperties(latestProperties);
    });
}

/**
 * Check if there is a saved Proxy IP as a cookie and set it to the input field.
 * Also setup Proxy IP input field for change events so we can save to a cookie
 * and persist the value between sessions.
 */
async function setupRamInput() {
    const ramSelect = document.getElementById('client-ram');
    if (!ramSelect) {
        return;
    }

    const properties = await window.electron.readProperties();
    const savedPreference = sanitizeRamPreference(properties['client_ram']);

    if (savedPreference !== properties['client_ram']) {
        properties['client_ram'] = savedPreference;
        await window.electron.writeProperties(properties);
    }

    ensureRamOption(ramSelect, savedPreference);

    const persistPreference = async (rawValue) => {
        const normalized = sanitizeRamPreference(rawValue);
        ensureRamOption(ramSelect, normalized);

        const latestProperties = await window.electron.readProperties();
        if (latestProperties['client_ram'] !== normalized) {
            latestProperties['client_ram'] = normalized;
            await window.electron.writeProperties(latestProperties);
        }
    };

    ramSelect.addEventListener('change', async (event) => {
        await persistPreference(event.target.value);
    });

    ramSelect.addEventListener('blur', async (event) => {
        await persistPreference(event.target.value);
    });
}

const PROXIES_KEY = 'proxies';
const PROXY_URI_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/(?:(.*)@)?([^@/]+)\/?$/i;
const SUPPORTED_PROXY_SCHEMES = ['socks', 'socks5'];
const INVALID_PROXY_HELP = 'Only SOCKS5 proxies work. Use ip:port, ip:port:user:password or socks5://user:password@ip:port.';
let propertiesQueue = Promise.resolve();

function withProperties(task) {
    const run = propertiesQueue.then(async () => task(await window.electron.readProperties()));
    propertiesQueue = run.catch(() => {});
    return run;
}

function parseHostPort(value) {
    const match = value.match(/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d+)$/i);
    if (!match) return null;
    const port = Number(match[2]);
    if (port < 1 || port > 65535) return null;
    return { host: match[1], port };
}

function parseProxyEndpoint(address) {
    if (typeof address !== 'string') return null;
    const value = address.trim();
    if (value === '') return null;
    if (value.includes('://')) {
        const match = value.match(PROXY_URI_PATTERN);
        if (!match || !SUPPORTED_PROXY_SCHEMES.includes(match[1].toLowerCase())) return null;
        const endpoint = parseHostPort(match[3]);
        return endpoint && { ...endpoint, hasLogin: Boolean(match[2]) };
    }
    if (value.includes('@')) {
        if (value.split(':').length !== 3) return null;
        const endpoint = parseHostPort(value.slice(value.lastIndexOf('@') + 1));
        return endpoint && { ...endpoint, hasLogin: true };
    }
    const parts = value.split(':');
    if (parts.length !== 2 && parts.length < 4) return null;
    const endpoint = parseHostPort(`${parts[0]}:${parts[1]}`);
    return endpoint && { ...endpoint, hasLogin: parts.length >= 4 };
}

function parseProxyLine(line) {
    const value = line.trim();
    if (parseProxyEndpoint(value)) return { name: '', address: value };
    const separator = value.indexOf('|');
    if (separator === -1) return null;
    const name = value.slice(0, separator).trim();
    const address = value.slice(separator + 1).trim();
    return parseProxyEndpoint(address) ? { name, address } : null;
}

function proxyLocation(proxy) {
    const endpoint = parseProxyEndpoint(proxy.address);
    return endpoint ? `${endpoint.host}:${endpoint.port}` : 'Unsupported proxy';
}

function proxyLabel(proxy) {
    const location = proxyLocation(proxy);
    return proxy.name ? `${proxy.name} (${location})` : location;
}

function readSavedProxies(properties) {
    const saved = Array.isArray(properties?.[PROXIES_KEY]) ? properties[PROXIES_KEY] : [];
    const proxies = [];
    for (const entry of saved) {
        const address = typeof entry?.address === 'string' ? entry.address.trim() : '';
        if (address === '' || proxies.some((proxy) => proxy.address === address)) continue;
        proxies.push({ name: typeof entry.name === 'string' ? entry.name.trim() : '', address });
    }
    return proxies;
}

function saveProxies(update, { renderList = true } = {}) {
    return withProperties(async (properties) => {
        const proxies = readSavedProxies(properties);
        const selected = typeof properties['proxyip'] === 'string' ? properties['proxyip'].trim() : '';
        const next = update({ proxies, selected });
        properties[PROXIES_KEY] = next.proxies;
        properties['proxyip'] = next.selected;
        await window.electron.writeProperties(properties);
        renderProxySelect(next.proxies, next.selected);
        if (renderList) renderProxyList(next.proxies, next.selected);
        return next;
    });
}

function renderProxySelect(proxies, selected) {
    const proxySelect = document.getElementById('proxy-ip');
    if (!proxySelect) return;
    proxySelect.innerHTML = '';
    const noProxy = document.createElement('option');
    noProxy.value = '';
    noProxy.textContent = 'No proxy';
    proxySelect.appendChild(noProxy);
    for (const proxy of proxies) {
        const option = document.createElement('option');
        option.value = proxy.address;
        option.textContent = proxyLabel(proxy);
        proxySelect.appendChild(option);
    }
    const selectedProxy = proxies.find((proxy) => proxy.address === selected);
    proxySelect.value = selectedProxy ? selected : '';
    proxySelect.title = selectedProxy ? proxyLabel(selectedProxy) : 'Connect without a proxy';
}

function focusProxyRow(index, selector) {
    const rows = document.querySelectorAll('#proxy-list .proxy-row');
    const row = rows[Math.min(index, rows.length - 1)];
    const target = row?.querySelector(selector) || document.getElementById('proxy-add-input');
    target?.focus();
}

function renderProxyList(proxies, selected) {
    const list = document.getElementById('proxy-list');
    const empty = document.getElementById('proxy-list-empty');
    if (!list) return;
    list.innerHTML = '';
    if (empty) empty.style.display = proxies.length === 0 ? 'block' : 'none';
    proxies.forEach((proxy, index) => {
        const endpoint = parseProxyEndpoint(proxy.address);
        const inUse = proxy.address === selected;
        const row = document.createElement('li');
        row.className = inUse ? 'proxy-row in-use' : 'proxy-row';

        const details = document.createElement('div');
        details.className = 'proxy-row-details';
        const nameInput = document.createElement('input');
        nameInput.className = 'proxy-row-name';
        nameInput.type = 'text';
        nameInput.value = proxy.name;
        nameInput.placeholder = 'Add a name';
        nameInput.setAttribute('aria-label', `Name for ${proxyLocation(proxy)}`);
        const location = document.createElement('span');
        location.className = endpoint ? 'proxy-row-location' : 'proxy-row-location invalid';
        location.textContent = endpoint?.hasLogin ? `${proxyLocation(proxy)} · with login` : proxyLocation(proxy);
        details.append(nameInput, location);

        const useButton = document.createElement('button');
        useButton.type = 'button';
        useButton.className = 'proxy-row-use';
        useButton.textContent = inUse ? 'In use' : 'Use';
        useButton.disabled = inUse;
        useButton.addEventListener('click', async () => {
            await saveProxies(({ proxies: current }) => ({ proxies: current, selected: proxy.address }));
            focusProxyRow(index, '.proxy-row-name');
        });

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'proxy-row-remove';
        removeButton.title = 'Remove this proxy';
        removeButton.setAttribute('aria-label', `Remove ${proxyLabel(proxy)}`);
        removeButton.textContent = '✕';
        removeButton.addEventListener('click', async () => {
            await saveProxies(({ proxies: current, selected: currentSelected }) => ({
                proxies: current.filter((entry) => entry.address !== proxy.address),
                selected: currentSelected === proxy.address ? '' : currentSelected
            }));
            focusProxyRow(index, '.proxy-row-remove');
        });

        nameInput.addEventListener('change', async () => {
            const name = nameInput.value.trim();
            nameInput.value = name;
            removeButton.setAttribute('aria-label', `Remove ${proxyLabel({ ...proxy, name })}`);
            await saveProxies(
                ({ proxies: current, selected: currentSelected }) => ({
                    proxies: current.map((entry) => (entry.address === proxy.address ? { ...entry, name } : entry)),
                    selected: currentSelected
                }),
                { renderList: false }
            );
        });
        nameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') nameInput.dispatchEvent(new Event('change'));
        });

        row.append(details, useButton, removeButton);
        list.appendChild(row);
    });
}

async function addProxiesFromText(text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
    const invalid = [];
    let added = 0;
    let duplicates = 0;
    await saveProxies(({ proxies, selected }) => {
        const wasEmpty = proxies.length === 0;
        for (const line of lines) {
            const proxy = parseProxyLine(line);
            if (!proxy) {
                invalid.push(line);
            } else if (proxies.some((entry) => entry.address === proxy.address)) {
                duplicates++;
            } else {
                proxies.push(proxy);
                added++;
            }
        }
        const nextSelected = wasEmpty && selected === '' && proxies.length > 0 ? proxies[0].address : selected;
        return { proxies, selected: nextSelected };
    });
    return { added, duplicates, invalid };
}

function describeAddResult({ added, duplicates, invalid }) {
    const parts = [];
    if (added > 0) parts.push(`Added ${added} ${added === 1 ? 'proxy' : 'proxies'}.`);
    if (duplicates > 0) parts.push(`${duplicates} already saved.`);
    if (invalid.length > 0) {
        parts.push(
            `${invalid.length} ${invalid.length === 1 ? 'line was' : 'lines were'} not added and left in the box. ${INVALID_PROXY_HELP}`
        );
    }
    return parts.join(' ');
}
function setupProxyManager() {
    const modal = document.getElementById('proxy-manager-modal');
    const openButton = document.getElementById('manage-proxies');
    const closeButton = document.getElementById('proxy-manager-close');
    const form = document.getElementById('proxy-add-form');
    const input = document.getElementById('proxy-add-input');
    const message = document.getElementById('proxy-add-error');
    if (!modal || !openButton || !form || !input) return;

    const close = () => {
        modal.classList.add('auth-hidden');
        document.removeEventListener('keydown', closeOnEscape);
        openButton.focus();
    };
    const closeOnEscape = (event) => {
        if (event.key === 'Escape') close();
    };

    openButton.addEventListener('click', async () => {
        await withProperties((properties) =>
            renderProxyList(readSavedProxies(properties), document.getElementById('proxy-ip')?.value || '')
        );
        if (message) {
            message.textContent = '';
            message.classList.remove('success');
        }
        modal.classList.remove('auth-hidden');
        document.addEventListener('keydown', closeOnEscape);
        input.focus();
    });
    closeButton?.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) close();
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit();
    });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (input.value.trim() === '') {
            if (message) {
                message.textContent = 'Paste or type a proxy first.';
                message.classList.remove('success');
            }
            input.focus();
            return;
        }
        const result = await addProxiesFromText(input.value);
        input.value = result.invalid.join('\n');
        if (message) {
            message.textContent = describeAddResult(result);
            message.classList.toggle('success', result.invalid.length === 0);
        }
        input.focus();
    });
}

async function setupProxyInput() {
    const proxySelect = document.getElementById('proxy-ip');
    if (!proxySelect) {
        return;
    }

    await withProperties(async (properties) => {
        hideProxyLoginInfo = properties[HIDE_PROXY_LOGIN_INFO] === true;
        const proxies = readSavedProxies(properties);
        const savedProxy = typeof properties['proxyip'] === 'string' ? properties['proxyip'].trim() : '';
        if (savedProxy !== '' && !proxies.some((proxy) => proxy.address === savedProxy)) {
            proxies.push({ name: '', address: savedProxy });
            properties[PROXIES_KEY] = proxies;
            await window.electron.writeProperties(properties);
        }
        renderProxySelect(proxies, savedProxy);
    });

    proxySelect.addEventListener('change', async (event) => {
        const value = event.target.value;
        await saveProxies(({ proxies }) => ({ proxies, selected: value }));
        await maybeShowProxyLoginInfo();
    });

    setupProxyManager();
}

function sanitizeRamPreference(value) {
    if (!value || typeof value !== 'string') {
        return DEFAULT_CLIENT_RAM;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === '') {
        return DEFAULT_CLIENT_RAM;
    }

    const match = normalized.match(/^(\d+(?:\.\d+)?)([mg])$/);
    if (!match) {
        return DEFAULT_CLIENT_RAM;
    }

    const amount = match[1];
    const unit = match[2];
    return `${amount}${unit}`;
}

function ensureRamOption(selectElement, value) {
    if (!selectElement) {
        return;
    }

    const options = Array.from(selectElement.options || []);
    if (!options.some((option) => option.value === value)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = formatRamLabel(value);
        option.dataset.custom = 'true';
        selectElement.appendChild(option);
    }

    selectElement.value = value;
}

function formatRamLabel(value) {
    if (typeof value !== 'string') {
        return value;
    }

    const match = value.match(/^(\d+(?:\.\d+)?)([mg])$/i);
    if (!match) {
        return value;
    }

    const [, amount, unit] = match;
    const unitLabel = unit.toLowerCase() === 'g' ? 'GB' : 'MB';
    return `${amount} ${unitLabel}`;
}
