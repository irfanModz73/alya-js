/**
 * Layer 1 – credential/store type wrapper.
 *
 * Re-exports the auth and store types from alya-js so the fixture layer can
 * seed a registered session without importing alya-js directly.
 */

export type { WaAuthCredentials, WaMobileTransportDeviceInfo } from 'alya-js/auth'
export type { WaStore } from 'alya-js/store'
