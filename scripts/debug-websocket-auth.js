#!/usr/bin/env node
/**
 * Debug script to try different WebSocket authentication approaches
 * 
 * Copyright (c) 2026 tbaur
 * Licensed under the Apache License, Version 2.0
 */

const SockJS = require('sockjs-client')
const crypto = require('crypto')
const readline = require('readline')

const API_URL = 'https://my.leviton.com/api'
const SOCKET_URL = 'https://my.leviton.com/socket'
const APP_ID = 'b8e303c6-1d51-40e2-a9d5-6bf99ba03d00'

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

function log(msg, data = null) {
  console.log(`${colors.cyan}→${colors.reset} ${msg}`)
  if (data) {
    console.log(`  ${colors.gray}${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')}${colors.reset}`)
  }
}

function promptPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    process.stdout.write(prompt)
    const stdin = process.stdin
    if (stdin.isTTY) {
      stdin.setRawMode(true)
    }
    let password = ''
    const onData = (char) => {
      char = char.toString()
      if (char === '\n' || char === '\r') {
        if (stdin.isTTY) {
          stdin.setRawMode(false)
        }
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
  const response = await fetch(`${API_URL}/Person/login?include=user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Application-Id': APP_ID },
    body: JSON.stringify({ email, password, clientId: APP_ID, registeredVia: 'myLeviton' }),
  })
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`)
  }
  return response.json()
}

function tryAuth(token, nonce, approach) {
  return new Promise((resolve) => {
    log(`Trying approach: ${approach.name}`)
    
    const ws = new SockJS(SOCKET_URL)
    let resolved = false
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        ws.close()
        resolve({ success: false, reason: 'timeout' })
      }
    }, 10000)

    ws.onclose = (event) => {
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        if (event.code === 401) {
          log(`${colors.red}✗ FAILED:${colors.reset} ${event.reason}`)
          resolve({ success: false, reason: event.reason, code: 401 })
        } else {
          resolve({ success: false, reason: `closed: ${event.code}` })
        }
      }
    }

    ws.onmessage = (message) => {
      let data
      try {
        const raw = message.data
        if (raw.startsWith('[')) {
          data = JSON.parse(JSON.parse(raw)[0])
        } else {
          data = JSON.parse(raw)
        }
      } catch { return }

      if (data.type === 'challenge') {
        const receivedNonce = data.nonce
        log(`Received nonce: ${receivedNonce}`)
        
        const response = approach.makeResponse(token, receivedNonce)
        log(`Sending response:`, response)
        ws.send([JSON.stringify(response)])
      }

      if (data.type === 'status' && data.status === 'ready') {
        clearTimeout(timeout)
        resolved = true
        log(`${colors.green}✓ SUCCESS!${colors.reset}`)
        ws.close()
        resolve({ success: true, approach: approach.name })
      }
    }
  })
}

// Different authentication approaches to try
const approaches = [
  {
    name: 'Original: just token',
    makeResponse: (token, _nonce) => ({ token }),
  },
  {
    name: 'Token + nonce',
    makeResponse: (token, nonce) => ({ token, nonce }),
  },
  {
    name: 'Token + response (HMAC-SHA256 of nonce with token as key)',
    makeResponse: (token, nonce) => {
      const hmac = crypto.createHmac('sha256', token)
      hmac.update(nonce)
      return { token, response: hmac.digest('base64') }
    },
  },
  {
    name: 'Token + response (HMAC-SHA256 of token with nonce as key)',
    makeResponse: (token, nonce) => {
      const hmac = crypto.createHmac('sha256', nonce)
      hmac.update(token)
      return { token, response: hmac.digest('base64') }
    },
  },
  {
    name: 'Token + signature (SHA256 of nonce+token)',
    makeResponse: (token, nonce) => {
      const hash = crypto.createHash('sha256')
      hash.update(nonce + token)
      return { token, signature: hash.digest('base64') }
    },
  },
  {
    name: 'Just response (HMAC-SHA256 nonce with token)',
    makeResponse: (token, nonce) => {
      const hmac = crypto.createHmac('sha256', token)
      hmac.update(nonce)
      return { response: hmac.digest('base64') }
    },
  },
  {
    name: 'accessToken field instead of token',
    makeResponse: (token, _nonce) => ({ accessToken: token }),
  },
  {
    name: 'id field instead of token',
    makeResponse: (token, _nonce) => ({ id: token }),
  },
  {
    name: 'authorization field',
    makeResponse: (token, _nonce) => ({ authorization: token }),
  },
  {
    name: 'Bearer token format',
    makeResponse: (token, _nonce) => ({ token: `Bearer ${token}` }),
  },
]

async function main() {
  console.log(`\n${colors.bright}WebSocket Auth Reverse Engineering${colors.reset}\n`)
  
  const email = process.argv[2]
  if (!email) {
    console.log('Usage: node scripts/debug-websocket-auth.js <email>')
    process.exit(1)
  }

  const password = await promptPassword(`Password: `)
  
  log('Logging in...')
  const loginData = await login(email, password)
  const token = loginData.id
  
  // Analyze the token
  console.log(`\n${colors.bright}Token Analysis:${colors.reset}`)
  log(`Token length: ${token.length}`)
  log(`Token preview: ${token.substring(0, 30)}...`)
  
  // Check if it's a JWT
  const parts = token.split('.')
  if (parts.length === 3) {
    log('Token appears to be a JWT')
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString())
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
      log('JWT Header:', header)
      log('JWT Payload:', payload)
    } catch {
      log('Could not decode JWT')
    }
  } else {
    log('Token is NOT a JWT (no dots or wrong format)')
  }
  
  // Check full login response for other useful fields
  console.log(`\n${colors.bright}Full Login Response Fields:${colors.reset}`)
  for (const key of Object.keys(loginData)) {
    const value = loginData[key]
    const display = typeof value === 'string' && value.length > 50 
      ? `${value.substring(0, 50)}...` 
      : value
    log(`${key}: ${JSON.stringify(display)}`)
  }
  
  // Try each approach
  console.log(`\n${colors.bright}Trying Authentication Approaches:${colors.reset}\n`)
  
  for (const approach of approaches) {
    const result = await tryAuth(token, null, approach)
    if (result.success) {
      console.log(`\n${colors.green}${colors.bright}SUCCESS! Working approach: ${approach.name}${colors.reset}`)
      process.exit(0)
    }
    console.log() // blank line between attempts
    
    // Small delay between attempts
    await new Promise(r => setTimeout(r, 1000))
  }
  
  console.log(`\n${colors.red}All approaches failed.${colors.reset}`)
  console.log(`${colors.yellow}The WebSocket auth likely requires a secret not available in the public API.${colors.reset}`)
  console.log(`${colors.yellow}Leviton support may need to provide documentation.${colors.reset}\n`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

