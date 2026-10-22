const { HIDE_KEY, shouldAutoShow, parseTargets, jagexStatus, microbotStatus } = require('../setup-guide.js');

describe('setup guide startup', () => {
    test('shows on startup until the player hides it', () => {
        expect(shouldAutoShow({})).toBe(true);
        expect(shouldAutoShow(null)).toBe(true);
        expect(shouldAutoShow({ [HIDE_KEY]: false })).toBe(true);
        expect(shouldAutoShow({ [HIDE_KEY]: true })).toBe(false);
    });

    test('stores the choice under hide_setup_guide', () => {
        expect(HIDE_KEY).toBe('hide_setup_guide');
    });
});

describe('setup guide targets', () => {
    test('reads space separated element ids in order', () => {
        expect(parseTargets('add-accounts play')).toEqual(['add-accounts', 'play']);
        expect(parseTargets('  client  ')).toEqual(['client']);
        expect(parseTargets(undefined)).toEqual([]);
    });
});

describe('setup guide Jagex status', () => {
    test('no characters yet', () => {
        expect(jagexStatus([])).toEqual({ done: false, count: 0, text: 'No Jagex characters added yet.' });
    });

    test('an accounts read error counts as none', () => {
        expect(jagexStatus({ error: 'boom' })).toMatchObject({ done: false, count: 0 });
    });

    test('names one character', () => {
        expect(jagexStatus([{ displayName: 'Zezima' }]).text).toBe('1 character added: Zezima.');
    });

    test('names up to three characters', () => {
        const accounts = [{ displayName: 'Zezima' }, { displayName: 'Lynx Titan' }, { displayName: '' }];
        expect(jagexStatus(accounts)).toEqual({
            done: true,
            count: 3,
            text: '3 characters added: Zezima, Lynx Titan and Unnamed character.'
        });
    });

    test('counts the rest past three', () => {
        const accounts = ['A', 'B', 'C', 'D', 'E'].map((displayName) => ({ displayName }));
        expect(jagexStatus(accounts).text).toBe('5 characters added: A, B, C and 2 more.');
    });
});

describe('setup guide Microbot account status', () => {
    test('signed in shows the email and hides sign in', () => {
        expect(microbotStatus({ authenticated: true, api: true, user: { email: 'player@example.com' } })).toEqual({
            done: true,
            canSignIn: false,
            text: 'Signed in as player@example.com.'
        });
    });

    test('signed out with accounts available offers sign in', () => {
        expect(microbotStatus({ authenticated: false, api: true })).toMatchObject({ done: false, canSignIn: true });
    });

    test('no account service hides sign in', () => {
        expect(microbotStatus({ authenticated: false, api: false, mock: false })).toMatchObject({ canSignIn: false });
        expect(microbotStatus(null)).toMatchObject({ canSignIn: false });
    });
});
