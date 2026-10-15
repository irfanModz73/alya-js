/**
 * Layer 1 – byte/encoding primitives wrapper.
 *
 * Re-exports bit-exact byte helpers from alya-js so Layer 2/3 of the fake
 * server can use them without importing alya-js directly.
 */

export {
    bytesToBase64,
    bytesToBase64UrlSafe,
    bytesToHex,
    decodeBase64Url,
    toError
} from 'alya-js/util'

export const TEXT_ENCODER = new TextEncoder()
export const TEXT_DECODER = new TextDecoder()
