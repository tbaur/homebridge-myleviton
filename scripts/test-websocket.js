#!/usr/bin/env node
/**
 * Standalone WebSocket Test Script for My Leviton API
 * 
 * Tests WebSocket connectivity and authentication separately from the plugin.
 * Uses the same API flow as the actual plugin for accurate testing.
 * 
 * Usage:
 *   node scripts/test-websocket.js your@email.com
 *   
 * The script will prompt for your password securely.
 * 
 * Copyright (c) 2026 tbaur
 * Licensed under the Apache License, Version 2.0
 */

const SockJS = require('sockjs-client')
const readline = require('readline')

// API Configuration (same as plugin)
const API_URL = 'https://my.leviton.com/api'
const SOCKET_URL = 'https://my.leviton.com/socket'
const APP_ID = 'b8e303c6-1d51-40e2-a9d5-6bf99ba03d00'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function log(level, message, data = null) {
  const timestamp = new Date().toISOString()
  const levelColors = {
    INFO: colors.blue,
    OK: colors.green,
    WARN: colors.yellow,
    ERROR: colors.red,
    DEBUG: colors.gray,
    WS: colors.cyan,
  }
  const color = levelColors[level] || colors.reset
  console.log(`${colors.gray}[${timestamp}]${colors.reset} ${color}${level}${colors.reset}: ${message}`)
  if (data) {
    console.log(`${colors.gray}  └─ ${JSON.stringify(data, null, 2).replace(/\n/g, '\n     ')}${colors.reset}`)
  }
}

/**
 * Prompts for password without echoing to terminal
 */
function promptPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    // Hide input
    process.stdout.write(prompt)
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    if (stdin.isTTY) {
      stdin.setRawMode(true)
    }

    let password = ''
    const onData = (char) => {
      char = char.toString()
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl+D
          if (stdin.isTTY) {
            stdin.setRawMode(wasRaw)
          }
          stdin.removeListener('data', onData)
          rl.close()
          console.log() // New line after password
          resolve(password)
          break
        case '\u0003': // Ctrl+C
          process.exit(1)
          break
        case '\u007F': // Backspace
          password = password.slice(0, -1)
          break
        default:
          password += char
          break
      }
    }
    stdin.on('data', onData)
  })
}

/**
 * Step 1: Login to My Leviton API
 */
async function login(email, password) {
  log('INFO', 'Step 1: Logging in...')
  
  const response = await fetch(`${API_URL}/Person/login?include=user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Application-Id': APP_ID,
    },
    body: JSON.stringify({ email, password, clientId: APP_ID, registeredVia: 'myLeviton' }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Login failed: ${response.status} ${response.statusText} - ${text}`)
  }

  const data = await response.json()
  log('OK', 'Login successful', {
    userId: data.userId,
    tokenPreview: data.id ? `${data.id.substring(0, 20)}...` : 'none',
    ttl: data.ttl,
  })
  
  return data
}

/**
 * Step 2: Get residential permissions to find accountID
 */
