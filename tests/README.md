# Test Suite

This directory contains the test suite for homebridge-myleviton. All tests run in a **sandboxed environment** to ensure:

- ✅ No real network calls are made
- ✅ No real Homebridge instances are affected
- ✅ Tests are isolated and can run in parallel
- ✅ No side effects between tests

## Test Structure

```
tests/
├── setup.js              # Test environment setup and sandboxing
├── api.test.js           # Integration tests for api.js
├── index.test.js         # Integration tests for index.js (platform)
├── README.md             # This file
└── unit/                 # TypeScript unit tests
    ├── cache.test.ts
    ├── circuit-breaker.test.ts
    ├── client.test.ts
    ├── errors.test.ts
    ├── logger.test.ts
    ├── persistence.test.ts
    ├── rate-limiter.test.ts
    ├── request-queue.test.ts
    ├── retry.test.ts
    ├── sanitizers.test.ts
    ├── validators.test.ts
    └── websocket.test.ts
```

## Running Tests

### Run all tests with coverage
```bash
npm test
```

### Run unit tests only
```bash
npm run test:unit
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run specific test file
```bash
npx jest tests/api.test.js
npx jest tests/unit/validators.test.ts
```

### Run with verbose output
```bash
npx jest --verbose
```

## Test Categories

### Integration Tests (JavaScript)

`api.test.js` and `index.test.js` test the main plugin files:

- **api.test.js**: Tests the Leviton API client (`api.js`)
  - Authentication flow
  - Device discovery
  - Rate limiting
  - Circuit breaker
  - Response caching
  - WebSocket connections

- **index.test.js**: Tests the Homebridge platform (`index.js`)
  - Platform initialization
  - Device accessory creation
  - Service setup (Switch, Dimmer, Fan, Outlet)
  - Characteristic handlers
  - Real-time update callbacks

### Unit Tests (TypeScript)

`tests/unit/*.test.ts` test the TypeScript utility modules in `src/`:

| Test File | Module | What It Tests |
|-----------|--------|---------------|
| `errors.test.ts` | `src/errors/` | Error classes, codes, retryable flags |
| `validators.test.ts` | `src/utils/validators.ts` | Input validation functions |
| `sanitizers.test.ts` | `src/utils/sanitizers.ts` | Security sanitization |
| `retry.test.ts` | `src/utils/retry.ts` | Retry with exponential backoff |
| `logger.test.ts` | `src/utils/logger.ts` | Structured logging |
| `rate-limiter.test.ts` | `src/api/rate-limiter.ts` | Token bucket rate limiting |
| `circuit-breaker.test.ts` | `src/api/circuit-breaker.ts` | Circuit breaker pattern |
| `cache.test.ts` | `src/api/cache.ts` | Response caching with TTL/LRU |
| `persistence.test.ts` | `src/api/persistence.ts` | Device state persistence |
| `request-queue.test.ts` | `src/api/request-queue.ts` | Priority queue, deduplication |
| `client.test.ts` | `src/api/client.ts` | API client with all integrations |
| `websocket.test.ts` | `src/api/websocket.ts` | WebSocket connection management |

## Sandboxing

### Network Isolation
- All `fetch` calls are mocked
- All `sockjs-client` WebSocket connections are mocked
- No real HTTP requests are made during tests

### Homebridge Isolation
- Homebridge API is fully mocked
- No real Homebridge instances are created
- Platform registration is mocked

### Timer Isolation
- `setInterval` and `setTimeout` are mocked in setup
- Prevents open handles and flaky tests
- Use `jest.useFakeTimers()` for time-dependent tests

### Test Isolation
- Each test file runs in isolation
- Mocks are cleared between tests
- No shared state between tests

## Coverage

Tests maintain **80%+ coverage** thresholds:

```javascript
// jest.config.js
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
}
```

View coverage report:
```bash
npm test
open coverage/lcov-report/index.html
```

## Writing New Tests

### JavaScript Integration Test Example

```javascript
describe('Feature Name', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should do something', async () => {
    // Arrange
    Leviton.someMethod.mockResolvedValueOnce({ data: 'value' })
    
    // Act
    const result = await platform.someMethod()
    
    // Assert
    expect(result).toBe(expected)
    expect(Leviton.someMethod).toHaveBeenCalledWith({ ... })
  })
})
```

### TypeScript Unit Test Example

```typescript
import { someFunction } from '../../src/utils/module'

describe('someFunction', () => {
  it('should return expected result', () => {
    const result = someFunction('input')
    expect(result).toBe('expected')
  })

  it('should throw on invalid input', () => {
    expect(() => someFunction('')).toThrow(ValidationError)
  })
})
```

### Mock Utilities

Use the global test utilities from `setup.js`:
- `createMockDevice()` - Create a mock device object
- `createMockAccessory()` - Create a mock Homebridge accessory
- `createMockHomebridge()` - Create a mock Homebridge instance
- `createMockApi()` - Create a mock Homebridge API
- `createMockLogger()` - Create a mock logger

## Best Practices

1. **Always mock external dependencies** - Never make real API calls
2. **Use beforeEach/afterEach** - Clean up state between tests
3. **Test edge cases** - Invalid input, errors, null values
4. **Keep tests focused** - One assertion per test when possible
5. **Use descriptive names** - Test names should describe what they test
6. **Clean up timers** - Call `ws.close()` or clear intervals after tests

## Troubleshooting

### Tests failing with network errors
- Ensure all network calls are mocked
- Check that `jest.mock()` is called before imports

### Tests affecting each other
- Ensure `jest.clearAllMocks()` in `beforeEach`
- Check that tests don't share mutable state

### Open handle warnings
- Use `jest.useFakeTimers()` and `jest.clearAllTimers()`
- Call cleanup methods (e.g., `ws.close()`) in tests
- Check `tests/setup.js` for global timer mocking

### Coverage not meeting threshold
- Add tests for uncovered branches
- Check that all code paths are tested
- Review coverage report for gaps

