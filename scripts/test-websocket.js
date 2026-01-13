#!/usr/bin/env node
/**
 * WebSocket Connection Test Script
 * 
 * Tests the WebSocket connection to My Leviton for real-time device updates.
 * Useful for verifying connectivity before troubleshooting issues.
 * 
 * Usage: node scripts/test-websocket.js <email> [duration_seconds]
 * 
 * Examples:
 *   node scripts/test-websocket.js user@example.com        # 15 second test
 *   node scripts/test-websocket.js user@example.com 60     # 1 minute test
 *   node scripts/test-websocket.js user@example.com 300    # 5 minute test
 * 
 * Copyright (c) 2026 tbaur
 * Licensed under the Apache License, Version 2.0
 */

const WebSocket = require('ws')
const readline = require('readline')

const API_URL = 'https://my.leviton.com/api'
const SOCKET_URL = 'wss://my.leviton.com/socket/websocket'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function log(level, msg, data = null) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, -1)
  const levelColors = {
    INFO: colors.blue,
    OK: colors.green,
    WARN: colors.yellow,
    ERROR: colors.red,
    WS: colors.cyan,
  }
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${levelColors[level] || ''}${level}${colors.reset}: ${msg}`)
  if (data !== null) {
    const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    console.log(`${colors.gray}  └─ ${str.replace(/\n/g, '\n     ')}${colors.reset}`)
  }
}

function promptPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    process.stdout.write(prompt)
    const stdin = process.stdin
    if (stdin.isTTY) { stdin.setRawMode(true) }
    let password = ''
    const onData = (char) => {
      char = char.toString()
      if (char === '\n' || char === '\r') {
        if (stdin.isTTY) { stdin.setRawMode(false) }
        stdin.removeListener('data', onData)
        rl.close()
        console.log()
        resolve(password)
      } else if (char === '\u0003') {
        process.exit(1)
      } else if (char === '\u007F') {
        password = password.slice(0, -1)
      } else {
        password += char
      }
    }
    stdin.on('data', onData)
  })
}

async function login(email, password) {
  log('INFO', 'Authenticating...')
  
  const response = await fetch(`${API_URL}/Person/login?include=user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, registeredVia: 'myLeviton' }),
  })

  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`)
  }

  const data = await response.json()
  log('OK', 'Login successful')
  return data
}

async function getDevices(token, personId) {
  const permsRes = await fetch(`${API_URL}/Person/${personId}/residentialPermissions`, {
    headers: { Authorization: token },
  })
  const perms = await permsRes.json()
  const accountId = perms?.[0]?.residentialAccountId

  const accountRes = await fetch(`${API_URL}/ResidentialAccounts/${accountId}`, {
    headers: { Authorization: token },
  })
  const account = await accountRes.json()
  const residenceId = account?.primaryResidenceId
  
  const devicesRes = await fetch(`${API_URL}/Residences/${residenceId}/iotSwitches`, {
    headers: { Authorization: token },
  })
  return devicesRes.json()
}

function testWebSocket(loginData, devices, duration = 15000) {
  return new Promise((resolve) => {
    log('WS', 'Connecting...')
    
    const ws = new WebSocket(SOCKET_URL, {
      headers: { 'Origin': 'https://my.leviton.com' },
    })
    
    let authenticated = false
    let pingInterval = null
    
    const cleanup = () => {
      if (pingInterval) {
        clearInterval(pingInterval)
        pingInterval = null
      }
    }
    
    const timeout = setTimeout(() => {
      log('ERROR', 'Connection timeout')
      cleanup()
      ws.close()
      resolve({ success: false, reason: 'timeout' })
    }, 30000)

    ws.on('open', () => {
      log('WS', 'Connected, authenticating...')
    })

    ws.on('close', (code) => {
      clearTimeout(timeout)
      cleanup()
      if (!authenticated) {
        resolve({ success: false, reason: `closed: ${code}` })
      } else {
        resolve({ success: true })
      }
    })

    ws.on('error', (error) => {
      log('ERROR', `WebSocket error: ${error.message}`)
    })

    ws.on('message', (data) => {
      let parsed
      try {
        parsed = JSON.parse(data.toString())
      } catch {
        return
      }

      if (parsed.type === 'challenge') {
        ws.send(JSON.stringify({ token: loginData }))
        return
      }

      if (parsed.type === 'status' && parsed.status === 'ready') {
        authenticated = true
        clearTimeout(timeout) // Clear connection timeout once authenticated
        log('OK', 'Authenticated')
        
        log('WS', `Subscribing to ${devices.length} device(s)...`)
        for (const device of devices) {
          ws.send(JSON.stringify({
            type: 'subscribe',
            subscription: { modelName: 'IotSwitch', modelId: device.id },
          }))
        }
        
        // Start ping keepalive every 30 seconds
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping()
          }
        }, 30000)
        
        const durationSec = Math.round(duration / 1000)
        log('INFO', `Listening for updates (${durationSec} seconds)...`)
        log('INFO', 'Try toggling a device in the My Leviton app')
        
        setTimeout(() => {
          log('INFO', 'Test complete')
          clearTimeout(timeout)
          cleanup()
          ws.close()
        }, duration)
        return
      }

      if (parsed.type === 'notification') {
        const n = parsed.notification
        log('OK', `Device update: ${n.modelId} - ${JSON.stringify(n.data)}`)
        return
      }
    })
  })
}

async function main() {
  console.log(`
${colors.bright}My Leviton WebSocket Test${colors.reset}
`)

  const email = process.argv[2]
  const durationArg = process.argv[3]
  
  if (!email) {
    console.log('Usage: node scripts/test-websocket.js <email> [duration_seconds]')
    console.log('       duration defaults to 15 seconds')
    process.exit(1)
  }

  const duration = durationArg ? parseInt(durationArg, 10) * 1000 : 15000

  const password = await promptPassword(`Password: `)
  
  const loginData = await login(email, password)
  const devices = await getDevices(loginData.id, loginData.userId)
  log('OK', `Found ${devices.length} device(s)`)
  
  const result = await testWebSocket(loginData, devices, duration)
  
  console.log()
  if (result.success) {
    console.log(`${colors.green}✓ WebSocket connection successful${colors.reset}`)
  } else {
    console.log(`${colors.red}✗ WebSocket test failed: ${result.reason}${colors.reset}`)
  }
  console.log()
  
  process.exit(result.success ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
