import assert from 'node:assert/strict'
import test from 'node:test'

import {
    createGroupCoordinator,
    type WaDeleteGroupStatusInput
} from '@client/coordinators/WaGroupCoordinator'
import type { WaMessagePublishResult } from '@message/types'

function iqResult(): never {
    throw new Error('deleteStatus must not issue an IQ')
}

function createCoordinator(
    publishRevoke?: (input: WaDeleteGroupStatusInput) => Promise<WaMessagePublishResult>
) {
    const published: WaDeleteGroupStatusInput[] = []
    const coordinator = createGroupCoordinator({
        queryWithContext: async () => iqResult(),
        ...(publishRevoke
            ? {
                  publishRevoke: async (input) => {
                      published.push(input)
                      return publishRevoke(input)
                  }
              }
            : {})
    })
    return { coordinator, published }
}

const RESULT: WaMessagePublishResult = { id: 'ack', attempts: 1 } as WaMessagePublishResult

test('deleteStatus forwards the group jid, message id and options', async () => {
    const { coordinator, published } = createCoordinator(async () => RESULT)

    const result = await coordinator.deleteStatus({
        groupJid: 'group@g.us',
        messageId: 'ST-1',
        options: { noSelfSync: true }
    })

    assert.equal(result, RESULT)
    assert.deepEqual(published, [
        { groupJid: 'group@g.us', messageId: 'ST-1', options: { noSelfSync: true } }
    ])
})

test('deleteStatus carries the participant when revoking another member status', async () => {
    const { coordinator, published } = createCoordinator(async () => RESULT)

    await coordinator.deleteStatus({
        groupJid: 'group@g.us',
        messageId: 'ST-2',
        participant: '555@s.whatsapp.net'
    })

    assert.equal(published[0].participant, '555@s.whatsapp.net')
})

test('deleteStatus throws when the coordinator has no message publisher', async () => {
    const { coordinator } = createCoordinator()

    await assert.rejects(
        () => coordinator.deleteStatus({ groupJid: 'group@g.us', messageId: 'ST-3' }),
        /requires a message publisher/
    )
})
