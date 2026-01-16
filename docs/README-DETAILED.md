# homebridge-myleviton — Detailed Documentation

Advanced documentation for power users, developers, and troubleshooting.

## Table of Contents

- [Architecture](#architecture)
- [Full Configuration Reference](#full-configuration-reference)
- [Device Support Details](#device-support-details)
- [How It Works](#how-it-works)
- [Advanced Troubleshooting](#advanced-troubleshooting)
- [Performance & Reliability](#performance--reliability)
- [Running as Child Bridge](#running-as-child-bridge)
- [Development](#development)
- [API Reference](#api-reference)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Homebridge                             │
├─────────────────────────────────────────────────────────────┤
│  homebridge-myleviton (TypeScript)                          │
│  ├── src/platform.ts - LevitonDecoraSmartPlatform           │
│  │   ├── Device discovery & accessory management            │
│  │   ├── HomeKit characteristic handlers                    │
│  │   └── State persistence & cleanup                        │
│  ├── src/api/client.ts - Leviton API Client                 │
│  │   ├── Authentication & token refresh                     │
│  │   ├── REST API calls (HTTPS)                             │
│  │   └── Rate limiting, caching, circuit breaker            │
│  └── src/api/websocket.ts - WebSocket client                │
│      └── Real-time device updates                           │
├─────────────────────────────────────────────────────────────┤
│  Supporting Modules (src/)                                  │
│  ├── api/     Rate limiter, circuit breaker, cache, queue   │
│  ├── utils/   Validators, sanitizers, retry, logger         │
│  ├── errors/  Structured error hierarchy                    │
│  └── types/   TypeScript definitions                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │   my.leviton.com API    │
              │   (Cloud Service)       │
              └─────────────────────────┘
```

## Full Configuration Reference

```json
{
  "platforms": [
    {
      "platform": "MyLevitonDecoraSmart",
      "name": "My Leviton",
      "email": "your@email.com",
      "password": "yourpassword",
      "loglevel": "info",
      "pollInterval": 30,
      "connectionTimeout": 10000,
      "excludedModels": [],
      "excludedSerials": [],
      "structuredLogs": false
    }
  ]
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `platform` | string | — | **Required.** Must be `"MyLevitonDecoraSmart"` |
| `name` | string | `"My Leviton"` | **Required.** Plugin instance name shown in Homebridge logs |
| `email` | string | — | **Required.** My Leviton account email |
| `password` | string | — | **Required.** My Leviton account password |
| `loglevel` | string | `"info"` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `pollInterval` | number | `30` | Seconds between state updates (min 10, max 3600) |
| `connectionTimeout` | number | `10000` | API/WebSocket timeout in ms (min 5000, max 60000) |
| `excludedModels` | string[] | `[]` | Device model numbers to exclude |
| `excludedSerials` | string[] | `[]` | Device serial numbers to exclude |
| `structuredLogs` | boolean | `false` | Output logs as JSON for log aggregation tools |

### Example: Exclude Specific Devices

```json
{
  "platform": "MyLevitonDecoraSmart",
  "email": "your@email.com",
  "password": "yourpassword",
  "excludedModels": ["DW15P"],
  "excludedSerials": ["ABC123456"]
}
```

---

## Device Support Details

### Dimmers

| Model | Name | HomeKit Features |
|-------|------|------------------|
| DW6HD | Decora Smart 600W Dimmer | On/Off, Brightness (1-100%) |
| D26HD | Decora Smart 600W Dimmer | On/Off, Brightness |
| DW1KD | Decora Smart 1000W Dimmer | On/Off, Brightness |
| DW3HL | Decora Smart 300W Dimmer | On/Off, Brightness |
| D23LP | Decora Smart Low Voltage Dimmer | On/Off, Brightness |
| DWVAA | Decora Smart Voice Dimmer | On/Off, Brightness |
| D2ELV | Decora Smart ELV/LED Phase Selectable Dimmer | On/Off, Brightness |
| D2710 | Decora Smart 0-10V Dimmer | On/Off, Brightness |

### Motion Sensor Dimmers

| Model | Name | HomeKit Features |
|-------|------|------------------|
| D2MSD | Decora Motion Sensor Dimmer | Dimmer + Motion Sensor (separate services) |

### Switches

| Model | Name | HomeKit Features |
|-------|------|------------------|
| DW15S | Decora Smart 15A Switch | On/Off |
| D215S | Decora Smart 15A Switch | On/Off |

### Outlets

| Model | Name | HomeKit Features |
|-------|------|------------------|
| DW15P | Decora Smart Plug-in Outlet | On/Off |
| DW15A | Decora Smart In-Wall Outlet | On/Off |
| DW15R | Decora Smart Tamper-Resistant Outlet | On/Off |
| D215P | Decora Smart Plug-in Switch | On/Off |
| D215O | Decora Smart Outdoor Plug-in Switch | On/Off |

### Fans

| Model | Name | HomeKit Features |
|-------|------|------------------|
| DW4SF | Decora Smart Fan Controller | On/Off, Speed (25/50/75/100%) |
| D24SF | Decora Smart Fan Controller (2nd Gen) | On/Off, Speed (25/50/75/100%) |

---

## How It Works

### Authentication Flow

1. Plugin authenticates with My Leviton API using email/password
2. Receives an access token (with TTL provided by the API)
3. Automatically refreshes token before expiration
4. On 401 errors, attempts re-authentication and retries once

### Device Discovery

1. Fetches all residences from account
2. For each residence, fetches residential permissions
3. For each permission, fetches switches (devices)
4. Creates HomeKit accessories for supported devices
5. Persists device data for faster subsequent startups

### Real-Time Updates

1. Establishes WebSocket connection to My Leviton
2. Subscribes to all device state changes
3. Instantly updates HomeKit when device state changes
4. Auto-reconnects with exponential backoff on disconnect
5. Polling runs continuously as safety net alongside WebSocket

### State Persistence

Device data is cached to `~/.homebridge/.homebridge-myleviton-state.json`:
- Enables faster startup (devices appear immediately)
- Provides fallback if API is temporarily unavailable
- Automatically refreshed on successful API calls

---

## Advanced Troubleshooting

### Debug Mode

Enable verbose logging:

```json
{
  "platform": "MyLevitonDecoraSmart",
  "email": "...",
  "password": "...",
  "loglevel": "debug"
}
```

Debug logs show:
- API requests and responses
- WebSocket connection events
- Device discovery details
- Characteristic get/set operations

### Common Issues

#### "No devices found"

1. Verify credentials work in My Leviton app
2. Check devices are online in My Leviton app
3. Ensure devices are associated with your account
4. Check for `excludedModels`/`excludedSerials` in config

#### "Authentication failed"

1. Double-check email and password
2. Try logging out/in on My Leviton app
3. Check for special characters in password (try URL encoding)
4. Ensure no MFA/2FA is enabled on account

#### "WebSocket disconnected"

- This is normal; plugin auto-reconnects
- Check firewall allows `wss://my.leviton.com`
- If frequent, check internet stability

#### Devices show wrong state

1. Control device from My Leviton app to sync
2. Restart Homebridge to force full refresh
3. Delete `~/.homebridge/.homebridge-myleviton-state.json` and restart

### Log Locations

| Platform | Location |
|----------|----------|
| Homebridge UI | Logs tab |
| macOS | `~/.homebridge/homebridge.log` |
| Linux | `journalctl -u homebridge` |
| Docker | `docker logs homebridge` |

---

## Performance & Reliability

### Built-in Protections

| Feature | Description |
|---------|-------------|
| **Rate Limiting** | 300 writes/minute to prevent API throttling |
| **Response Caching** | 2-second TTL reduces redundant API calls |
| **Request Deduplication** | Identical concurrent requests share one API call |
| **Circuit Breaker** | Stops requests during API outages, auto-recovers |
| **Auto-Reconnect** | WebSocket reconnects with exponential backoff |
| **Token Refresh** | Proactive token refresh before expiration |

### Resource Cleanup

On shutdown, the plugin:
- Closes all WebSocket connections
- Clears all timers and intervals
- Saves device state to disk

---

## Running as Child Bridge

For improved stability, run as a child bridge:

1. In Homebridge UI, go to **Plugins**
2. Click the wrench icon on `homebridge-myleviton`
3. Enable **Child Bridge**
4. Restart Homebridge

Benefits:
- Plugin crashes don't affect other plugins
- Separate HomeKit bridge = independent pairing
- Can restart plugin without restarting Homebridge

---

## Development

### Prerequisites

- Node.js 20+
- npm 9+

### Setup

```bash
git clone https://github.com/tbaur/homebridge-myleviton.git
cd homebridge-myleviton
npm install
npm run build
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to dist/ |
| `npm test` | Run all tests |
| `npm run lint` | Check code style |
| `npm run lint:fix` | Auto-fix style issues |

### Project Structure

```
homebridge-myleviton/
├── src/                  # TypeScript source
│   ├── index.ts          # Homebridge entry point
│   ├── platform.ts       # Platform plugin
│   ├── api/              # API client & utilities
│   ├── utils/            # General utilities
│   ├── errors/           # Error classes
│   └── types/            # Type definitions
├── dist/                 # Compiled JavaScript
├── tests/
│   └── unit/*.test.ts    # Unit tests (400+ tests)
└── config.schema.json    # Homebridge UI config schema
```

### Testing

```bash
# All tests
npm test

# With coverage
npm test -- --coverage

# Specific test file
npm test -- tests/unit/cache.test.ts
```

Coverage threshold: 80% (statements, branches, functions, lines)

---

## API Reference

### MyLevitonDecoraSmartPlatform

Main platform class registered with Homebridge.

**Constructor:**
- `log` — Homebridge logger
- `config` — Platform config from config.json
- `api` — Homebridge API

**Key Methods:**
- `_validateConfig()` — Validates required config fields
- `_discoverDevices()` — Fetches and creates accessories
- `_addAccessory(device)` — Creates HomeKit accessory for device
- `removeAccessories()` — Unregisters all accessories

### Leviton API Client

Handles all communication with My Leviton cloud.

**Key Methods:**
- `login(email, password)` — Authenticate and get tokens
- `refreshToken()` — Refresh access token
- `getResidences()` — Fetch user's residences
- `getSwitches(residenceId)` — Fetch devices for residence
- `updateSwitch(id, data)` — Update device state
- `subscribe(residenceId, callback)` — WebSocket subscription

---

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](../LICENSE) file for details.

