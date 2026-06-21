# Known Issues

**homebridge-myleviton**

This document describes **expected, Leviton-side behavior** that can look like a plugin problem but is usually harmless. It also explains what the plugin does about each case and when you should follow up.

For configuration, diagnostics fields, and general troubleshooting, see [README-DETAILED.md](README-DETAILED.md).

---

## Summary

| Issue | Typical log / signal | Action needed? |
|---------|---------------------|----------------|
| WebSocket **502 Bad Gateway** | `WebSocket error: Unexpected server response: 502` | Usually **no** — auto-reconnects |
| WebSocket disconnect / 1006 | `WebSocket closed: 1006 (connection dropped)` | Usually **no** — auto-reconnects |
| Single REST error in diagnostics | `api ... err 1` with `health: healthy` | Usually **no** — see [Silent API errors](#silent-api-errors-in-diagnostics) |
| Sustained cloud outage | `No Response` in Home, connectivity sensor open | **Yes** — investigate / open an issue |
| Auth failure | `WebSocket auth failed` or repeated `Authentication failed` | **Yes** — check credentials |

---

## Leviton cloud endpoint flakiness

The plugin talks to Leviton's cloud at `https://my.leviton.com` (REST) and `wss://my.leviton.com/socket/websocket` (real-time push). That infrastructure occasionally returns transient errors — **502 Bad Gateway**, connection drops, and brief backend unavailability — even when your network and Homebridge setup are fine.

This is a **server-side** limitation. The plugin cannot prevent Leviton from returning 502s. It is built to tolerate them:

- **WebSocket:** automatic reconnect with exponential backoff, then indefinite long-tail retry
- **REST:** automatic retry for transient network/5xx errors; polling every 30s (default) as a safety net when push is down
- **Startup:** discovery retries after transient boot-time outages instead of staying offline until restart

If devices stay responsive in Home and reconnect lines appear after errors, you are seeing normal self-healing behavior.

---

## WebSocket 502 Bad Gateway

### What you see

```
[myleviton] WebSocket error: Unexpected server response: 502
```

Often followed by:

```
[myleviton] WebSocket reconnecting in 1s (1/10)
...
[myleviton] WebSocket authenticated and ready
```

This pattern is reported by multiple users (see [issue #37](https://github.com/tbaur/homebridge-myleviton/issues/37)).

### What it means

A **502 Bad Gateway** is returned by Leviton's load balancer or gateway during the WebSocket **upgrade handshake**. Their backend was briefly unavailable when the plugin tried to connect. This is **not** caused by your Homebridge config, firewall (assuming REST already works), or credentials.

The `ws` library surfaces the failed handshake as an `error` event; the plugin logs it at **error** level, then the connection `close` handler schedules a reconnect.

### What the plugin does

1. Logs the error once for that failed attempt
2. Reconnects with exponential backoff: 1s → 2s → 4s … capped at **60s**
3. After **10** quick attempts, continues retrying every **60s** indefinitely (long-tail retry)
4. Keeps **REST polling** (default every **30s**) so HomeKit state stays current while push reconnects

v3.7.8+ also reduces spurious connectivity flapping during token refresh and reconnect ([changelog #35](https://github.com/tbaur/homebridge-myleviton/pull/35)).

### When to ignore it

- A few 502s per day, each followed by `WebSocket authenticated and ready`
- Devices remain controllable in Home (maybe a few seconds slower without push)
- Optional connectivity sensor (if enabled) closes again within a poll window

### When to follow up

Open or update a [GitHub issue](https://github.com/tbaur/homebridge-myleviton/issues) if you see:

- Accessories stuck **No Response** for many minutes
- `WebSocket unavailable after 10 attempts` **and** no recovery for an extended period
- `WebSocket auth failed` (different root cause — credentials, not 502)

Include a log excerpt from a few minutes before the error through successful reconnect (or sustained failure).

---

## Other transient WebSocket events

These are also common on Leviton's endpoint and handled the same way (reconnect + REST fallback):

| Event | Example log | Notes |
|-------|-------------|-------|
| Normal remote close | `WebSocket closed: 1000 (normal closure)` | Reconnect scheduled |
| Connection dropped | `WebSocket closed: 1006 (connection dropped)` | Often idle timeout or proxy; reconnect scheduled |
| Connection timeout | `WebSocket connection timeout` | No response within `connectionTimeout` (default 10s); reconnect scheduled |
| Token refresh reconnect | `WebSocket closed by user` then reconnect | Deliberate reconnect after token refresh; not an outage |

Ensure outbound **HTTPS/WSS** to `my.leviton.com` is allowed if disconnects are constant (not occasional).

---

## Silent API errors in diagnostics

### What you see

With `diagnosticsInterval` enabled, a health heartbeat may show a small error count with otherwise healthy status:

```
[myleviton] Health: healthy | devices 12/53 on | ws connected | api p50 103ms p95 336ms (req 6602, err 1)
```

No matching **warn** or **error** line appears in the log at default `loglevel: "info"`.

### What it means

The `err` counter tracks **failed logical REST requests** (after retries are exhausted): timeouts, network blips, Leviton 5xx responses, or parse errors on a single device poll. One error in thousands of requests is a isolated transient failure.

Per-device poll failures are logged at **`debug`** only:

```
Polling skipped for <device name>: <reason>
```

At the default **info** log level, those lines are hidden — so diagnostics can report `err 1` while the main log looks clean.

### What the plugin does

- Preserves current HomeKit state on poll failure (does not push stale/fallback values)
- Retries transient errors automatically (network, timeout, 5xx)
- Next poll cycle usually succeeds; health stays **healthy** unless error rate crosses thresholds (see [README-DETAILED.md](README-DETAILED.md#diagnostics))

### How to see the underlying error

Set `"loglevel": "debug"` in your platform config and reproduce or wait for the next poll failure. The `Polling skipped for ...` line will include the sanitized error (timeout, 5xx, network, etc.).

---

## Diagnostics vs logs

| Signal | Where | Typical use |
|--------|-------|-------------|
| `WebSocket error: ... 502` | Homebridge log (`error`) | Visible at default log level |
| `Health: ... err N` | Diagnostics heartbeat (`diagnosticsInterval` > 0) | Aggregate REST failures per interval |
| `Polling skipped for ...` | Homebridge log (`debug` only) | Per-device REST failure detail |

Enable `"diagnosticsInterval": 300` (or similar) plus optional `"structuredLogs": true` for periodic health snapshots without exposing data in HomeKit. See [README-DETAILED.md](README-DETAILED.md#diagnostics-optional) for field definitions.

---

## Escalation checklist

Before opening an issue, confirm:

1. **Plugin version** — use the latest release ([npm](https://www.npmjs.com/package/homebridge-myleviton) / [changelog](../CHANGELOG.md))
2. **Credentials** — login works in the My Leviton app
3. **Impact** — are devices actually wrong or unresponsive, or only log noise?
4. **Logs** — for WebSocket issues, include error + reconnect lines; for REST/diagnostics, try `loglevel: "debug"` first

Report sustained failures with environment details (plugin version, Homebridge version, Node.js, OS) and a scrubbed log excerpt (no email, password, or tokens).

---

## Related documentation

- [README-DETAILED.md — Advanced Troubleshooting](README-DETAILED.md#advanced-troubleshooting)
- [FEATURES.md — Reliability features](FEATURES.md)
- [GitHub issue #37 — WebSocket 502 discussion](https://github.com/tbaur/homebridge-myleviton/issues/37)
