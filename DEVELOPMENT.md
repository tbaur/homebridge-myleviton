# Development Guide

Developer documentation for homebridge-myleviton.

## Architecture Overview

```
┌───────────────────────────────────────────────────────────┐
│                      Homebridge                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │           src/platform.ts (Platform)                │  │
│  │  • LevitonDecoraSmartPlatform class                 │  │
│  │  • Device discovery & accessory management          │  │
│  │  • HomeKit service setup (Lightbulb, Fan, etc.)     │  │
│  │  • Characteristic handlers (get/set power, etc.)    │  │
│  └──────────────────────┬──────────────────────────────┘  │
│                         │                                 │
│  ┌──────────────────────▼──────────────────────────────┐  │
│  │          src/api/client.ts (API Client)             │  │
│  │  • Leviton cloud API interaction                    │  │
│  │  • Rate limiting, caching, circuit breaker          │  │
│  │  • Device state persistence                         │  │
│  └──────────────────────┬──────────────────────────────┘  │
│                         │                                 │
│  ┌──────────────────────▼──────────────────────────────┐  │
│  │        src/api/websocket.ts (WebSocket)             │  │
│  │  • Real-time device updates                         │  │
│  │  • Auto-reconnection with backoff                   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
└─────────────────────────┬─────────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │   my.leviton.com      │
              │   • REST API          │
              │   • WebSocket         │
              └───────────────────────┘
```

## File Structure

```
homebridge-myleviton/
├── src/                  # TypeScript source (compiled to dist/)
│   ├── index.ts          # Homebridge entry point
│   ├── platform.ts       # Platform plugin (HomeKit integration)
│   ├── types/            # Type definitions
│   ├── errors/           # Structured error hierarchy
│   ├── api/              # API client components
│   │   ├── client.ts     # HTTP client with rate limiting, caching
│   │   ├── websocket.ts  # WebSocket client with auto-reconnect
│   │   ├── rate-limiter.ts
│   │   ├── circuit-breaker.ts
│   │   ├── cache.ts
│   │   ├── request-queue.ts
│   │   └── persistence.ts
│   └── utils/            # Utility functions
│       ├── validators.ts
│       ├── sanitizers.ts
│       ├── retry.ts
│       └── logger.ts
├── dist/                 # Compiled JavaScript (auto-generated)
├── tests/
│   ├── setup.js          # Jest setup
│   └── unit/             # Unit tests (306 tests, 95%+ coverage)
│       └── *.test.ts
├── config.schema.json    # Homebridge UI configuration schema
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── jest.config.js        # Test configuration
├── eslint.config.js      # Linting rules (ESLint v9 flat config)
└── docs/                 # Additional documentation
```

## Core Components

### src/platform.ts - Platform Plugin

The main Homebridge platform implementation.

**Key Class: `LevitonDecoraSmartPlatform`**

```typescript
// Lifecycle
constructor(log, config, api)     // Initialize platform
initialize()                       // Called on didFinishLaunching
saveDeviceStates()                // Called on shutdown

// Device Management
discoverDevices()                 // Discover devices from API
addAccessory(device, token)       // Register device with Homebridge
configureAccessory(accessory)     // Restore cached accessory
setupService(accessory)           // Configure HomeKit service

// Service Setup (by device type)
setupLightbulbService(accessory, device, token)
setupFanService(accessory, device, token)
setupBasicService(accessory, device, token, ServiceType)
setupMotionDimmerService(accessory, device, token)

// Characteristic Handlers
createPowerGetter(device)
createPowerSetter(device)
createBrightnessGetter(device)
createBrightnessSetter(device)

// Real-time Updates
handleWebSocketUpdate(payload)    // WebSocket update handler
```

**Device Model Constants:**

```typescript
const DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL']
const MOTION_DIMMER_MODELS = ['D2MSD']
const OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P']
const SWITCH_MODELS = ['DW15S', 'D215S']
const CONTROLLER_MODELS = ['DW4BC']  // Skipped - no controllable state
const FAN_MODEL = 'DW4SF'
```

### src/api/client.ts - API Client

