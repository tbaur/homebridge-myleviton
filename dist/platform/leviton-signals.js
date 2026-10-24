"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Turns cloud reachability and sign-in results into
 * homebridge-pagerduty signals
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LevitonSignals = exports.CLOUD_OFFLINE_GRACE_MS = exports.SIGNAL_AUTH_FAILED = exports.SIGNAL_CLOUD_OFFLINE = void 0;
exports.createLevitonSignals = createLevitonSignals;
const pagerduty_signals_1 = require("../pagerduty-signals");
// Users type these names into homebridge-pagerduty's config, so they must
// never change once released.
exports.SIGNAL_CLOUD_OFFLINE = 'cloud-offline';
exports.SIGNAL_AUTH_FAILED = 'auth-failed';
/** How long the cloud must stay unreachable before cloud-offline turns on. */
exports.CLOUD_OFFLINE_GRACE_MS = 5 * 60 * 1000;
const CLOUD_OFFLINE_SUMMARY = 'My Leviton cannot reach the Leviton cloud. HomeKit cannot control Leviton devices until it reconnects.';
const AUTH_FAILED_SUMMARY = 'Leviton rejected the My Leviton sign-in or account access. HomeKit cannot control Leviton devices until the account email and password in Homebridge work again.';
/**
 * Tracks the plugin's two PagerDuty signals.
 *
 * homebridge-pagerduty pages on every change and has no delay of its own, so
 * cloud-offline turns on only after the cloud stays unreachable for the whole
 * grace period. It stays off while auth-failed is on: a rejected sign-in also
 * makes every poll fail, and one cause should send one page.
 */
class LevitonSignals {
    writer;
    graceMs;
    offlineTimer = null;
    isCloudOfflineConfirmed = false;
    isAuthRejected = false;
    isClosed = false;
    constructor(writer, graceMs = exports.CLOUD_OFFLINE_GRACE_MS) {
        this.writer = writer;
        this.graceMs = graceMs;
    }
    /**
     * Call once at launch. The cloud has not been reached yet, so the grace
     * period starts now and an outage that is already under way still pages.
     */
    start() {
        this.setCloudReachable(false);
    }
    /** Report whether the Leviton cloud is currently reachable. */
    setCloudReachable(isReachable) {
        if (this.isClosed) {
            return;
        }
        if (isReachable) {
            this.clearOfflineTimer();
            this.isCloudOfflineConfirmed = false;
            this.writeCloudOffline();
            return;
        }
        if (this.offlineTimer || this.isCloudOfflineConfirmed) {
            return;
        }
        this.offlineTimer = setTimeout(() => {
            this.offlineTimer = null;
            this.isCloudOfflineConfirmed = true;
            this.writeCloudOffline();
        }, this.graceMs);
    }
    /**
     * Report the outcome of a sign-in. Leviton answered either way, so this
     * also counts as reaching the cloud.
     */
    recordSignInResult(isRejected) {
        if (this.isClosed) {
            return;
        }
        this.isAuthRejected = isRejected;
        this.writer.write(exports.SIGNAL_AUTH_FAILED, { active: isRejected, severity: 'critical', summary: AUTH_FAILED_SUMMARY });
        this.setCloudReachable(true);
    }
    /** Stop the grace timer and close the store. Never clears a signal. */
    close() {
        this.isClosed = true;
        this.clearOfflineTimer();
        this.writer.close();
    }
    writeCloudOffline() {
        this.writer.write(exports.SIGNAL_CLOUD_OFFLINE, {
            active: this.isCloudOfflineConfirmed && !this.isAuthRejected,
            severity: 'critical',
            summary: CLOUD_OFFLINE_SUMMARY,
        });
    }
    clearOfflineTimer() {
        if (this.offlineTimer) {
            clearTimeout(this.offlineTimer);
            this.offlineTimer = null;
        }
    }
}
exports.LevitonSignals = LevitonSignals;
/** Creates the signals for this plugin, backed by the homebridge-pagerduty store. */
function createLevitonSignals(options) {
    return new LevitonSignals(new pagerduty_signals_1.PagerDutySignals(options));
}
//# sourceMappingURL=leviton-signals.js.map