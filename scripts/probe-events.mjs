#!/usr/bin/env node

/**
 * Captures EVERY WebSocket frame from My Leviton, unfiltered.
 *
 * Unlike `test-websocket.js` (which only logs `challenge`/`status`/`notification`
 * frames and silently drops the rest), this probe prints every raw frame it
 * receives. Use it to discover whether physical events — e.g. button presses on
 * a DW4BC 4-button controller — are pushed to the cloud socket at all, and if so
 * what shape they take.
 *
 * It also:
 *   - dumps the full JSON of every device/controller the account exposes, across
 *     several collection endpoints, so we can see how a controller is modeled;
 *   - subscribes to each device by its model, plus residence- and account-scoped
 *     subscriptions, in case events are delivered at a higher scope;
 *   - tees all output (minus colors) to a temp log file for easy sharing.
 *
 * Usage: node scripts/probe-events.mjs <email> [duration_seconds]
 *
 * Examples:
 *   node scripts/probe-events.mjs user@example.com         # 90 second capture
 *   node scripts/probe-events.mjs user@example.com 300     # 5 minute capture
 *
 * Copyright (c) 2026 tbaur
 * Licensed under the Apache License, Version 2.0
 */

import WebSocket from 'ws'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API_URL = 'https://my.leviton.com/api'
const SOCKET_URL = 'wss://my.leviton.com/socket/websocket'
const ORIGIN = 'https://my.leviton.com'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

const LOG_FILE = join(tmpdir(), `leviton-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
const logStream = createWriteStream(LOG_FILE, { flags: 'a' })

const ESC = String.fromCharCode(27)

/**
 * Removes ANSI SGR color codes so the log file stays plain text.
 */
function stripAnsi(str) {
  return str
    .split(ESC)
    .map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, '')))
    .join('')
}

/**
 * Prints a line to the console and tees a plain-text copy to the log file.
 */
function print(line = '') {
  process.stdout.write(line + '\n')
  logStream.write(stripAnsi(line) + '\n')
}

function closeLog() {
  return new Promise((resolve) => logStream.end(resolve))
}

function ts() {
  return new Date().toISOString().split('T')[1].replace('Z', '')
}

function log(level, msg, color = '') {
  print(`${colors.dim}[${ts()}]${colors.reset} ${color}${level}${colors.reset}: ${msg}`)
}

function promptPassword(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    if (stdin.isTTY) { stdin.setRawMode(true) }
    stdin.resume()
    stdin.setEncoding('utf8')
    let password = ''
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        if (stdin.isTTY) { stdin.setRawMode(wasRaw) }
        stdin.pause()
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        resolve(password)
      } else if (ch === '\u0003') {
        process.exit(0)
      } else if (ch === '\u007F' || ch === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        password += ch
        process.stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })
}

async function login(email, password) {
  log('INFO', `Authenticating ${email} (password length: ${password.length})`, colors.blue)
  const res = await fetch(`${API_URL}/Person/login?include=user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Login failed: ${res.status} ${res.statusText}\n  Response: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  log('OK', 'Login successful', colors.green)
  return data
}

async function getJson(label, url, token) {
  try {
    const res = await fetch(url, { headers: { Authorization: token } })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = text }
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    log('ERROR', `${label}: ${err.message}`, colors.red)
    return { ok: false, status: 0, body: null }
  }
}

/**
 * Resolves the primary residence id for the logged-in account.
 */
async function resolveResidence(loginData) {
  const token = loginData.id
  const userId = loginData.userId

  const perms = await getJson('residentialPermissions', `${API_URL}/Person/${userId}/residentialPermissions`, token)
  const accountId = perms.body?.[0]?.residentialAccountId
  if (!accountId) {
    throw new Error('Could not resolve residentialAccountId')
  }

  const account = await getJson('ResidentialAccounts', `${API_URL}/ResidentialAccounts/${accountId}`, token)
  const residenceId = account.body?.primaryResidenceId
  if (!residenceId) {
    throw new Error('Could not resolve primaryResidenceId')
  }

  return { accountId, residenceId }
}

