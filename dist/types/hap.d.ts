/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Minimal Homebridge / HAP-NodeJS type surface used by the platform
 */
import type { DeviceInfo } from './index';
/** Accessory context shape stored on Homebridge platform accessories. */
export interface AccessoryContextShape {
    device?: DeviceInfo;
    connectivity?: boolean;
    /** @deprecated Legacy field scrubbed on load — never persisted by current versions. */
    token?: string;
}
/** HomeKit characteristic handle (subset used by this plugin). */
export interface HAPCharacteristic {
    value: unknown;
    updateValue(value: unknown): HAPCharacteristic;
    on(event: 'get' | 'set', handler: (...args: unknown[]) => void): HAPCharacteristic;
    removeAllListeners(event?: string): HAPCharacteristic;
    setProps(props: Record<string, unknown>): HAPCharacteristic;
}
/** HomeKit service handle (subset used by this plugin). */
export interface HAPService {
    displayName?: string;
    getCharacteristic(uuid: unknown): HAPCharacteristic;
    setCharacteristic(uuid: unknown, value: unknown): HAPService;
    addCharacteristic(uuid: unknown): HAPCharacteristic;
    testCharacteristic?(uuid: unknown): boolean;
}
/** Cached Homebridge platform accessory. */
export interface PlatformAccessory {
    UUID: string;
    displayName: string;
    context: AccessoryContextShape;
    services?: HAPService[];
    getService(uuid: unknown, name?: string): HAPService | undefined;
    addService(serviceUuid: unknown, name?: string): HAPService;
    updateDisplayName?(name: string): void;
    _associatedHAPAccessory?: {
        displayName?: string;
    };
}
/** Homebridge API object passed to platform constructors. */
export interface HomebridgeAPI {
    hap: HAPModule;
    platformAccessory: new (displayName: string, uuid: string) => PlatformAccessory;
    registerPlatformAccessories(plugin: string, platform: string, accessories: PlatformAccessory[]): void;
    unregisterPlatformAccessories(plugin: string, platform: string, accessories: PlatformAccessory[]): void;
    updatePlatformAccessories(accessories: PlatformAccessory[]): void;
    registerPlatform(plugin: string, platform: string, constructor: unknown, isolated?: boolean): void;
    on(event: 'didFinishLaunching' | 'shutdown', handler: () => void | Promise<void>): void;
    user?: {
        storagePath(): string;
    };
}
/** HAP-NodeJS Characteristic registry (dynamic keys plus enums used by this plugin). */
export type HAPCharacteristicRegistry = Record<string, unknown> & {
    ContactSensorState: {
        CONTACT_DETECTED: number;
        CONTACT_NOT_DETECTED: number;
    };
    StatusFault: {
        NO_FAULT: number;
        GENERAL_FAULT: number;
    };
};
/** HAP-NodeJS module (subset — Service registry is dynamic). */
export interface HAPModule {
    uuid: {
        generate(seed: string): string;
    };
    Service: Record<string, unknown>;
    Characteristic: HAPCharacteristicRegistry;
    Categories?: Record<string, unknown>;
}
//# sourceMappingURL=hap.d.ts.map