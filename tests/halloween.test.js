const { TAGLINE, isHalloweenSeason } = require('../halloween.js');

describe('halloween season', () => {
    test('runs from 20 October to 1 November', () => {
        expect(isHalloweenSeason(new Date(2026, 9, 20))).toBe(true);
        expect(isHalloweenSeason(new Date(2026, 9, 31, 23, 59))).toBe(true);
        expect(isHalloweenSeason(new Date(2026, 10, 1, 23, 59))).toBe(true);
    });

    test('is off the rest of the year', () => {
        expect(isHalloweenSeason(new Date(2026, 9, 19, 23, 59))).toBe(false);
        expect(isHalloweenSeason(new Date(2026, 10, 2))).toBe(false);
        expect(isHalloweenSeason(new Date(2026, 11, 25))).toBe(false);
        expect(isHalloweenSeason(new Date(2027, 0, 1))).toBe(false);
    });

    test('comes back every year', () => {
        expect(isHalloweenSeason(new Date(2027, 9, 25))).toBe(true);
    });

    test('replaces the tagline with a greeting', () => {
        expect(TAGLINE).toBe('Happy Halloween');
    });
});