/**
 * Discovers every controllable entity across multiple collection endpoints.
 * Returns a flat list of { collection, modelName, entity } so we can subscribe
 * to each under the right model and see its full JSON.
 */
async function discoverEntities(residenceId, token) {
  // collection path -> LoopBack modelName used for socket subscriptions.
  // Controllers may live in a different collection than dimmers/switches, so we
  // probe several candidates (unknown ones simply return 404 and are skipped).
  const collections = [
    { path: 'iotSwitches', model: 'IotSwitch' },
    { path: 'iotButtons', model: 'IotButton' },
    { path: 'iotRemotes', model: 'IotRemote' },
    { path: 'iotControllers', model: 'IotController' },
    { path: 'sceneControllers', model: 'SceneController' },
    { path: 'iotScenes', model: 'IotScene' },
    { path: 'scenes', model: 'Scene' },
  ]

  const found = []
  for (const { path, model } of collections) {
    const res = await getJson(path, `${API_URL}/Residences/${residenceId}/${path}`, token)
    if (!res.ok) {
      log('WARN', `GET /Residences/{id}/${path} -> ${res.status} (skipped)`, colors.yellow)
      continue
    }
    const list = Array.isArray(res.body) ? res.body : []
    log('OK', `GET /Residences/{id}/${path} -> ${list.length} entit${list.length === 1 ? 'y' : 'ies'}`, colors.green)
    for (const entity of list) {
      found.push({ collection: path, modelName: model, entity })
    }
  }
  return found
}

function dumpEntities(entities) {
  print('\n' + '='.repeat(70))
  print(`${colors.bright}DISCOVERED ENTITIES (full JSON)${colors.reset}`)
  print('='.repeat(70))
  for (const { collection, modelName, entity } of entities) {
    const model = entity.model || entity.modelNumber || '?'
    const name = entity.name || entity.localName || '(unnamed)'
    print(`\n${colors.cyan}[${collection} / ${modelName}]${colors.reset} ${colors.bright}${name}${colors.reset} (model=${model}, id=${entity.id})`)
    print(`${colors.gray}${JSON.stringify(entity, null, 2).replace(/\n/g, '\n  ')}${colors.reset}`)
  }
}

