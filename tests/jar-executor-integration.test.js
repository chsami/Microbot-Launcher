/**
 * Integration tests for jar-executor.js selectMemoryArgs function
 * These tests verify that our extracted utilities work correctly with the actual jar-executor module
 */

const { createSelectMemoryArgs, createDefaultMemoryConfig } = require('../libs/memory-utils');

describe('jar-executor.js integration', () => {
    let mockLog;

    beforeEach(() => {
        mockLog = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };
    });

    describe('selectMemoryArgs integration', () => {
        test('should replicate jar-executor behavior with default config', () => {
            // Simulate the setup from jar-executor.js
            const argv = ['node', 'main.js']; // No CLI args
            const config = createDefaultMemoryConfig(argv, mockLog);
            const selectMemoryArgs = createSelectMemoryArgs({
                ...config,
                log: mockLog
            });

            // Test cases that mirror real usage scenarios
            expect(selectMemoryArgs('')).toEqual({
                args: ['-Xms512m', '-Xmx1g'],
                source: 'launcher default (1g)'
            });

            expect(selectMemoryArgs('2g')).toEqual({
                args: ['-Xms2g', '-Xmx2g'],
                source: 'client preference (2g)'
            });

            expect(selectMemoryArgs('invalid')).toEqual({
                args: ['-Xms512m', '-Xmx1g'],
                source: 'launcher default (1g)'
            });
        });

        test('should replicate jar-executor behavior with CLI override', () => {
            // Simulate CLI override scenario
            const argv = ['node', 'main.js', '--ram', '4g'];
            const config = createDefaultMemoryConfig(argv, mockLog);
            const selectMemoryArgs = createSelectMemoryArgs({
                ...config,
                log: mockLog
            });

            // Should use CLI default when no client preference
            expect(selectMemoryArgs('')).toEqual({
                args: ['-Xms4g', '-Xmx4g'],
                source: 'CLI --ram (4g)'
            });

            // Should still allow client preference to override
            expect(selectMemoryArgs('8g')).toEqual({
                args: ['-Xms8g', '-Xmx8g'],
                source: 'client preference (8g)'
            });
        });

        test('should handle real-world client preference scenarios', () => {
            const config = createDefaultMemoryConfig([], mockLog);
            const selectMemoryArgs = createSelectMemoryArgs({
                ...config,
                log: mockLog
            });

            // Test common user inputs
            const testCases = [
                { input: '1g', expected: { args: ['-Xms1g', '-Xmx1g'], source: 'client preference (1g)' } },
                { input: '2G', expected: { args: ['-Xms2g', '-Xmx2g'], source: 'client preference (2g)' } },
                { input: '512m', expected: { args: ['-Xms512m', '-Xmx512m'], source: 'client preference (512m)' } },
                { input: '1024M', expected: { args: ['-Xms1024m', '-Xmx1024m'], source: 'client preference (1024m)' } },
                { input: ' 1.5g ', expected: { args: ['-Xms1.5g', '-Xmx1.5g'], source: 'client preference (1.5g)' } },
                { input: '', expected: { args: ['-Xms512m', '-Xmx1g'], source: 'launcher default (1g)' } },
                { input: null, expected: { args: ['-Xms512m', '-Xmx1g'], source: 'launcher default (1g)' } },
                { input: undefined, expected: { args: ['-Xms512m', '-Xmx1g'], source: 'launcher default (1g)' } },
                { input: 'invalid', expected: { args: ['-Xms512m', '-Xmx1g'], source: 'launcher default (1g)' } }
            ];

            testCases.forEach(({ input, expected }) => {
                const result = selectMemoryArgs(input);
                expect(result).toEqual(expected);
            });
        });

        test('should log warnings for invalid client preferences', () => {
            const config = createDefaultMemoryConfig([], mockLog);
            const selectMemoryArgs = createSelectMemoryArgs({
                ...config,
                log: mockLog
            });

            selectMemoryArgs('invalid_memory');

            expect(mockLog.warn).toHaveBeenCalledWith(
                'Invalid client RAM preference value "invalid_memory". Falling back to default memory settings.'
            );
        });

        test('should handle edge case from CLI args parsing', () => {
            // Test various CLI argument formats
            const testCases = [
                { argv: ['--ram=2g'], expected: '2g' },
                { argv: ['--ram', '1g'], expected: '1g' },
                { argv: ['node', 'app.js', '--ram=512m', '--other'], expected: '512m' },
                { argv: ['--ram', '1.5g', '--another-flag'], expected: '1.5g' }
            ];

            testCases.forEach(({ argv, expected }) => {
                const config = createDefaultMemoryConfig(argv, mockLog);
                expect(config.cliMemory.normalized).toBe(expected);
                expect(config.defaultMemorySource).toBe(`CLI --ram (${expected})`);
            });
        });
    });

    describe('end-to-end memory configuration scenarios', () => {
        test('should handle complete workflow: CLI args + client preferences', () => {
            // User starts launcher with CLI override
            const argv = ['electron', '.', '--ram', '3g'];
            const config = createDefaultMemoryConfig(argv, mockLog);

            expect(config.cliMemory).toEqual({
                args: ['-Xms3g', '-Xmx3g'],
                normalized: '3g'
            });

            const selectMemoryArgs = createSelectMemoryArgs({
                ...config,
                log: mockLog
            });

            // User opens client without specifying RAM - should use CLI default
            const clientResult1 = selectMemoryArgs('');
            expect(clientResult1).toEqual({
                args: ['-Xms3g', '-Xmx3g'],
                source: 'CLI --ram (3g)'
            });

            // User opens another client with specific preference - should override
            const clientResult2 = selectMemoryArgs('6g');
            expect(clientResult2).toEqual({
                args: ['-Xms6g', '-Xmx6g'],
                source: 'client preference (6g)'
            });

            // User opens client with invalid preference - should fall back to CLI
            const clientResult3 = selectMemoryArgs('not_valid');
            expect(clientResult3).toEqual({
                args: ['-Xms3g', '-Xmx3g'],
                source: 'CLI --ram (3g)'
            });
        });

        test('should handle workflow without CLI args', () => {
            // User starts launcher normally
            const argv = ['electron', '.'];
            const config = createDefaultMemoryConfig(argv, mockLog);

            expect(config.cliMemory).toBeNull();

            const selectMemoryArgs = createSelectMemoryArgs({
                ...config,
                log: mockLog
            });

            // All clients use default unless overridden
            expect(selectMemoryArgs('')).toEqual({
                args: ['-Xms512m', '-Xmx1g'],
                source: 'launcher default (1g)'
            });

            expect(selectMemoryArgs('2g')).toEqual({
                args: ['-Xms2g', '-Xmx2g'],
                source: 'client preference (2g)'
            });
        });
    });
});