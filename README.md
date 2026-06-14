# homebridge-myleviton

[![Tests](https://github.com/tbaur/homebridge-myleviton/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-myleviton/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-myleviton?style=flat-square)](https://www.npmjs.com/package/homebridge-myleviton)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-myleviton?style=flat-square)](https://www.npmjs.com/package/homebridge-myleviton)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Homebridge](https://img.shields.io/badge/homebridge-%3E%3D1.6.0-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Control your **My Leviton Decora Smart** WiFi devices through Apple HomeKit using Homebridge.

## Features

### Device Control
- **Automatic Discovery** — Instantly finds all devices from your My Leviton account
- **Full Dimmer Support** — On/off and brightness control (1-100%)
- **Fan Speed Control** — Continuous rotation speed via HomeKit slider (0–100%)
- **Switches & Outlets** — On/off control for all switch and outlet types
- **Motion Sensors** — D2MSD motion dimmers expose both dimmer and motion sensor

### Reliability
- **Real-Time Updates** — Instant state sync via WebSocket
- **Automatic State Sync** — Polls device state every 30 seconds as safety net (also refreshes motion/occupancy)
- **Automatic Retry** — Transient network and 5xx errors are retried with exponential backoff
- **Self-Healing Startup** — Retries device discovery after a transient outage at boot instead of staying offline until restart
- **Rate Limiting** — Prevents API throttling (300 requests/minute)
- **Circuit Breaker** — Graceful degradation during API outages, with state transitions surfaced in the logs
- **Auto-Reconnect** — Automatically recovers from connection issues
- **Account Isolation** — Each configured account has its own circuit breaker, rate limiter, and cache
- **State Persistence** — Faster startup with cached device data
- **Token Auto-Refresh** — Seamless authentication management
- **Connectivity Sensor** *(optional)* — Exposes a HomeKit contact sensor that reports whether the plugin can reach the Leviton cloud, so you can alert or automate on outages
- **Diagnostics** *(optional)* — Opt-in health/activity heartbeat, boot/shutdown snapshots, and degraded/recovered transitions logged to Homebridge (logs/JSON only, never in HomeKit)

### Quality
<!-- Canonical test count lives here only; keep other docs number-free to avoid 5-place updates. -->
- **557 Tests** — Comprehensive test suite with ~91% code coverage (includes `platform.ts`)
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
| **Dimmers** | DW6HD, D26HD, DN6HD, DW1KD, DW3HL, D23LP, DWVAA, D2ELV, D2710 |
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
| `connectivitySensor` | | Expose a HomeKit contact sensor for Leviton cloud reachability (default: off) |
| `connectivitySensorName` | | Name for the connectivity sensor (default: "Leviton Cloud") |
| `diagnosticsInterval` | | Seconds between diagnostics health heartbeats in the logs; `0` disables (default), else `30`–`3600` |

## Not Working?

1. **Check credentials** — Must match the My Leviton app exactly
2. **Check device status** — Devices must be online in My Leviton app
3. **Enable debug logs** — Set `"loglevel": "debug"` and restart
4. **Restart Homebridge** — Required after any config change

## Security

Leviton's API has no OAuth or scoped tokens, so this plugin needs your **actual My Leviton account password**. Homebridge stores plugin config in plain text, which means your password lives unencrypted in `config.json` on the Homebridge host — this is a Homebridge limitation, not something the plugin can encrypt away (the process needs the cleartext to log in).

What this means for you:

- **Secure the Homebridge host.** Anyone who can read files on it can read your password. Use disk encryption and restrict OS accounts where practical.
- **Consider a dedicated Leviton account** for HomeKit so the bridge isn't holding your primary credentials.
- **Scrub before sharing.** When posting logs or sharing backups, redact both `config.json` and `~/.homebridge/accessories/cachedAccessories`.

The plugin itself talks to Leviton over TLS only (`https`/`wss`), redacts passwords and tokens from its logs, and does not persist the auth token to disk.

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
