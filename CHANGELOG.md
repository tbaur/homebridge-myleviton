# Changelog

All notable changes to homebridge-myleviton will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.7.7](https://github.com/tbaur/homebridge-myleviton/compare/v3.7.6...v3.7.7) (2026-06-14)


### Bug Fixes

* stop adding Brightness to fan/switch/outlet on shutdown ([#33](https://github.com/tbaur/homebridge-myleviton/issues/33)) ([282cc30](https://github.com/tbaur/homebridge-myleviton/commit/282cc30d7269636f6ff029739848f927540cad2d))

## [3.7.6](https://github.com/tbaur/homebridge-myleviton/compare/v3.7.5...v3.7.6) (2026-06-14)


### Bug Fixes

* restore plain-text Homebridge logs without JSON context ([#31](https://github.com/tbaur/homebridge-myleviton/issues/31)) ([d0bd11e](https://github.com/tbaur/homebridge-myleviton/commit/d0bd11eee1ef6cf6670b3c313265037a0d11d1d3))

## [3.7.5](https://github.com/tbaur/homebridge-myleviton/compare/v3.7.4...v3.7.5) (2026-06-14)


### Bug Fixes

* principal engineering audit hardening ([#29](https://github.com/tbaur/homebridge-myleviton/issues/29)) ([e0264f0](https://github.com/tbaur/homebridge-myleviton/commit/e0264f04164794a19e7a1040dcbdb1e213da512f))

## [3.7.4](https://github.com/tbaur/homebridge-myleviton/compare/v3.7.3...v3.7.4) (2026-06-14)


### Bug Fixes

* drop static device inventory from diagnostics log lines ([#27](https://github.com/tbaur/homebridge-myleviton/issues/27)) ([c6bfb37](https://github.com/tbaur/homebridge-myleviton/commit/c6bfb3759b2b3bff561adf12ba55e85990cc3f61))

## [3.7.3](https://github.com/tbaur/homebridge-myleviton/compare/v3.7.2...v3.7.3) (2026-06-14)


### Bug Fixes

* clarify device counts in discovery and diagnostics logs ([#25](https://github.com/tbaur/homebridge-myleviton/issues/25)) ([12a8614](https://github.com/tbaur/homebridge-myleviton/commit/12a8614d869b40948ecfa0273083bcd5937c66c8))

## [3.7.2](https://github.com/tbaur/homebridge-myleviton/compare/v3.7.1...v3.7.2) (2026-06-14)


### Bug Fixes

* use title-case labels in diagnostics log lines ([#23](https://github.com/tbaur/homebridge-myleviton/issues/23)) ([e709f0d](https://github.com/tbaur/homebridge-myleviton/commit/e709f0dca4223ef2cacea8e3abdd0eca74e3376e))

## [3.7.1](https://github.com/tbaur/homebridge-myleviton/compare/v3.7.0...v3.7.1) (2026-06-14)


### Bug Fixes

* render diagnosticsInterval in the Homebridge config UI ([#21](https://github.com/tbaur/homebridge-myleviton/issues/21)) ([0a7fff9](https://github.com/tbaur/homebridge-myleviton/commit/0a7fff94762cdf7c4aaf16149fe17d7698c263de))

## [3.7.0](https://github.com/tbaur/homebridge-myleviton/compare/v3.6.0...v3.7.0) (2026-06-14)


### Features

* add opt-in diagnostics subsystem ([#18](https://github.com/tbaur/homebridge-myleviton/issues/18)) ([cdb8740](https://github.com/tbaur/homebridge-myleviton/commit/cdb8740bf7efafd321a305d0d181d7a60fbd16b0))


### Bug Fixes

* address diagnostics review findings ([#20](https://github.com/tbaur/homebridge-myleviton/issues/20)) ([5cf13b9](https://github.com/tbaur/homebridge-myleviton/commit/5cf13b9f732ad3cfb4b8e6cb2e3fb0d31475d12e))

## [3.6.0](https://github.com/tbaur/homebridge-myleviton/compare/v3.5.0...v3.6.0) (2026-06-13)


### Features

* add optional cloud-connectivity status sensor ([#16](https://github.com/tbaur/homebridge-myleviton/issues/16)) ([3e0839b](https://github.com/tbaur/homebridge-myleviton/commit/3e0839b0c496642a7eedfbe62582b17d24de45d7))

## [3.5.0](https://github.com/tbaur/homebridge-myleviton/compare/v3.4.10...v3.5.0) (2026-06-13)


### Features

* reliability and security hardening ([#12](https://github.com/tbaur/homebridge-myleviton/issues/12)) ([27ff583](https://github.com/tbaur/homebridge-myleviton/commit/27ff5836350539b2626464d4c39710d770a8ef98))

## [3.4.10](https://github.com/tbaur/homebridge-myleviton/compare/v3.4.9...v3.4.10) (2026-06-13)


### Bug Fixes

* stop persisting auth token in accessory cache ([#8](https://github.com/tbaur/homebridge-myleviton/issues/8)) ([ad99593](https://github.com/tbaur/homebridge-myleviton/commit/ad995930598b501b9b2a2f84b6b574ccd862f930))

## [3.4.9](https://github.com/tbaur/homebridge-myleviton/compare/v3.4.8...v3.4.9) (2026-06-13)


### Bug Fixes

* prevent double-logging in WebSocket logger wrapper ([#5](https://github.com/tbaur/homebridge-myleviton/issues/5)) ([0d68ca9](https://github.com/tbaur/homebridge-myleviton/commit/0d68ca92f012fff8f788096e9a961e20f1984f3c))

## [3.4.8] - 2026-05-25

### Added
- **Support for DN6HD dimmer switch** (Decora Smart 600W Dimmer, 2nd Gen)
  - Recognized as a dimmer with full On/Off and Brightness (1-100%) control in HomeKit
  - Previously fell through to the unknown-model fallback and was treated as a plain switch
  - Closes [#3](https://github.com/tbaur/homebridge-myleviton/issues/3)

---

## [3.4.7] - 2026-05-04

### Fixed
- **Fixed HAP-NodeJS `invalid 'Name' characteristic` warnings firing every restart on cached accessories**
  - **Root cause:** HAP-NodeJS's `Service.deserialize` reconstructs each cached service via `new Constructor(json.displayName, json.subtype)`, and the `Service` constructor calls `checkName(this.displayName, "Name", displayName)` whenever `displayName` is non-empty. Because the warning text format (`accessory '<X>' has an invalid 'Name' characteristic ('<X>')`) is identical for the `Accessory` and `Service` constructor paths, 3.4.4–3.4.6 only sanitized the accessory's `displayName` and the `Name` characteristic value — but never mutated the `service.displayName` field that HAP-NodeJS writes on `Service.serialize` and re-reads on every load. The cache JSON kept the old invalid `services[i].displayName`, so the warning re-fired on every restart even after the cache rewrite.
  - **Fix:** `configureAccessory()` (and `syncAccessoryMetadata()` for refresh paths) now iterate every service on the accessory and sanitize `service.displayName` directly. The sanitized value is also pushed into the `Name` characteristic when it exists, and the cache is flushed synchronously via `api.updatePlatformAccessories([accessory])` whenever any service required a rewrite — even when the accessory's own `displayName` was already HAP-valid.

### Changed
- `normalizeCachedAccessoryNames()` evaluates service mutations *before* delegating to `syncAccessoryMetadata()`, so the cache-flush decision sees the pre-mutation state instead of the idempotent post-mutation state.

### Added
- New regression tests assert that `service.displayName` is rewritten in place, that already-clean services skip the cache flush, and that an accessory whose own `displayName` is valid still triggers a rewrite when only its services carry stale invalid characters.

---

## [3.4.6] - 2026-05-04

### Fixed
- **Fixed persistent HAP-NodeJS `invalid 'Name' characteristic` warnings on every restart**
  - The warning is emitted by HAP-NodeJS during cache deserialization (`Accessory` constructor), which runs *before* `configureAccessory()` and *before* `didFinishLaunching`. Earlier versions sanitized in memory but never persisted the cleaned cache file synchronously, so the bad `displayName` field on disk re-triggered the warning every restart.
  - `configureAccessory()` now sanitizes the cached `displayName` from whatever Homebridge deserialized (rather than only `context.device.name`), normalizes `context.device.name`, and immediately calls `api.updatePlatformAccessories([accessory])` to flush a HAP-valid cache file synchronously. After the upgrade restart, subsequent restarts emit no warnings.
  - Accessory display name updates now propagate to the underlying HAP `Accessory.displayName` (via `PlatformAccessory.updateDisplayName()` when available, with a fallback for older runtimes), so the value HAP-NodeJS validates and HomeKit advertises stays in sync with the wrapper.
- **Fixed `sanitizeHapName` over-stripping characters HAP actually allows**
  - The character class now mirrors HAP-NodeJS `checkName()` exactly: Unicode letters/numbers, space, ASCII apostrophe, U+2019 right single quotation mark, comma, period, and hyphen.
  - Names that are already HAP-valid pass through unchanged; only invalid characters trigger rewrites and a cache flush.

### Added
- New `isValidHapName()` helper exported from `src/utils/sanitizers` for callers that want to skip work on already-valid names.

### Changed
- Regression coverage for `configureAccessory()` now asserts that `api.updatePlatformAccessories` is invoked with the sanitized accessory, that already-valid names skip the rewrite, and that `accessory.updateDisplayName()` is preferred when present.

---

## [3.4.5] - 2026-05-04

### Fixed
- **Fixed cached Homebridge 2.0 HAP name warnings during accessory load**
  - Cached accessories now sanitize their `displayName`, `AccessoryInformation.Name`, and existing service names synchronously in `configureAccessory()`
  - Prevents HAP-NodeJS from warning on stale cached names before the platform finishes Leviton API discovery

---

## [3.4.4] - 2026-05-04

### Fixed
- **Fixed Homebridge 2.0 HAP name validation warnings for Leviton device names**
  - Accessory and service names are now sanitized before being passed to Homebridge/HAP
  - Keeps the latest Leviton device name as the source of truth while removing unsupported HomeKit name characters such as `#`
  - Cached accessories now resync their display name and `AccessoryInformation.Name` on startup so renamed Leviton devices stop warning without manual cache cleanup
- **Fixed cached accessory cleanup for newly excluded devices**
  - Accessories already cached by Homebridge are now removed when their model or serial is added to an exclusion list
- **Fixed startup state resets during temporary Leviton API failures**
  - Cached accessories now preserve their current HomeKit state when status fetches fail during service setup
  - Falls back to persisted device state before using default off/zero values
- **Fixed request queue deduplication for queued requests**
  - Duplicate requests now share a single queued or in-flight promise instead of only deduping after execution starts
- **Fixed WebSocket recovery after remote normal closes**
  - Remote close code `1000` now schedules reconnects so push updates resume automatically

### Changed
- Added regression coverage for HAP-safe name sanitization and cached accessory name syncing
- Refreshed development dependency lockfile metadata after audit cleanup
- Removed the unused package `VERSION` export

---

## [3.4.3] - 2026-02-26

### Fixed
- **Fixed overlapping polling cycles under slow API responses**
  - Added an in-flight polling guard so interval ticks skip while a previous poll cycle is still running
  - Prevents concurrent poll storms and reduces stale/out-of-order update risk
- **Fixed sequential polling bottleneck for larger device sets**
  - `pollDevices()` now uses bounded concurrency workers instead of strict serial polling
  - Preserves per-device error isolation and current-state preservation behavior on failures
- **Fixed token refresh retry storms after login failures**
  - Added short refresh-failure cooldown to prevent repeated immediate login attempts during auth/API outages
  - Keeps existing token refresh deduplication and 2FA poison-guard behavior intact
- **Fixed potential duplicate WebSocket reconnect scheduling**
  - Added single-flight reconnect timer tracking to ensure only one reconnect is pending at a time
  - Reconnect timer state now resets correctly on successful connect and explicit close

### Changed
- Expanded reliability regression coverage for polling, token refresh cooldown, and WebSocket reconnect deduplication
- Added targeted tests for overlap prevention, bounded polling concurrency, reconnect single-flight behavior, and close-time reconnect cancellation

---

## [3.4.2] - 2026-02-08

### Fixed
- **Fixed "plugin slows down Homebridge" warnings for On and Brightness characteristics**
  - Removed slow `on('get')` handlers that made HTTP API calls on every HomeKit read
  - Homebridge now returns cached values set by `updateValue()`, kept current by WebSocket push updates and polling
  - Eliminates all network calls during HomeKit reads, making responses instantaneous
- **Fixed WebSocket/polling updates dropping power state for switches and outlets**
  - When a payload included `brightness` for a non-dimmer device, an early `return` skipped the power state update
  - Switch and outlet devices could silently stop updating during polling cycles
- **Fixed double API call during motion dimmer setup**
  - `setupMotionDimmerService` was calling `getStatus()` twice (once internally via `setupLightbulbService`, once directly)
  - Now reuses the status returned by `setupLightbulbService`, halving startup API calls for motion dimmers
- **Fixed WebSocket ignoring `motion` field in device notifications**
  - The `motion` field from Leviton API notifications was silently dropped
  - Now forwarded alongside `occupancy` for motion sensor dimmer devices (D2MSD)

### Removed
- `createPowerGetter` and `createBrightnessGetter` methods (no longer needed with push-based state)

---

## [3.4.1] - 2026-02-05

### Fixed
- **Fixed polling updating HomeKit with wrong values during API outages**
  - When Leviton API returns 502/503, polling now preserves current HomeKit state
  - Previously, fallback values (OFF/0%) were incorrectly pushed to HomeKit
  - This caused devices to show as OFF during API outages, then flip back when recovered

---

## [3.4.0] - 2026-02-05

### Fixed
- **Fixed accessory cache growth bug** causing duplicate accessories on restart
  - Root cause: `configureAccessory` was async, but Homebridge doesn't await it
  - Race condition caused accessories array to be incomplete when `didFinishLaunching` fired
  - Some devices were incorrectly added as "new" despite being cached
- **Fixed polling returning undefined power/brightness values**
  - Was incorrectly casting `DeviceInfo` to `DeviceStatus` (type mismatch)
  - Now properly fetches actual device status from API
- **Fixed stale cached API responses after WebSocket updates**
  - Cache is now invalidated when real-time updates arrive
  - Ensures next status request fetches fresh data

### Added
- **Automatic cache deduplication on startup**
  - Removes duplicate cache entries (same UUID appearing multiple times)
  - Runs as a permanent safeguard on every startup
  - Logs cleanup: `Removed N duplicate cache entries (M unique accessories)`
  - Safe operation: duplicates share same UUID, invisible to HomeKit
- **Improved accessory context persistence**
  - Cached accessory contexts now updated with fresh device data on startup
  - Token properly persisted via `updatePlatformAccessories()`

### Changed
- `configureAccessory` is now synchronous (service setup deferred to initialization)
- Accessory matching uses case-insensitive serial comparison for robustness

---

## [3.3.1] - 2026-02-01

### Changed
- Plugin is now Homebridge Verified

---

## [3.3.0] - 2026-01-15

### Fixed
- Fixed duplicate logging when controlling devices via HomeKit (was showing both "external" and "latency" entries)
  - WebSocket updates from HomeKit commands are now properly deduplicated
  - "External" logs now only appear for changes from physical switches or Leviton app/website

---

## [3.2.9] - 2026-01-15

### Fixed
- Fixed cached accessory matching failing due to type/case differences in serial numbers
  (now normalizes to uppercase strings before comparison)

---

## [3.2.8] - 2026-01-15

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