Handles all communication with the Leviton cloud.

**Key Class: `LevitonApiClient`**

| Method | Purpose |
|--------|---------|
| `login(email, password)` | Authenticate and get token |
| `getResidentialPermissions(personId, token)` | Get account permissions |
| `getResidentialAccount(accountId, token)` | Get residence info |
| `getDevices(residenceId, token)` | Fetch all devices |
| `getDeviceStatus(deviceId, token)` | Get device state |
| `setPower(deviceId, power, token)` | Turn device on/off |
| `setBrightness(deviceId, brightness, token)` | Set dimmer level |

### src/api/websocket.ts - WebSocket Client

Real-time device updates with auto-reconnection.

**Key Class: `LevitonWebSocket`**

| Method | Purpose |
|--------|---------|
| `connect()` | Establish WebSocket connection |
| `close()` | Close connection |
| `updateToken(token)` | Update auth token |
| `isConnected()` | Check connection status |

### src/ - TypeScript Modules

Reusable utility modules with full type safety.

**Error Hierarchy** (`src/errors/`):
```typescript
LevitonError (base)
├── AuthenticationError
├── TokenExpiredError
├── RateLimitError
├── DeviceOfflineError
├── DeviceNotFoundError
├── CircuitBreakerError
├── NetworkError
├── TimeoutError
├── ApiParseError
├── ApiResponseError
├── ConfigurationError
├── ValidationError
└── WebSocketError
```

**API Components** (`src/api/`):
- `client.ts` - HTTP client with retry, rate limiting, circuit breaker
- `websocket.ts` - WebSocket with auto-reconnection
- `rate-limiter.ts` - Token bucket algorithm
- `circuit-breaker.ts` - Failure protection
- `cache.ts` - TTL/LRU response cache
- `request-queue.ts` - Priority queue with deduplication
- `persistence.ts` - File-based state persistence

**Utilities** (`src/utils/`):
- `validators.ts` - Input validation
- `sanitizers.ts` - Security sanitization
- `retry.ts` - Exponential backoff with jitter
- `logger.ts` - Structured logging

## Development Workflow

### Setup

```bash
git clone https://github.com/tbaur/homebridge-myleviton.git
cd homebridge-myleviton
npm install
```

### Build TypeScript

```bash
npm run build           # Compile once
npm run build:watch     # Watch mode
npm run clean           # Remove dist/
```

### Running Tests

```bash
npm test              # Run all tests with coverage
npm run test:unit     # Run TypeScript unit tests only
npm run test:watch    # Watch mode
npm run lint          # ESLint check
npm run lint:fix      # Auto-fix lint issues
```

### Test Structure

Tests are fully mocked - no real API calls:

```javascript
// tests/setup.js - Validates test environment
if (process.env.NODE_ENV !== 'test') {
  throw new Error('Tests must run in test environment')
}

// Homebridge mocks
const mockService = { Switch: 'Switch', Lightbulb: 'Lightbulb', ... }
const mockCharacteristic = { On: 'On', Brightness: 'Brightness', ... }

// Timer mocking for clean test exit
global.testIntervals = []
const originalSetInterval = global.setInterval
global.setInterval = (fn, delay) => {
  const id = originalSetInterval(fn, delay)
  global.testIntervals.push(id)
  return id
}
```

### Coverage Thresholds

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

## Adding New Device Support

1. **Add to appropriate model array** in `src/platform.ts`:

```typescript
// For dimmers with brightness control
const DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL', 'NEW_MODEL']

// For outlets (on/off only)
const OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P', 'NEW_MODEL']

// For switches (on/off only)
const SWITCH_MODELS = ['DW15S', 'D215S', 'NEW_MODEL']
```

2. **If new service type needed**, add setup function:

```typescript
private async setupNewService(accessory: PlatformAccessory, device: DeviceInfo, token: string): Promise<void> {
  const status = await this.getStatus(device, token)
  const service = accessory.getService(hap.Service.NewType, device.name) ||
                  accessory.addService(hap.Service.NewType, device.name)
  
  const char = service.getCharacteristic(hap.Characteristic.X)
  char.on('get', this.createXGetter(device))
  char.on('set', this.createXSetter(device))
  char.updateValue(status.x)
}
```