function capture(loginData, scope, entities, durationMs) {
  return new Promise((resolve) => {
    log('WS', 'Connecting...', colors.cyan)
    const ws = new WebSocket(SOCKET_URL, { headers: { Origin: ORIGIN } })

    let authenticated = false
    let frameCount = 0
    let pingInterval = null
    let endTimer = null

    const cleanup = () => {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null }
      if (endTimer) { clearTimeout(endTimer); endTimer = null }
    }

    const connectTimeout = setTimeout(() => {
      log('ERROR', 'Connection/auth timeout (30s)', colors.red)
      cleanup()
      ws.close()
      resolve({ frameCount })
    }, 30000)

    const send = (obj) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj))
      }
    }

    ws.on('open', () => log('WS', 'Connected, waiting for challenge...', colors.cyan))

    ws.on('error', (err) => log('ERROR', `WebSocket error: ${err.message}`, colors.red))

    ws.on('close', (code, reason) => {
      clearTimeout(connectTimeout)
      cleanup()
      const reasonStr = reason ? reason.toString() : ''
      log('WS', `Closed (code=${code}${reasonStr ? `, reason=${reasonStr}` : ''})`, colors.cyan)
      resolve({ frameCount })
    })

    ws.on('message', (raw) => {
      frameCount++
      const text = raw.toString()
      let parsed
      try { parsed = JSON.parse(text) } catch { parsed = null }

      // Log EVERY frame verbatim — this is the whole point of the probe.
      const type = parsed?.type ?? '(non-JSON)'
      log('FRAME', `#${frameCount} type=${type}`, colors.magenta)
      const pretty = parsed ? JSON.stringify(parsed, null, 2) : text
      print(`${colors.gray}  ${pretty.replace(/\n/g, '\n  ')}${colors.reset}`)

      if (!parsed) { return }

      if (parsed.type === 'challenge') {
        // KEY: send the ENTIRE login response object as the token, not just .id
        // (matches src/api/websocket.ts — the server rejects the bare id).
        send({ token: loginData })
        return
      }

      if (parsed.type === 'status' && parsed.status === 'ready') {
        if (authenticated) { return }
        authenticated = true
        clearTimeout(connectTimeout)
        log('OK', 'Authenticated', colors.green)

        // Subscribe to every discovered entity under its model...
        let subs = 0
        for (const { modelName, entity } of entities) {
          send({ type: 'subscribe', subscription: { modelName, modelId: entity.id } })
          subs++
        }
        // ...plus residence- and account-scoped subscriptions, in case physical
        // events are delivered above the device level.
        send({ type: 'subscribe', subscription: { modelName: 'Residence', modelId: scope.residenceId } })
        send({ type: 'subscribe', subscription: { modelName: 'ResidentialAccount', modelId: scope.accountId } })
        subs += 2

        log('WS', `Sent ${subs} subscription(s)`, colors.cyan)

        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) { ws.ping() }
        }, 30000)

        const secs = Math.round(durationMs / 1000)
        print('\n' + '#'.repeat(70))
        print(`${colors.bright}${colors.yellow}  PRESS EACH BUTTON ON YOUR CONTROLLER NOW (single, double, hold).`)
        print(`  Also toggle a normal device to confirm the socket is live.`)
        print(`  Capturing every frame for ${secs} seconds...${colors.reset}`)
        print('#'.repeat(70) + '\n')

        endTimer = setTimeout(() => {
          log('INFO', 'Capture window complete', colors.blue)
          cleanup()
          ws.close()
        }, durationMs)
      }
    })
  })
}

async function main() {
  print(`\n${colors.bright}My Leviton Event Probe${colors.reset}\n`)

  const email = process.argv[2]
  const durationArg = process.argv[3]
  if (!email) {
    print('Usage: node scripts/probe-events.mjs <email> [duration_seconds]')
    print('       duration defaults to 90 seconds')
    await closeLog()
    process.exit(1)
  }
  const durationMs = durationArg ? parseInt(durationArg, 10) * 1000 : 90000

  log('INFO', `Writing full log to: ${LOG_FILE}`, colors.blue)

  const password = await promptPassword('Password: ')
  if (!password) {
    log('ERROR', 'Password is required.', colors.red)
    await closeLog()
    process.exit(1)
  }

  const loginData = await login(email, password)
  const scope = await resolveResidence(loginData)
  log('OK', `Residence ${scope.residenceId} / account ${scope.accountId}`, colors.green)

  const entities = await discoverEntities(scope.residenceId, loginData.id)
  dumpEntities(entities)

  const { frameCount } = await capture(loginData, scope, entities, durationMs)

  print('\n' + '='.repeat(70))
  print(`${colors.bright}SUMMARY${colors.reset}`)
  print('='.repeat(70))
  print(`  Entities discovered: ${entities.length}`)
  print(`  Frames captured:     ${frameCount}`)
  print()
  print('  Look in the FRAME logs above for anything that appeared when you')
  print('  pressed a button. If only device-status notifications showed up')
  print('  (and nothing on button presses), the cloud socket does not expose')
  print('  controller events and HomeKit button mapping is not feasible.')
  print()
  print(`${colors.bright}Full log written to:${colors.reset} ${LOG_FILE}`)
  print()

  await closeLog()
  process.exit(0)
}

main().catch(async (err) => {
  log('ERROR', err.message, colors.red)
  print(`\nPartial log written to: ${LOG_FILE}`)
  await closeLog()
  process.exit(1)
})
