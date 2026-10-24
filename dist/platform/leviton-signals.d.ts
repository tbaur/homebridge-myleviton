/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Turns cloud reachability and sign-in results into
 * homebridge-pagerduty signals
 */
import type { PagerDutySignalsOptions, SignalState } from '../pagerduty-signals';
export declare const SIGNAL_CLOUD_OFFLINE = "cloud-offline";
export declare const SIGNAL_AUTH_FAILED = "auth-failed";
/** How long the cloud must stay unreachable before cloud-offline turns on. */
export declare const CLOUD_OFFLINE_GRACE_MS: number;
/** The subset of `PagerDutySignals` this class uses. */
export interface SignalWriter {
    write(signal: string, state: SignalState): void;
    close(): void;
}
/**
 * Tracks the plugin's two PagerDuty signals.
 *
 * homebridge-pagerduty pages on every change and has no delay of its own, so
 * cloud-offline turns on only after the cloud stays unreachable for the whole
 * grace period. It stays off while auth-failed is on: a rejected sign-in also
 * makes every poll fail, and one cause should send one page.
 */
export declare class LevitonSignals {
    private readonly writer;
    private readonly graceMs;
    private offlineTimer;
    private isCloudOfflineConfirmed;
    private isAuthRejected;
    private isClosed;
    constructor(writer: SignalWriter, graceMs?: number);
    /**
     * Call once at launch. The cloud has not been reached yet, so the grace
     * period starts now and an outage that is already under way still pages.
     */
    start(): void;
    /** Report whether the Leviton cloud is currently reachable. */
    setCloudReachable(isReachable: boolean): void;
    /**
     * Report the outcome of a sign-in. Leviton answered either way, so this
     * also counts as reaching the cloud.
     */
    recordSignInResult(isRejected: boolean): void;
    /** Stop the grace timer and close the store. Never clears a signal. */
    close(): void;
    private writeCloudOffline;
    private clearOfflineTimer;
}
/** Creates the signals for this plugin, backed by the homebridge-pagerduty store. */
export declare function createLevitonSignals(options: PagerDutySignalsOptions): LevitonSignals;
//# sourceMappingURL=leviton-signals.d.ts.map