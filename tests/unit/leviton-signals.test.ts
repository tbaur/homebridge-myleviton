/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Tests for the cloud-offline grace period and the auth-failed signal
 */

import {
  CLOUD_OFFLINE_GRACE_MS,
  LevitonSignals,
  SIGNAL_AUTH_FAILED,
  SIGNAL_CLOUD_OFFLINE,
} from '../../src/platform/leviton-signals'
import type { SignalWriter } from '../../src/platform/leviton-signals'

const createWriter = () => {
  const writer = { write: jest.fn(), close: jest.fn() }
  return writer as typeof writer & SignalWriter
}

/** The last state written for one signal, or undefined if it was never written. */
const lastState = (writer: ReturnType<typeof createWriter>, signal: string) => {
  const calls = writer.write.mock.calls.filter(([name]) => name === signal)
  return calls.length > 0 ? calls[calls.length - 1][1] : undefined
}

describe('LevitonSignals', () => {
  let writer: ReturnType<typeof createWriter>
  let signals: LevitonSignals

  beforeEach(() => {
    jest.useFakeTimers()
    writer = createWriter()
    signals = new LevitonSignals(writer)
  })

  afterEach(() => {
    signals.close()
    jest.useRealTimers()
  })

  it('uses a five-minute grace period', () => {
    expect(CLOUD_OFFLINE_GRACE_MS).toBe(5 * 60 * 1000)
  })

  describe('cloud-offline', () => {
    it('turns on only after the cloud has been unreachable since launch for the grace period', () => {
      signals.start()
      jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS - 1)
      expect(lastState(writer, SIGNAL_CLOUD_OFFLINE)).toBeUndefined()

      jest.advanceTimersByTime(1)
      expect(lastState(writer, SIGNAL_CLOUD_OFFLINE)).toEqual({
        active: true,
        severity: 'critical',
        summary: expect.stringContaining('cannot reach the Leviton cloud'),
      })
    })

    it('writes the inactive state as soon as the cloud is reached', () => {
      signals.start()
      signals.setCloudReachable(true)
      jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)

      expect(lastState(writer, SIGNAL_CLOUD_OFFLINE)).toMatchObject({ active: false })
      expect(writer.write).toHaveBeenCalledTimes(1)
    })

    it('does not page for an outage shorter than the grace period', () => {
      signals.setCloudReachable(true)
      signals.setCloudReachable(false)
      jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS - 1000)
      signals.setCloudReachable(true)
      jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)

      const writes = writer.write.mock.calls.filter(([name]) => name === SIGNAL_CLOUD_OFFLINE)
      expect(writes.every(([, state]) => state.active === false)).toBe(true)
    })

    it('measures the grace period from the first unreachable report', () => {
      signals.setCloudReachable(false)
      jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS - 1000)
      signals.setCloudReachable(false)
      jest.advanceTimersByTime(1000)

      expect(lastState(writer, SIGNAL_CLOUD_OFFLINE)).toMatchObject({ active: true })
    })

    it('clears as soon as the cloud is reachable again', () => {
      signals.setCloudReachable(false)
      jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)
      signals.setCloudReachable(true)

      expect(lastState(writer, SIGNAL_CLOUD_OFFLINE)).toMatchObject({ active: false })
    })
  })

  describe('auth-failed', () => {
    it('turns on immediately when the sign-in is rejected', () => {
      signals.recordSignInResult(true)

      expect(lastState(writer, SIGNAL_AUTH_FAILED)).toEqual({
        active: true,
        severity: 'critical',
        summary: expect.stringContaining('rejected the My Leviton sign-in'),
      })
    })

    it('writes both signals inactive after a successful sign-in', () => {
      signals.start()
      signals.recordSignInResult(false)

      expect(lastState(writer, SIGNAL_AUTH_FAILED)).toMatchObject({ active: false })
      expect(lastState(writer, SIGNAL_CLOUD_OFFLINE)).toMatchObject({ active: false })
    })

    it('keeps cloud-offline off while the sign-in is rejected', () => {
      signals.recordSignInResult(true)
      signals.setCloudReachable(false)
      jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)

      expect(lastState(writer, SIGNAL_CLOUD_OFFLINE)).toMatchObject({ active: false })
      expect(lastState(writer, SIGNAL_AUTH_FAILED)).toMatchObject({ active: true })
    })

    it('clears an active cloud-offline, because Leviton answered the sign-in', () => {
      signals.setCloudReachable(false)
      jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)
      signals.recordSignInResult(true)

      expect(lastState(writer, SIGNAL_CLOUD_OFFLINE)).toMatchObject({ active: false })
    })

    it('clears after a later successful sign-in', () => {
      signals.recordSignInResult(true)
      signals.recordSignInResult(false)

      expect(lastState(writer, SIGNAL_AUTH_FAILED)).toMatchObject({ active: false })
    })
  })

  describe('close', () => {
    it('closes the writer, stops the grace timer and never clears a signal', () => {
      signals.recordSignInResult(true)
      signals.start()
      writer.write.mockClear()

      signals.close()
      jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)
      signals.setCloudReachable(true)
      signals.recordSignInResult(false)

      expect(writer.close).toHaveBeenCalledTimes(1)
      expect(writer.write).not.toHaveBeenCalled()
    })
  })
})
