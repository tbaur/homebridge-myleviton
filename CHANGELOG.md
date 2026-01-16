# Changelog

All notable changes to homebridge-myleviton will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.8] - 2026-01-16

### Fixed
- Fixed WebSocket connection timeout firing immediately when `connectionTimeout` not configured
  (undefined value was overwriting the 10s default, causing instant timeout)

---

## [3.2.7] - 2026-01-15

### Fixed
- Fixed "illegal value: number 0 exceeded minimum of 1" for cached dimmer accessories

---

## [3.2.6] - 2026-01-15

### Fixed
- Poll interval configuration now honors `pollInterval` (legacy `pollingInterval` still supported)
- Token refresh now respects TTL and retries once on authentication errors
- WebSocket reconnect attempts resume after token refresh
- Fixed listener stacking on cached switch/outlet accessories (duplicate API calls)
- Fan speed now correctly allows 0% (was incorrectly clamped to 1%)
- WebSocket connection timeout now honors `connectionTimeout` config

### Changed
- Config validation now uses comprehensive schema validation with detailed error messages
- Config validation now enforces required `name` field (matching schema)
- Added `connectionTimeout` to config schema and documentation
- Added `structuredLogs` to README documentation
- Updated docs/FEATURES and docs/REVIEW test counts and version metadata
- Added tests for WebSocket config wiring and required `name`
- `test:integration` now passes when no integration tests exist
- Removed unused Jest transform for `babel-jest`

---

## [3.2.5] - 2026-01-14

### Fixed
- Token refresh race condition: no longer assumes token exists after wait
- Tests now cover D2ELV, D2710 dimmers and D24SF fan controller
- Updated DEVELOPMENT.md with current device model lists

---

## [3.2.4] - 2026-01-13

### Improved
- Clarified logging: removed misleading "Starting device polling" message
- Updated documentation: polling is a "safety net" (always runs), not a "fallback"

---

## [3.2.3] - 2026-01-13

### Improved
- WebSocket close events now logged with human-readable descriptions (e.g., `1006 (connection dropped)`)

---

## [3.2.2] - 2026-01-13

### Added
- WebSocket ping keepalive (every 30s) to prevent idle disconnections

---

## [3.2.1] - 2026-01-13

### Fixed
- WebSocket updates now correctly match devices (fixed type comparison issue)

---

## [3.2.0] - 2026-01-13

### Added
- **Real-time WebSocket updates** — Device state changes now sync instantly
  - Uses native WebSocket connection to `wss://my.leviton.com/socket/websocket`
  - Automatically reconnects with exponential backoff
  - Polling runs continuously as safety net

### Changed
- Replaced SockJS with native WebSocket (`ws` package)
- Polling runs continuously as safety net for reliability

---

## [3.1.1] - 2026-01-05

### Added
- Support for D2ELV (Decora Smart ELV/LED Phase Selectable Dimmer)
- Support for D2710 (Decora Smart 0-10V Dimmer Switch)
- Support for D24SF (Decora Smart Fan Speed Controller, 2nd Gen)

### Note
- v3.1.0 was unpublished due to release process issue; this release contains the same changes

---

## [3.0.6] - 2026-01-05

### Added
- Support for D215O (Decora Smart Outdoor Plug-in Switch)

## [3.0.5] - 2026-01-04

### Changed
- Moved "Name" field from Account Credentials to General Settings section as the first entry

---

## [3.0.4] - 2026-01-04

### Fixed
- Fixed `config.schema.json` to comply with Homebridge verification requirements
  - Moved `required` from individual properties to object-level array
  - Added required `name` property for plugin instance identification

---

## [3.0.3] - 2026-01-04

### Added
- **External change logging** for device state changes detected via polling
  - Logs changes: `Device: ON (external)`
  - Only logs when state actually changes (not every poll cycle)
  - Distinguishes from HomeKit commands which show latency

---

## [3.0.2] - 2026-01-04

### Fixed
- Fixed structured logger appending JSON context to non-structured log output

---

## [3.0.1] - 2026-01-04

### Added
- **End-to-end latency logging** for device control operations
  - Power and brightness changes now log round-trip latency: `Device: ON (Latency: 142ms)`
  - Measures complete request time including token refresh and API call
  - Helps diagnose slow responses and network issues
- **Structured JSON logging** now includes `deviceId`, `operation`, and `duration` fields
  - Enable with `"structuredLogs": true` in config
  - Example: `{"level":"info","message":"Device: ON (Latency: 142ms)","deviceId":"abc123","operation":"setPower","duration":142}`

### Changed
- Upgraded internal logger to `StructuredLogger` for richer context support

---

## [3.0.0] - 2026-01-03

### Added
- Initial release of homebridge-myleviton
- Full TypeScript implementation
- Support for My Leviton Decora Smart WiFi devices
- Automatic device discovery
- Real-time WebSocket updates with auto-reconnection
- Rate limiting for write operations (300/min)
- Response caching (2s TTL)
- Request deduplication
- API request timeouts (10s)
- Circuit breaker pattern
- Device state persistence
- Structured logging (optional)
- Token auto-refresh on 401
- Homebridge v1.6.0+ and v2.0+ support
- Node.js 20+, 22+, 24+, and 25+ support
- Comprehensive test suite (306 tests, 95%+ coverage)

### Supported Devices
- Dimmers: DW6HD, D26HD, DW1KD, DW3HL, D23LP, DWVAA
- Motion Sensor Dimmers: D2MSD (dimmer + motion sensor in HomeKit)
- Outlets: DW15P, DW15A, DW15R, D215P
- Fans: DW4SF
- Switches: DW15S, D215S
- Skipped: DW4BC (button controller - no controllable state)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/tbaur/homebridge-myleviton/issues)
- **Documentation**: See `docs/` directory
- **Tests**: Run `npm test`
