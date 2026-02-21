#!/usr/bin/env node

/**
 * Comprehensive probe of Leviton API token behavior.
 *
 * Tests:
 *  1. Login and record baseline token
 *  2. Try to read token metadata (multiple LoopBack endpoint patterns)
 *  3. Try to extend token TTL via PUT (reset `created` timestamp)
 *  4. Try login with custom TTL (request longer/eternal token)
 *  5. Try login with ttl=-1 (LoopBack eternal token)
 *  6. Check if token has sliding expiry (read metadata after API activity)
 *
 * Usage: node scripts/probe-ttl.mjs
 */

import { createInterface } from 'node:readline'

const API = 'https://my.leviton.com/api'

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function promptPassword(question) {
  return new Promise(resolve => {
    process.stdout.write(question)
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let password = ''
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode(wasRaw)
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

async function tryFetch(label, url, options = {}) {
  try {
    const res = await fetch(url, options)
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = text }
    console.log(`  ${label}: ${res.status} ${res.statusText}`)
    if (res.ok) {
      console.log(`  Response: ${JSON.stringify(body, null, 4)}`)
    } else {
      const preview = typeof body === 'string' ? body.substring(0, 200) : JSON.stringify(body).substring(0, 200)
      console.log(`  Response: ${preview}`)
    }
    return { status: res.status, ok: res.ok, body }
  } catch (err) {
    console.log(`  ${label}: ERROR - ${err.message}`)
    return { status: 0, ok: false, body: null }
  }
}

async function probe() {
  const email = await prompt('Email: ')
  const password = await promptPassword('Password: ')

  if (!email || !password) {
    console.error('Email and password are required.')
    process.exit(1)
  }

  // ============================================================
  // TEST 1: Standard login (baseline)
  // ============================================================
  console.log('\n' + '='.repeat(60))
  console.log('TEST 1: Standard login (baseline)')
  console.log('='.repeat(60))

  const loginRes = await fetch(`${API}/Person/login?include=user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!loginRes.ok) {
    console.error(`Login failed: ${loginRes.status} ${loginRes.statusText}`)
    console.error(await loginRes.text())
    process.exit(1)
  }

  const loginData = JSON.parse(await loginRes.text())
  const token = loginData.id
  const userId = loginData.userId
  const ttl = loginData.ttl
  const created = loginData.created

  console.log(`  Token:   ${token.substring(0, 16)}...`)
  console.log(`  UserId:  ${userId}`)
  console.log(`  TTL:     ${ttl}s (${(ttl / 86400).toFixed(1)} days)`)
  console.log(`  Created: ${created}`)
  console.log(`  Expires: ${new Date(new Date(created).getTime() + ttl * 1000).toISOString()}`)
  console.log(`  2FA:     ${loginData.user?.useTwoFactor}`)

  // ============================================================
  // TEST 2: Read token metadata (various LoopBack patterns)
  // ============================================================
  console.log('\n' + '='.repeat(60))
  console.log('TEST 2: Read token metadata (trying LoopBack endpoints)')
  console.log('='.repeat(60))

  const authHeader = { Authorization: token }
  const authQuery = `access_token=${token}`

  await tryFetch(
    'GET /AccessTokens/{id}',
    `${API}/AccessTokens/${token}?${authQuery}`,
  )

  await tryFetch(
    'GET /accessTokens/{id} (lowercase)',
    `${API}/accessTokens/${token}?${authQuery}`,
  )

  await tryFetch(
    'GET /People/{uid}/accessTokens/{tid}',
    `${API}/People/${userId}/accessTokens/${token}?${authQuery}`,
  )

  await tryFetch(
    'GET /Person/{uid}/accessTokens/{tid}',
    `${API}/Person/${userId}/accessTokens/${token}?${authQuery}`,
  )

  await tryFetch(
    'GET /AccessTokens/{id} (header auth)',
    `${API}/AccessTokens/${token}`,
    { headers: authHeader },
  )

  await tryFetch(
    'GET /AccessTokens/findById',
    `${API}/AccessTokens/${token}?${authQuery}`,
    { headers: authHeader },
  )

  await tryFetch(
    'GET /AccessTokens/{id}/exists',
    `${API}/AccessTokens/${token}/exists?${authQuery}`,
  )

  // ============================================================
  // TEST 3: Try to extend token via PUT (reset created timestamp)
  // ============================================================
  console.log('\n' + '='.repeat(60))
  console.log('TEST 3: Extend token TTL via PUT')
  console.log('='.repeat(60))

  const newCreated = new Date().toISOString()

  await tryFetch(
    'PUT /AccessTokens/{id} (reset created)',
    `${API}/AccessTokens/${token}?${authQuery}`,
    {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: token, created: newCreated, ttl }),
    },
  )

  await tryFetch(
    'PATCH /AccessTokens/{id}',
    `${API}/AccessTokens/${token}?${authQuery}`,
    {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ created: newCreated }),
    },
  )

  await tryFetch(
    'PUT /Person/{uid}/accessTokens/{tid}',
    `${API}/Person/${userId}/accessTokens/${token}?${authQuery}`,
    {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: token, created: newCreated, ttl }),
    },
  )

  // ============================================================
  // TEST 4: Login with custom TTL
  // ============================================================
  console.log('\n' + '='.repeat(60))
  console.log('TEST 4: Login with custom TTL values')
  console.log('='.repeat(60))

  // Try requesting a very long TTL
  const longTtlRes = await tryFetch(
    'POST /Person/login (ttl=31536000, 365 days)',
    `${API}/Person/login?include=user`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ttl: 31536000 }),
    },
  )

  if (longTtlRes.ok) {
    const longTtl = longTtlRes.body.ttl
    console.log(`  Requested 365 days, got: ${longTtl}s (${(longTtl / 86400).toFixed(1)} days)`)
    if (longTtl > ttl) {
      console.log('  ** SERVER ACCEPTED A LONGER TTL! **')
    } else {
      console.log('  Server capped TTL to its max.')
    }
  }

  // Try eternal token (ttl = -1)
  const eternalRes = await tryFetch(
    'POST /Person/login (ttl=-1, eternal)',
    `${API}/Person/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ttl: -1 }),
    },
  )

  if (eternalRes.ok) {
    const eTtl = eternalRes.body.ttl
    console.log(`  Requested eternal (-1), got: ${eTtl}`)
    if (eTtl === -1) {
      console.log('  ** SERVER SUPPORTS ETERNAL TOKENS! **')
    }
  }

  // Try very large TTL
  const hugeTtlRes = await tryFetch(
    'POST /Person/login (ttl=315360000, 10 years)',
    `${API}/Person/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ttl: 315360000 }),
    },
  )

  if (hugeTtlRes.ok) {
    const hTtl = hugeTtlRes.body.ttl
    console.log(`  Requested 10 years, got: ${hTtl}s (${(hTtl / 86400).toFixed(1)} days)`)
  }

  // ============================================================
  // TEST 5: Check sliding expiry (activity-based extension)
  // ============================================================
  console.log('\n' + '='.repeat(60))
  console.log('TEST 5: Check for sliding expiry')
  console.log('='.repeat(60))

  console.log('  Making 3 authenticated API calls with 2s gaps...')

  for (let i = 1; i <= 3; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const res = await fetch(`${API}/Person/${userId}/residentialPermissions`, {
      headers: authHeader,
    })
    console.log(`  Call ${i}: ${res.status} ${res.statusText}`)
  }

  // Now try to read the token metadata again to see if created changed
  console.log('\n  Checking token metadata after activity...')

  const postActivityRes = await tryFetch(
    'GET /AccessTokens/{id} (after activity)',
    `${API}/AccessTokens/${token}?${authQuery}`,
    { headers: authHeader },
  )

  // Also try: use the token's resolve endpoint if available
  await tryFetch(
    'GET /AccessTokens/{id}/resolve',
    `${API}/AccessTokens/${token}/resolve?${authQuery}`,
    { headers: authHeader },
  )

  // Try getting current user to see if token info is in response
  await tryFetch(
    'GET /Person/{uid} (check for token info)',
    `${API}/Person/${userId}?${authQuery}`,
    { headers: authHeader },
  )

  // ============================================================
  // TEST 6: Check token count / list endpoints
  // ============================================================
  console.log('\n' + '='.repeat(60))
  console.log('TEST 6: List tokens (check how many active tokens exist)')
  console.log('='.repeat(60))

  await tryFetch(
    'GET /Person/{uid}/accessTokens',
    `${API}/Person/${userId}/accessTokens?${authQuery}`,
    { headers: authHeader },
  )

  await tryFetch(
    'GET /Person/{uid}/accessTokens/count',
    `${API}/Person/${userId}/accessTokens/count?${authQuery}`,
    { headers: authHeader },
  )

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`  Default TTL:  ${ttl}s = ${(ttl / 86400).toFixed(1)} days`)
  console.log(`  2FA enabled:  ${loginData.user?.useTwoFactor}`)
  console.log()
  console.log('  Check above for:')
  console.log('   - Can we PUT/PATCH to reset the created timestamp? (Test 3)')
  console.log('   - Does the server accept a longer/eternal TTL on login? (Test 4)')
  console.log('   - Does the token metadata change after API activity? (Test 5)')
  console.log('   - Can we list/manage active tokens? (Test 6)')
}

probe().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
