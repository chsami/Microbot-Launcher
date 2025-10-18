# Unit Tests for selectMemoryArgs

This directory contains comprehensive unit tests for the `selectMemoryArgs` function and related memory management utilities from `jar-executor.js`.

## Setup

The tests use Jest as the testing framework. Jest has been added as a dev dependency and is configured via `jest.config.js`.

## Test Structure

### Core Tests (`memory-utils.test.js`)
Tests the individual utility functions that power the memory management system:

- `normalizeRamValue()` - Validates RAM value parsing (e.g., "1g", "512m")
- `buildMemoryArgsFromRam()` - Tests JVM argument generation
- `extractRamValue()` - Tests CLI argument parsing for `--ram` flag
- `createDefaultMemoryConfig()` - Tests default configuration creation
- `selectMemoryArgs()` - Comprehensive tests for the main function

### Integration Tests (`jar-executor-integration.test.js`)
Tests the complete workflow and integration scenarios:

- Default launcher behavior without CLI overrides
- CLI RAM override scenarios (`--ram` flag)
- Real-world client preference handling
- End-to-end memory configuration workflows

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Coverage

The tests achieve 100% statement, branch, and function coverage for the memory utilities module:

- **27 unit tests** covering individual functions
- **7 integration tests** covering real-world scenarios  
- **Edge cases** including invalid inputs, type safety, and error handling
- **CLI integration** testing both `--ram=value` and `--ram value` formats

## Test Cases Covered

### Valid RAM Values
- Megabyte values: `512m`, `1024M`
- Gigabyte values: `1g`, `2G`, `1.5g`
- Case insensitive parsing
- Whitespace handling

### Invalid RAM Values
- Empty strings, null, undefined
- Invalid formats: `1k`, `1gb`, `invalid`
- Negative values: `-1g`
- Zero values: `0g`
- Non-string inputs

### CLI Arguments
- `--ram 1g` format
- `--ram=1g` format
- Missing arguments
- Invalid argument arrays

### Client Preferences
- Override default settings
- Override CLI settings  
- Fallback to defaults on invalid input
- Type safety for non-string inputs

### Memory Configuration Sources
- Launcher defaults (`512m` min, `1g` max)
- CLI overrides (`--ram` flag)
- Client preferences (runtime selection)
- Proper source attribution in results

## Module Structure

The tests use an extracted `memory-utils.js` module that contains the testable functions. This approach:

1. **Separates concerns** - Pure functions for easier testing
2. **Maintains compatibility** - Original `jar-executor.js` unchanged
3. **Enables mocking** - Logger and other dependencies can be mocked
4. **Improves testability** - Functions can be tested in isolation

## Future Enhancements

Consider adding tests for:
- Performance with large CLI argument arrays
- Memory constraints on low-end systems
- Additional RAM units (if supported in future)
- Integration with actual JVM startup processes