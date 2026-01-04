# Changelog

All notable changes to homebridge-myleviton will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
