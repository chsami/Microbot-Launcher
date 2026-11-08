const { TEXT, cardView } = require('../runelite-loader-card.js');

describe('Microbot in RuneLite card', () => {
    test('hidden unless the launcher says it is available', () => {
        expect(cardView(null)).toEqual({ hidden: true });
        expect(cardView({ visible: false })).toEqual({ hidden: true });
        expect(cardView({ visible: false, error: 'Sign in to your Microbot account first.' })).toEqual({ hidden: true });
    });

    test('not added offers the one button', () => {
        expect(cardView({ visible: true, state: 'not-added' })).toEqual({
            hidden: false,
            hint: 'Adds Microbot to the RuneLite you already use. Open RuneLite the usual way afterwards.',
            button: 'Add Microbot to my RuneLite',
            remove: false,
            error: ''
        });
    });

    test('working shows the progress text and no buttons', () => {
        expect(cardView({ visible: true, state: 'working', progress: 'Downloading Microbot...' })).toMatchObject({
            hint: 'Downloading Microbot...',
            button: null,
            remove: false
        });
        expect(cardView({ visible: true, state: 'working' }).hint).toBe(TEXT.working);
    });

    test('added says how to use it and offers removal', () => {
        expect(cardView({ visible: true, state: 'added' })).toMatchObject({
            hint: 'Added. Open RuneLite the usual way; Microbot is in the sidebar.',
            button: null,
            remove: true
        });
    });

    test('update offers Update and removal', () => {
        expect(cardView({ visible: true, state: 'update', reason: 'new-version' })).toMatchObject({ button: 'Update', remove: true, hint: TEXT.newVersion });
        expect(cardView({ visible: true, state: 'update', reason: 'signed-out' })).toMatchObject({ button: 'Update', hint: TEXT.signedOut });
    });

    test('errors show under the hint', () => {
        expect(cardView({ visible: true, state: 'not-added', error: 'Close RuneLite first, then try again.' }).error).toBe('Close RuneLite first, then try again.');
    });
});