async function getResidentialPermissions(token, personId) {
  log('INFO', 'Step 2: Fetching residential permissions...')
  
  const response = await fetch(`${API_URL}/Person/${personId}/residentialPermissions`, {
    headers: {
      'Authorization': token,
      'Application-Id': APP_ID,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get residential permissions: ${response.status}`)
  }

  const data = await response.json()
  log('DEBUG', 'Raw residential permissions response', data)
  
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('No residential permissions found')
  }
  
  const accountId = data[0].residentialAccountId
  log('OK', `Found accountId: ${accountId}`)
  
  return { accountId, permissions: data }
}

/**
 * Step 3: Get residential accounts to find residenceID
 */
async function getResidentialAccounts(token, accountId) {
  log('INFO', 'Step 3: Fetching residential accounts...')
  
  const response = await fetch(`${API_URL}/ResidentialAccounts/${accountId}`, {
    headers: {
      'Authorization': token,
      'Application-Id': APP_ID,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get residential accounts: ${response.status}`)
  }

  const data = await response.json()
  log('DEBUG', 'Raw residential accounts response', data)
  
  if (!data || !data.primaryResidenceId) {
    throw new Error('No primaryResidenceId found in residential accounts')
  }
  
  log('OK', `Found residenceId: ${data.primaryResidenceId}`, {
    residenceObjectId: data.id,
    primaryResidenceId: data.primaryResidenceId,
  })
  
  return {
    residenceId: data.primaryResidenceId,
    residenceObjectId: data.id,
  }
}

/**
 * Step 4: Get devices for residence
 */
async function getDevices(token, residenceId) {
  log('INFO', `Step 4: Fetching devices for residence ${residenceId}...`)
  
  const response = await fetch(`${API_URL}/Residences/${residenceId}/iotSwitches`, {
    headers: {
      'Authorization': token,
      'Application-Id': APP_ID,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get devices: ${response.status}`)
  }

  const devices = await response.json()
  log('OK', `Found ${devices.length} device(s)`, devices.map(d => ({ 
    id: d.id, 
    name: d.name, 
    model: d.model,
    serial: d.serial,
  })))
  
  return devices
}

/**
 * Step 5: Test WebSocket connection
 */
function testWebSocket(token, devices) {
  return new Promise((resolve) => {
    log('WS', 'Step 5: Connecting to WebSocket...', { url: SOCKET_URL })
    
    const ws = new SockJS(SOCKET_URL, null, {
      transports: ['websocket', 'xhr-streaming', 'xhr-polling'],
    })
    
    let authenticated = false
    let subscribed = false
    const timeout = setTimeout(() => {
      log('ERROR', 'WebSocket test timed out after 30 seconds')
      ws.close()
      resolve({ success: false, reason: 'timeout' })
    }, 30000)

    ws.onopen = () => {
      log('WS', 'Connection opened, waiting for challenge...')
    }

    ws.onclose = (event) => {
      clearTimeout(timeout)
      log('WS', 'Connection closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      })
      
      if (event.code === 401) {
        log('ERROR', 'Authentication rejected (401) - WebSocket auth not supported by server')
        resolve({ success: false, reason: 'auth_rejected', code: 401 })
      } else if (!authenticated) {
        log('WARN', 'Connection closed before authentication completed')
        resolve({ success: false, reason: 'closed_before_auth', code: event.code })
      } else if (!subscribed) {
        log('WARN', 'Connection closed before subscription completed')
        resolve({ success: false, reason: 'closed_before_subscribe', code: event.code })
      } else {
        resolve({ success: true, reason: 'normal_close' })
      }
    }

    ws.onerror = (error) => {
      log('ERROR', 'WebSocket error', { message: error.message || 'Unknown error' })
    }

    ws.onmessage = (message) => {
      let data
      try {
        // SockJS wraps messages in an array
        const raw = message.data
        if (typeof raw === 'string' && raw.startsWith('[')) {
          const arr = JSON.parse(raw)
          data = JSON.parse(arr[0])
        } else if (typeof raw === 'string') {
          data = JSON.parse(raw)
        } else {
          data = raw
        }
      } catch {
        log('DEBUG', 'Raw message (not JSON)', { data: message.data })
        return
      }

      log('WS', 'Received message', data)

      // Handle challenge
      if (data.type === 'challenge') {
        log('WS', 'Received challenge, sending token...')
        const response = JSON.stringify({ token: token })
        log('DEBUG', 'Sending auth response', { tokenPreview: `${token.substring(0, 20)}...` })
        ws.send([response])
        return
      }

      // Handle status ready
      if (data.type === 'status' && data.status === 'ready') {
        log('OK', 'Authentication successful! Server is ready.')
        authenticated = true
        
        // Subscribe to devices
        log('WS', `Subscribing to ${devices.length} device(s)...`)
        devices.forEach((device) => {
          const subMsg = JSON.stringify({
            type: 'subscribe',
            subscription: {
              modelName: 'IotSwitch',
              modelId: device.id,
            },
          })
          log('DEBUG', `Subscribing to device: ${device.name} (${device.id})`)
          ws.send([subMsg])
        })
        subscribed = true
        
        log('OK', '✓ WebSocket test PASSED - Real-time updates should work!')
        log('INFO', 'Listening for device updates for 10 seconds...')
        log('INFO', '(Try toggling a device in the My Leviton app to see an update)')
        
        setTimeout(() => {
          log('INFO', 'Test complete, closing connection')
          ws.close()
        }, 10000)
        return
      }

      // Handle notifications (device updates)
      if (data.type === 'notification') {
        log('OK', '✓ Received real-time device update!', data)
        return
      }
    }
  })
}

/**
 * Main
 */
async function main() {
  console.log(`
${colors.bright}╔═══════════════════════════════════════════════════════════╗
║       My Leviton WebSocket Connection Tester              ║
║       (Uses same API flow as plugin)                      ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`)

  const email = process.argv[2]
  
  if (!email) {
    console.log(`${colors.yellow}Usage: node scripts/test-websocket.js <email>${colors.reset}`)
    console.log(`\nExample: node scripts/test-websocket.js your@email.com`)
    process.exit(1)
  }

  try {
    // Prompt for password
    const password = await promptPassword(`Password for ${email}: `)
    
    if (!password) {
      log('ERROR', 'Password is required')
      process.exit(1)
    }

    // Step 1: Login
    const loginData = await login(email, password)
    const token = loginData.id
    const personId = loginData.userId
    
    // Step 2: Get residential permissions
    const { accountId } = await getResidentialPermissions(token, personId)
    
    // Step 3: Get residential accounts
    const { residenceId } = await getResidentialAccounts(token, accountId)
    
    // Step 4: Get devices
    const devices = await getDevices(token, residenceId)
    
    if (devices.length === 0) {
      log('WARN', 'No devices found - cannot test WebSocket subscriptions')
      log('INFO', 'But we can still test WebSocket auth...')
    }

    // Step 5: Test WebSocket
    console.log(`\n${colors.bright}Testing WebSocket Connection...${colors.reset}\n`)
    const result = await testWebSocket(token, devices)
    
    console.log(`\n${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}`)
    if (result.success) {
      console.log(`${colors.green}${colors.bright}✓ SUCCESS: WebSocket real-time updates are working!${colors.reset}`)
    } else {
      console.log(`${colors.red}${colors.bright}✗ FAILED: ${result.reason}${colors.reset}`)
      if (result.code === 401) {
        console.log(`\n${colors.yellow}The Leviton server rejected WebSocket authentication.`)
        console.log(`This may require contacting Leviton support.`)
        console.log(`Device control via REST API will still work.${colors.reset}`)
      }
    }
    console.log(`${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}\n`)
    
    process.exit(result.success ? 0 : 1)
    
  } catch (error) {
    log('ERROR', error.message)
    process.exit(1)
  }
}

main()
