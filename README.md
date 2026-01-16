# homebridge-myleviton

[![Tests](https://github.com/tbaur/homebridge-myleviton/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-myleviton/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-myleviton?style=flat-square)](https://www.npmjs.com/package/homebridge-myleviton)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-myleviton?style=flat-square)](https://www.npmjs.com/package/homebridge-myleviton)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![Homebridge](https://img.shields.io/badge/homebridge-%3E%3D1.6.0-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Control your **My Leviton Decora Smart** WiFi devices through Apple HomeKit using Homebridge.

## Features

### Device Control
- **Automatic Discovery** — Instantly finds all devices from your My Leviton account
- **Full Dimmer Support** — On/off and brightness control (1-100%)
- **Fan Speed Control** — 4-speed fan controllers (25/50/75/100%)
- **Switches & Outlets** — On/off control for all switch and outlet types
- **Motion Sensors** — D2MSD motion dimmers expose both dimmer and motion sensor

### Reliability
- **Real-Time Updates** — Instant state sync via WebSocket
- **Automatic State Sync** — Polls device state every 30 seconds as safety net
- **Rate Limiting** — Prevents API throttling (300 requests/minute)
- **Circuit Breaker** — Graceful degradation during API outages
- **Auto-Reconnect** — Automatically recovers from connection issues
- **State Persistence** — Faster startup with cached device data
- **Token Auto-Refresh** — Seamless authentication management

### Quality
- **400+ Tests** — Comprehensive test suite with 95%+ code coverage
- **Child Bridge Support** — Run as isolated bridge for maximum stability
- **Flexible Logging** — Debug, info, warn, error levels + JSON structured logs
- **No Analytics** — Zero tracking or data collection
- **Well Documented** — Detailed docs for users and developers

## Quick Start

### 1. Install

**Homebridge UI** (recommended):  
Plugins → Search `homebridge-myleviton` → Install

**Command line:**
```bash
npm install -g homebridge-myleviton
```

### 2. Configure

Add to your Homebridge config:

```json
{
  "platforms": [
    {
      "platform": "MyLevitonDecoraSmart",
      "name": "My Leviton",
      "email": "your@email.com",
      "password": "yourpassword"
    }
  ]
}
```

### 3. Restart Homebridge

Your devices will appear in the Home app automatically.

## Supported Devices

| Type | Examples |
|------|----------|
| **Dimmers** | DW6HD, D26HD, DW1KD, DW3HL, D23LP, DWVAA, D2ELV, D2710 |
| **Switches** | DW15S, D215S |
| **Outlets** | DW15P, DW15A, DW15R, D215P, D215O |
| **Fans** | DW4SF, D24SF |
| **Motion Dimmers** | D2MSD |

## Configuration Options

`name` is required by Homebridge UI and identifies this plugin instance in logs (defaults to "My Leviton").

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ | Plugin instance name shown in Homebridge logs |
| `email` | ✓ | My Leviton account email |
| `password` | ✓ | My Leviton account password |
| `loglevel` | | `debug`, `info` (default), `warn`, `error` |
| `pollInterval` | | Seconds between state updates (default: 30) |
| `connectionTimeout` | | API/WebSocket timeout in ms (default: 10000) |
| `excludedModels` | | Device models to skip, e.g. `["DW15P"]` |
| `excludedSerials` | | Device serials to skip |
| `structuredLogs` | | Output logs as JSON for log aggregation tools |

## Not Working?

1. **Check credentials** — Must match the My Leviton app exactly
2. **Check device status** — Devices must be online in My Leviton app
3. **Enable debug logs** — Set `"loglevel": "debug"` and restart
4. **Restart Homebridge** — Required after any config change

## Requirements

- Homebridge 1.6.0+ or 2.0+
- Node.js 20+
- My Leviton account with registered devices

## More Info

- [Details](docs/README-DETAILED.md)
- [Report Issues](https://github.com/tbaur/homebridge-myleviton/issues)
- [Changelog](CHANGELOG.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.
