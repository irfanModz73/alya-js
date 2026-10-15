import assert from 'node:assert/strict'
import test from 'node:test'

import type { WaAuthCredentials } from '@auth/types'
import { createDeviceFanoutResolver } from '@client/messaging/fanout'
import { createNoopLogger } from '@infra/log/types'
import type { SignalDeviceSyncApi } from '@signal/api/SignalDeviceSyncApi'

const ME = '111@s.whatsapp.net'
const PEER = '222@s.whatsapp.net'

/**
 * Device list where both users are fully synced: the peer has two devices and
 * the account has three, one of which is the sending device.
 */
function createResolver(options?: { readonly syncFails?: boolean }) {
    const syncDeviceList = async (userJids: readonly string[]) => {
        if (options?.syncFails) {
            throw new Error('device list unavailable')
        }
        return userJids.map((jid) =>
            jid === ME
                ? { jid, deviceJids: [ME, '111:1@s.whatsapp.net', '111:2@s.whatsapp.net'] }
                : { jid, deviceJids: [PEER, '222:1@s.whatsapp.net'] }
        )
    }
    const resolver = createDeviceFanoutResolver({
        signalDeviceSync: { syncDeviceList } as unknown as SignalDeviceSyncApi,
        getCurrentCredentials: (): WaAuthCredentials | null => ({ meJid: ME }) as WaAuthCredentials,
        logger: createNoopLogger()
    })
    return { resolver, syncDeviceList }
}

test('direct fanout includes the own secondary devices by default', async () => {
    const { resolver } = createResolver()

    const targets = await resolver.resolveDirectFanoutDeviceJids(PEER, ME)

    assert.deepEqual(targets.sort(), [
        '111:1@s.whatsapp.net',
        '111:2@s.whatsapp.net',
        '222:1@s.whatsapp.net',
        '222@s.whatsapp.net'
    ])
})

test('noSelfSync drops every own device from the direct fanout', async () => {
    const { resolver } = createResolver()

    const targets = await resolver.resolveDirectFanoutDeviceJids(PEER, ME, true)

    assert.deepEqual(targets.sort(), ['222:1@s.whatsapp.net', '222@s.whatsapp.net'])
})

test('noSelfSync still reaches the recipient when sending to self', async () => {
    const { resolver } = createResolver()

    // Messaging yourself goes through the same path. The recipient and the
    // account are the same user, so the peer's device JIDs are the ones kept -
    // dropping them all would leave the send with no target.
    const targets = await resolver.resolveDirectFanoutDeviceJids(ME, ME, true)

    assert.deepEqual(targets.sort(), [
        '111:1@s.whatsapp.net',
        '111:2@s.whatsapp.net',
        '111@s.whatsapp.net'
    ])
})

test('direct fanout falls back to the bare recipient when the sync fails', async () => {
    const { resolver } = createResolver({ syncFails: true })

    assert.deepEqual(await resolver.resolveDirectFanoutDeviceJids(PEER, ME, true), [PEER])
})

test('group fanout keeps own secondary devices unless noSelfSync is set', async () => {
    const { resolver } = createResolver()

    // The participant scan only learns the account's base jid, so without
    // noSelfSync the paired phones still land in a group fanout.
    const targets = await resolver.resolveGroupParticipantDeviceJids([PEER, ME])

    assert.deepEqual(targets.sort(), [
        '111:1@s.whatsapp.net',
        '111:2@s.whatsapp.net',
        '222:1@s.whatsapp.net',
        '222@s.whatsapp.net'
    ])
})

test('group fanout with noSelfSync drops the own secondary devices', async () => {
    const { resolver } = createResolver()

    const targets = await resolver.resolveGroupParticipantDeviceJids([PEER, ME], true)

    assert.deepEqual(targets.sort(), ['222:1@s.whatsapp.net', '222@s.whatsapp.net'])
})
