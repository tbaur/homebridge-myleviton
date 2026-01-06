# Features

**homebridge-myleviton v3.0.0**

## Core Features

- ✅ Automatic device discovery from My Leviton cloud
- ⚠️ WebSocket real-time updates (currently blocked by Leviton server - see note below)
- ✅ Rate limiting for write operations (300/min)
- ✅ Response caching (2s TTL)
- ✅ Request deduplication
- ✅ API request timeouts (10s)
- ✅ Circuit breaker pattern for API resilience
- ✅ Device state persistence for faster startup
- ✅ Structured JSON logging (optional)
- ✅ Token auto-refresh on 401
- ✅ Homebridge v1.6.0+ and v2.0+ support
- ✅ Node.js 20+ support

## Supported Devices

| Type | Models |
|------|--------|
| **Dimmers** | DW6HD, D26HD, DW1KD, DW3HL, D23LP, DWVAA, D2ELV, D2710 |
| **Motion Sensor Dimmers** | D2MSD (dimmer + motion sensor in HomeKit) |
| **Outlets** | DW15P, DW15A, DW15R, D215P, D215O |
| **Fans** | DW4SF, D24SF |
| **Switches** | DW15S, D215S |
| **Controllers** | DW4BC (skipped - no controllable state) |

## Architecture

```
homebridge-myleviton/
├── src/
│   ├── index.ts          # Homebridge entry point
│   ├── platform.ts       # Platform plugin (device discovery, HomeKit services)
│   ├── api/              # API client, cache, rate-limiter, circuit-breaker
│   ├── utils/            # Validators, sanitizers, retry, logger
│   ├── errors/           # Structured error hierarchy
│   └── types/            # TypeScript type definitions
├── dist/                 # Compiled JavaScript (auto-generated)
└── tests/
    └── unit/*.test.ts    # Unit tests (95%+ coverage)
```

## Quality

- 306 tests passing
- 95%+ code coverage
- ESLint with zero warnings
- TypeScript strict mode
- Full JSDoc documentation

## Known Limitations

### WebSocket Real-Time Updates

The plugin includes WebSocket support for real-time device updates, but Leviton's server currently rejects the authentication. The REST API token is not accepted for WebSocket connections.

**Impact:** Device control works perfectly via REST API. Changes made in HomeKit are reflected immediately. However, changes made in the My Leviton app may take a few seconds to appear in HomeKit.

**Status:** Leviton support has been contacted for WebSocket API documentation.

## Future Considerations

- WebSocket authentication (pending Leviton support response)
- Additional device model support as Leviton releases new products
- Performance profiling and optimization

