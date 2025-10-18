const {
    normalizeRamValue,
    buildMemoryArgsFromRam,
    extractRamValue,
    createSelectMemoryArgs,
    createDefaultMemoryConfig,
    DEFAULT_XMS_VALUE,
    DEFAULT_XMX_VALUE,
    DEFAULT_CLIENT_RAM
} = require('../libs/memory-utils');

describe('Memory Utils', () => {
    let mockLog;

    beforeEach(() => {
        mockLog = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };
    });

    describe('normalizeRamValue', () => {
        test('should normalize valid megabyte values', () => {
            expect(normalizeRamValue('512m')).toEqual({
                normalized: '512m',
                mb: 512
            });
            expect(normalizeRamValue('1024M')).toEqual({
                normalized: '1024m',
                mb: 1024
            });
        });

        test('should normalize valid gigabyte values', () => {
            expect(normalizeRamValue('1g')).toEqual({
                normalized: '1g',
                mb: 1024
            });
            expect(normalizeRamValue('2G')).toEqual({
                normalized: '2g',
                mb: 2048
            });
            expect(normalizeRamValue('0.5g')).toEqual({
                normalized: '0.5g',
                mb: 512
            });
        });

        test('should handle whitespace and case variations', () => {
            expect(normalizeRamValue('  1G  ')).toEqual({
                normalized: '1g',
                mb: 1024
            });
            expect(normalizeRamValue('512M')).toEqual({
                normalized: '512m',
                mb: 512
            });
        });

        test('should return null for invalid values', () => {
            expect(normalizeRamValue('')).toBeNull();
            expect(normalizeRamValue('invalid')).toBeNull();
            expect(normalizeRamValue('1k')).toBeNull();
            expect(normalizeRamValue('1gb')).toBeNull();
            expect(normalizeRamValue('-1g')).toBeNull();
            expect(normalizeRamValue('0g')).toBeNull();
            expect(normalizeRamValue(null)).toBeNull();
            expect(normalizeRamValue(undefined)).toBeNull();
            expect(normalizeRamValue(123)).toBeNull();
        });

        test('should handle decimal values', () => {
            expect(normalizeRamValue('1.5g')).toEqual({
                normalized: '1.5g',
                mb: 1536
            });
            expect(normalizeRamValue('512.5m')).toEqual({
                normalized: '512.5m',
                mb: 512.5
            });
        });
    });

    describe('buildMemoryArgsFromRam', () => {
        test('should build memory args for valid values', () => {
            const result = buildMemoryArgsFromRam('1g', mockLog, 'test');
            expect(result).toEqual({
                args: ['-Xms1g', '-Xmx1g'],
                normalized: '1g'
            });
        });

        test('should return null for invalid values and log warning', () => {
            const result = buildMemoryArgsFromRam('invalid', mockLog, 'test context');
            expect(result).toBeNull();
            expect(mockLog.warn).toHaveBeenCalledWith(
                'Invalid test context value "invalid". Falling back to default memory settings.'
            );
        });

        test('should return null for empty/null values without logging', () => {
            expect(buildMemoryArgsFromRam('', mockLog, 'test')).toBeNull();
            expect(buildMemoryArgsFromRam(null, mockLog, 'test')).toBeNull();
            expect(buildMemoryArgsFromRam(undefined, mockLog, 'test')).toBeNull();
            expect(mockLog.warn).not.toHaveBeenCalled();
        });

        test('should work without logger', () => {
            const result = buildMemoryArgsFromRam('512m', null, 'test');
            expect(result).toEqual({
                args: ['-Xms512m', '-Xmx512m'],
                normalized: '512m'
            });
        });
    });

    describe('extractRamValue', () => {
        test('should extract RAM value from --ram argument', () => {
            expect(extractRamValue(['node', 'app.js', '--ram', '1g'])).toBe('1g');
            expect(extractRamValue(['--ram', '512m', 'other', 'args'])).toBe('512m');
        });

        test('should extract RAM value from --ram= format', () => {
            expect(extractRamValue(['node', 'app.js', '--ram=1g'])).toBe('1g');
            expect(extractRamValue(['--ram=512m', 'other', 'args'])).toBe('512m');
        });

        test('should return null when no RAM argument found', () => {
            expect(extractRamValue(['node', 'app.js', '--other', 'args'])).toBeNull();
            expect(extractRamValue(['node', 'app.js'])).toBeNull();
            expect(extractRamValue([])).toBeNull();
        });

        test('should return null for invalid input', () => {
            expect(extractRamValue(null)).toBeNull();
            expect(extractRamValue(undefined)).toBeNull();
            expect(extractRamValue('not an array')).toBeNull();
        });

        test('should handle edge cases', () => {
            expect(extractRamValue(['--ram'])).toBeUndefined(); // No value after --ram
            expect(extractRamValue(['--ram='])).toBe(''); // Empty value
            expect(extractRamValue([123, '--ram', '1g'])).toBe('1g'); // Non-string elements
        });
    });

    describe('createDefaultMemoryConfig', () => {
        test('should create default config when no CLI args', () => {
            const config = createDefaultMemoryConfig([], mockLog);

            expect(config.cliMemory).toBeNull();
            expect(config.defaultMemoryConfig).toEqual({
                args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                normalized: DEFAULT_CLIENT_RAM
            });
            expect(config.defaultMemorySource).toBe(`launcher default (${DEFAULT_CLIENT_RAM})`);
        });

        test('should use CLI memory when provided', () => {
            const config = createDefaultMemoryConfig(['--ram', '2g'], mockLog);

            expect(config.cliMemory).toEqual({
                args: ['-Xms2g', '-Xmx2g'],
                normalized: '2g'
            });
            expect(config.defaultMemoryConfig).toEqual({
                args: ['-Xms2g', '-Xmx2g'],
                normalized: '2g'
            });
            expect(config.defaultMemorySource).toBe('CLI --ram (2g)');
        });
    });

    describe('selectMemoryArgs function', () => {
        let selectMemoryArgs;
        let defaultConfig;

        beforeEach(() => {
            // Create a standard configuration for testing
            defaultConfig = {
                cliMemory: null,
                defaultMemoryConfig: {
                    args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                    normalized: DEFAULT_CLIENT_RAM
                },
                defaultMemorySource: `launcher default (${DEFAULT_CLIENT_RAM})`,
                log: mockLog
            };
            selectMemoryArgs = createSelectMemoryArgs(defaultConfig);
        });

        describe('with default launcher configuration', () => {
            test('should return default memory config for empty input', () => {
                const result = selectMemoryArgs('');
                expect(result).toEqual({
                    args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                    source: `launcher default (${DEFAULT_CLIENT_RAM})`
                });
            });

            test('should return default memory config for null/undefined input', () => {
                expect(selectMemoryArgs(null)).toEqual({
                    args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                    source: `launcher default (${DEFAULT_CLIENT_RAM})`
                });

                expect(selectMemoryArgs(undefined)).toEqual({
                    args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                    source: `launcher default (${DEFAULT_CLIENT_RAM})`
                });
            });

            test('should return default memory config for invalid input', () => {
                const result = selectMemoryArgs('invalid');
                expect(result).toEqual({
                    args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                    source: `launcher default (${DEFAULT_CLIENT_RAM})`
                });
                expect(mockLog.warn).toHaveBeenCalledWith(
                    'Invalid client RAM preference value "invalid". Falling back to default memory settings.'
                );
            });

            test('should override with valid client preference', () => {
                const result = selectMemoryArgs('2g');
                expect(result).toEqual({
                    args: ['-Xms2g', '-Xmx2g'],
                    source: 'client preference (2g)'
                });
            });

            test('should handle various valid RAM formats', () => {
                expect(selectMemoryArgs('512m')).toEqual({
                    args: ['-Xms512m', '-Xmx512m'],
                    source: 'client preference (512m)'
                });

                expect(selectMemoryArgs('1.5G')).toEqual({
                    args: ['-Xms1.5g', '-Xmx1.5g'],
                    source: 'client preference (1.5g)'
                });

                expect(selectMemoryArgs('  1024M  ')).toEqual({
                    args: ['-Xms1024m', '-Xmx1024m'],
                    source: 'client preference (1024m)'
                });
            });
        });

        describe('with CLI memory override', () => {
            beforeEach(() => {
                // Configure with CLI memory override
                const configWithCli = {
                    cliMemory: {
                        args: ['-Xms2g', '-Xmx2g'],
                        normalized: '2g'
                    },
                    defaultMemoryConfig: {
                        args: ['-Xms2g', '-Xmx2g'],
                        normalized: '2g'
                    },
                    defaultMemorySource: 'CLI --ram (2g)',
                    log: mockLog
                };
                selectMemoryArgs = createSelectMemoryArgs(configWithCli);
            });

            test('should use CLI default when no client preference', () => {
                const result = selectMemoryArgs('');
                expect(result).toEqual({
                    args: ['-Xms2g', '-Xmx2g'],
                    source: 'CLI --ram (2g)'
                });
            });

            test('should still allow client preference to override CLI default', () => {
                const result = selectMemoryArgs('4g');
                expect(result).toEqual({
                    args: ['-Xms4g', '-Xmx4g'],
                    source: 'client preference (4g)'
                });
            });

            test('should fall back to CLI default on invalid client preference', () => {
                const result = selectMemoryArgs('invalid');
                expect(result).toEqual({
                    args: ['-Xms2g', '-Xmx2g'],
                    source: 'CLI --ram (2g)'
                });
            });
        });

        describe('edge cases and error handling', () => {
            test('should handle non-string inputs gracefully', () => {
                expect(selectMemoryArgs(123)).toEqual({
                    args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                    source: `launcher default (${DEFAULT_CLIENT_RAM})`
                });

                expect(selectMemoryArgs({})).toEqual({
                    args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                    source: `launcher default (${DEFAULT_CLIENT_RAM})`
                });

                expect(selectMemoryArgs([])).toEqual({
                    args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                    source: `launcher default (${DEFAULT_CLIENT_RAM})`
                });
            });

            test('should not mutate original default config arrays', () => {
                const originalArgs = defaultConfig.defaultMemoryConfig.args;
                const originalArgsClone = [...originalArgs];

                const result = selectMemoryArgs('');
                result.args.push('-DtestFlag=true');

                expect(defaultConfig.defaultMemoryConfig.args).toEqual(originalArgsClone);
            });

            test('should handle whitespace-only strings', () => {
                const result = selectMemoryArgs('   ');
                expect(result).toEqual({
                    args: [`-Xms${DEFAULT_XMS_VALUE}`, `-Xmx${DEFAULT_XMX_VALUE}`],
                    source: `launcher default (${DEFAULT_CLIENT_RAM})`
                });
            });
        });
    });
});