3. **Update `setupService()`** routing:

```typescript
if (NEW_DEVICE_MODELS.includes(model)) {
  await this.setupNewService(accessory, device, token)
}
```

4. **Add tests** in `tests/unit/platform.test.ts`

5. **Update documentation**:
   - `README.md` supported devices table
   - `docs/FEATURES.md` device list
   - `docs/README-DETAILED.md` device tables

## Code Style

### ESLint Rules

- `no-var` - Use `const`/`let`
- `prefer-const` - Use `const` when not reassigned
- `prefer-arrow-callback` - Arrow functions for callbacks
- `no-unused-vars` - Prefix unused with `_`

### Conventions

```javascript
// Constants at top of file
const SOME_CONSTANT = 'value'

// Classes use PascalCase
class MyClass {}

// Functions/methods use camelCase
function myFunction() {}

// Private methods prefixed with _
_privateMethod() {}

// JSDoc for public APIs
/**
 * Description
 * @param {string} param - Description
 * @returns {Promise<Object>}
 */
```

## Debugging

### Enable Debug Logs

```json
{
  "platforms": [{
    "platform": "MyLevitonDecoraSmart",
    "loglevel": "debug"
  }]
}
```

### Structured Logging

For log aggregation tools:

```json
{
  "structuredLogs": true
}
```

Output format:
```json
{"timestamp":"2026-01-01T12:00:00.000Z","level":"info","message":"...","correlationId":"abc123"}
```

### Common Issues

| Issue | Debug Steps |
|-------|-------------|
| Devices not discovered | Check `loglevel: debug`, verify credentials |
| WebSocket disconnects | Check network, review reconnection logs |
| Rate limiting | Reduce polling, check for loops |
| Circuit breaker open | API may be down, wait for reset |

## Pre-Release Testing

### Install from GitHub

```bash
# Install directly from GitHub
sudo npm install -g github:tbaur/homebridge-myleviton

# Or specific branch/commit
sudo npm install -g github:tbaur/homebridge-myleviton#master
```

### Install from Local Clone

```bash
cd /tmp
git clone https://github.com/tbaur/homebridge-myleviton.git
cd homebridge-myleviton
npm run build  # Compile TypeScript
sudo npm install -g .
```

### Validation Checklist

Before restart:
```bash
# Backup config
cp ~/.homebridge/config.json ~/.homebridge/config.json.backup
```

After restart, verify:

| Check | How |
|-------|-----|
| Plugin loads | Look for "MyLevitonDecoraSmart" in logs |
| Devices discovered | Device names appear in logs |
| Accessories persist | Same devices in Home app, same rooms |
| Controls work | Toggle a light on/off |
| WebSocket connects | "Socket" messages in debug logs |

### Rollback

```bash
# Uninstall GitHub version
sudo npm uninstall -g homebridge-myleviton

# Reinstall stable npm version
sudo npm install -g homebridge-myleviton@3.0.0
```

## CI/CD

### GitHub Actions

`.github/workflows/test.yml` runs on push/PR:
- Node.js 20.x, 22.x
- TypeScript compilation
- Linting
- Tests with coverage
- Security audit

### Release Process

1. Update `CHANGELOG.md`
2. Bump version in `package.json`
3. Run `npm run build` and `npm test`
4. Commit and push
5. `npm publish` (manual)
6. Create GitHub release with tag

## Dependencies

### Runtime
- `sockjs-client` - WebSocket client for real-time updates

### Development
- `typescript` - TypeScript compiler
- `ts-jest` - TypeScript Jest transformer
- `@types/node` - Node.js type definitions
- `@types/jest` - Jest type definitions
- `@types/sockjs-client` - SockJS type definitions
- `jest` - Testing framework
- `eslint` - Linting
- `nock` - HTTP mocking
- `globals` - ESLint globals

## Resources

- [Homebridge Plugin Development](https://developers.homebridge.io/)
- [HomeKit Accessory Protocol](https://developer.apple.com/homekit/)

