# Security, Reliability, Maintainability & Serviceability Review

*Last reviewed: 2026-06-14 (post principal engineering audit — fixes applied in 3.7.5)*

This document is a **point-in-time assessment** after a distinguished/principal-level
code review. It reflects the current codebase, not a claim of zero defects.

---

## Security — Strong

| Area | Status | Notes |
|------|--------|-------|
| **Credential Handling** | ✅ | Passwords used only for login; optional `MYLEVITON_PASSWORD` env override |
| **Token Masking** | ✅ | `maskToken()` in logs; login debug no longer logs full email |
| **Error Sanitization** | ✅ | `sanitizeError()`, `sanitizeStackTrace()` in error JSON |
| **Input Validation** | ✅ | Validators cover schema fields including connectivity/diagnostics options |
| **HTTPS Only** | ✅ | All API calls to `https://my.leviton.com` |
| **WebSocket Payload Validation** | ✅ | Inbound fields type-checked; parse failures log sanitized previews |
| **npm Audit / CI** | ✅ | `0 vulnerabilities`; audit job in CI |

**Residual risk:** Homebridge stores the config password in plain text (documented; mitigated via env var or host hardening).

---

## Reliability — Strong

| Area | Status | Notes |
|------|--------|-------|
| **Self-Healing Startup** | ✅ | Retries init indefinitely with capped exponential backoff (15s → 5min); self-recovers after long outages |
| **Multi-Residence Discovery** | ✅ | Merges devices across all residential permissions |
| **Token Lifecycle** | ✅ | Default TTL when API omits `ttl`; WS force-reconnect on refresh without a spurious offline flap |
| **WebSocket Reconnect** | ✅ | Exponential backoff + long-tail retry after max attempts |
| **Connectivity Sensor** | ✅ | Online when WS **or** recent REST poll succeeds |
| **Polling** | ✅ | Polls every device on a fixed cadence (also a REST connectivity heartbeat); saves dimmer/fan level to persistence |
| **Diagnostics Gating** | ✅ | Starts only after successful discovery |
| **Persistence** | ✅ | Load/save failures logged at warn level |

---

## Maintainability — Good (improving)

| Area | Status | Notes |
|------|--------|-------|
| **TypeScript** | ✅ | Strict types; minimal HAP interfaces in `src/types/hap.ts` |
| **Test Coverage** | ✅ | **561 tests**, ~91% line coverage **including `platform.ts`** |
| **Model Registry** | ✅ | Single source of truth in `src/platform/device-models.ts` |
| **Code Organization** | ⚠️ | `platform.ts` remains large (~1,800 lines); further module extraction planned |
| **Global Singletons** | ⚠️ | Deprecated test helpers (`getApiClient`, etc.); production uses per-instance clients |
| **RequestQueue** | ⚠️ | Implemented and tested; production client uses deduplication instead |

---

## Serviceability — Strong

| Area | Status | Notes |
|------|--------|-------|
| **Leveled / Structured Logs** | ✅ | Plain-text lines stay human-readable; structured JSON context is emitted only when `structuredLogs` is enabled |
| **Diagnostics** | ✅ | Null WebSocket no longer false-positives `webSocketDown`; health rollup documented |
| **Config Schema ↔ Validators** | ✅ | `diagnosticsInterval` 1–29 documented as runtime-rejected; deprecated `pollingInterval` in schema |
| **Status Endpoints** | ✅ | `client.getStatus()`, `ws.getStatus()`, `persistence.getStats()` |
| **Integration Smoke Tests** | ✅ | `tests/integration/smoke.test.ts` (no live API) |

---

## Summary

| Category | Assessment |
|----------|------------|
| **Security** | Production-ready with documented config-password residual risk |
| **Reliability** | Production-ready; edge cases addressed in 3.7.5 audit fixes |
| **Maintainability** | Good; platform monolith is the main remaining refactor target |
| **Serviceability** | Strong observability and aligned docs/validators |

### Overall: Production Ready ✅

```
Tests:       561 passing (unit + integration smoke)
Coverage:    ~91% lines (includes platform.ts — see npm test report)
Lint:        0 errors
Audit:       0 vulnerabilities (at last review)
```

---

## Review Methodology

Principal engineering audit (2026-06-14) covered code quality, security,
reliability, maintainability, serviceability, performance, and documentation
sync. Findings were verified against source and addressed in the 3.7.5 release
batch unless explicitly documented as residual above.
