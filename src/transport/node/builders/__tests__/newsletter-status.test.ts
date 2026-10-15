import assert from 'node:assert/strict'
import test from 'node:test'

import { proto } from '@proto'
import {
    parseNewsletterStatusNode,
    parseNewsletterStatusesResponse
} from '@client/events/newsletter-status'
import { createNewsletterStatusOps } from '@client/newsletter/status'
import {
    buildNewsletterStatusNode,
    buildNewsletterStatusReactionNode,
    buildNewsletterStatusRevokeNode,
    toNewsletterServerId,
    WA_NEWSLETTER_SERVER_ID_MAX,
    WA_NEWSLETTER_SERVER_ID_MIN
} from '@transport/node/builders/newsletter-status'
import type { BinaryNode } from '@transport/types'

const CHANNEL = '1234567890@newsletter'

test('server id bounds reject out-of-range values', () => {
    assert.equal(toNewsletterServerId(WA_NEWSLETTER_SERVER_ID_MIN, 'x'), '99')
    assert.equal(toNewsletterServerId(WA_NEWSLETTER_SERVER_ID_MAX, 'x'), '2147476647')
    assert.throws(() => toNewsletterServerId(98, 'x'), /must be an integer/)
    assert.throws(
        () => toNewsletterServerId(WA_NEWSLETTER_SERVER_ID_MAX + 1, 'x'),
        /must be an integer/
    )
})

test('a non-newsletter jid is rejected by every builder', () => {
    const payload = proto.Message.encode({ conversation: 'hi' }).finish()
    assert.throws(
        () =>
            buildNewsletterStatusNode({
                jid: '123@s.whatsapp.net',
                messageId: 'M',
                plaintext: payload
            }),
        /@newsletter/
    )
    assert.throws(
        () =>
            buildNewsletterStatusReactionNode({
                jid: 'a@s.whatsapp.net',
                messageId: 'M',
                parentServerId: 100
            }),
        /@newsletter/
    )
    assert.throws(
        () => buildNewsletterStatusRevokeNode({ jid: 'a@s.whatsapp.net', statusId: 'M' }),
        /@newsletter/
    )
})

test('text status builds a text-typed plaintext stanza', () => {
    const node = buildNewsletterStatusNode({
        jid: CHANNEL,
        messageId: 'M1',
        plaintext: proto.Message.encode({ conversation: 'hi' }).finish()
    })

    assert.equal(node.tag, 'status')
    assert.equal(node.attrs.to, CHANNEL)
    assert.equal(node.attrs.type, 'text')
    assert.equal(node.attrs.media_id, undefined)
    assert.equal(node.content[0].tag, 'plaintext')
    assert.deepEqual(node.content[0].attrs, {})
})

test('media status carries media_id and a mediatype', () => {
    const node = buildNewsletterStatusNode({
        jid: CHANNEL,
        messageId: 'M1',
        plaintext: new Uint8Array([1, 2, 3]),
        mediaType: 'image',
        mediaHandle: 'H1'
    })

    assert.equal(node.attrs.type, 'media')
    assert.equal(node.attrs.media_id, 'H1')
    assert.deepEqual(node.content[0].attrs, { mediatype: 'image' })
})

test('media status without a handle is rejected', () => {
    assert.throws(
        () =>
            buildNewsletterStatusNode({
                jid: CHANNEL,
                messageId: 'M1',
                plaintext: new Uint8Array([1]),
                mediaType: 'image'
            }),
        /requires the handle/
    )
})

test('a handle without a media type is rejected', () => {
    assert.throws(
        () =>
            buildNewsletterStatusNode({
                jid: CHANNEL,
                messageId: 'M1',
                plaintext: new Uint8Array([1]),
                mediaHandle: 'H1'
            }),
        /requires a mediaType/
    )
})

test('question_response pins the parent server id and rejects media', () => {
    const node = buildNewsletterStatusNode({
        jid: CHANNEL,
        messageId: 'M1',
        plaintext: new Uint8Array([1]),
        interactionType: 'question_response',
        parentServerId: 12345
    })

    assert.equal(node.attrs.server_id, '12345')
    assert.equal(node.attrs.type, 'text')
    assert.throws(
        () =>
            buildNewsletterStatusNode({
                jid: CHANNEL,
                messageId: 'M1',
                plaintext: new Uint8Array([1]),
                interactionType: 'question_response',
                parentServerId: 12345,
                mediaType: 'image',
                mediaHandle: 'H'
            }),
        /text status/
    )
})

test('question_reshare needs both server ids and media', () => {
    const node = buildNewsletterStatusNode({
        jid: CHANNEL,
        messageId: 'M1',
        plaintext: new Uint8Array([1]),
        interactionType: 'question_reshare',
        parentServerId: 100,
        responseServerId: 200,
        mediaType: 'video',
        mediaHandle: 'H'
    })
    const meta = node.content[1]
    assert.equal(meta.tag, 'meta')
    assert.equal(meta.attrs.parent_server_id, '100')
    assert.equal(meta.attrs.response_server_id, '200')

    assert.throws(
        () =>
            buildNewsletterStatusNode({
                jid: CHANNEL,
                messageId: 'M1',
                plaintext: new Uint8Array([1]),
                interactionType: 'question_reshare'
            }),
        /question_reshare requires/
    )
})

test('ai content without an interaction still emits a meta node', () => {
    const node = buildNewsletterStatusNode({
        jid: CHANNEL,
        messageId: 'M1',
        plaintext: new Uint8Array([1]),
        aiContent: true
    })

    assert.equal(node.content[1].tag, 'meta')
    assert.equal(node.content[1].content[0].tag, 'ai_content')
})

test('reaction stanza carries the server id and edit marker when revoking', () => {
    const set = buildNewsletterStatusReactionNode({
        jid: CHANNEL,
        messageId: 'M1',
        parentServerId: 500,
        reaction: '1f44d'
    })
    assert.equal(set.attrs.type, 'reaction')
    assert.equal(set.attrs.server_id, '500')
    assert.equal(set.attrs.edit, undefined)
    assert.deepEqual(set.content[0].attrs, { code: '1f44d' })

    const cleared = buildNewsletterStatusReactionNode({
        jid: CHANNEL,
        messageId: 'M1',
        parentServerId: 500
    })
    assert.equal(cleared.attrs.edit, '7')
    assert.deepEqual(cleared.content[0].attrs, {})
})

test('revoke stanza uses the admin-revoke edit marker', () => {
    const node = buildNewsletterStatusRevokeNode({ jid: CHANNEL, statusId: 'S1' })

    assert.equal(node.attrs.edit, '8')
    assert.equal(node.attrs.type, 'text')
    assert.equal(node.content[0].tag, 'plaintext')
})

test('parseNewsletterStatusNode reads the counters and decodes the payload', () => {
    const payload = proto.Message.encode({ conversation: 'hello' }).finish()
    const node: BinaryNode = {
        tag: 'status',
        attrs: { id: 'S1', server_id: '900', t: '1700', is_sender: 'true', type: 'text' },
        content: [
            { tag: 'plaintext', attrs: {}, content: payload },
            {
                tag: 'meta',
                attrs: { interaction_type: 'question', msg_edit_t: '55' },
                content: [{ tag: 'admin_profile', attrs: { id: 'A1' } }]
            },
            {
                tag: 'reactions',
                attrs: {},
                content: [{ tag: 'reaction', attrs: { code: '1f44d', count: '3' } }]
            },
            { tag: 'views_count', attrs: { count: '7' } },
            { tag: 'responses_count', attrs: { count: '2' } }
        ]
    }

    const status = parseNewsletterStatusNode(node)

    assert.equal(status.id, 'S1')
    assert.equal(status.serverId, 900)
    assert.equal(status.isSender, true)
    assert.equal(status.interactionType, 'question')
    assert.equal(status.editTimestamp, 55)
    assert.equal(status.viewsCount, 7)
    assert.equal(status.responsesCount, 2)
    assert.deepEqual(status.reactionCounts, [{ code: '1f44d', count: 3 }])
    assert.equal(status.adminProfile?.id, 'A1')
    assert.equal(status.message?.conversation, 'hello')
})

test('a statuses response without the wrapper throws instead of returning empty', () => {
    assert.throws(
        () =>
            parseNewsletterStatusesResponse({
                tag: 'iq',
                attrs: {},
                content: [{ tag: 'other', attrs: {} }]
            }),
        /has no <statuses> child/
    )
})

test('a statuses response parses every status child', () => {
    const page = parseNewsletterStatusesResponse({
        tag: 'status_updates',
        attrs: {},
        content: [
            {
                tag: 'statuses',
                attrs: { jid: CHANNEL, t: '42' },
                content: [
                    { tag: 'status', attrs: { id: 'S1', server_id: '100' } },
                    { tag: 'status', attrs: { id: 'S2', server_id: '101' } }
                ]
            }
        ]
    })

    assert.equal(page.jid, CHANNEL)
    assert.equal(page.t, 42)
    assert.deepEqual(
        page.statuses.map((s) => s.id),
        ['S1', 'S2']
    )
})

test('sendStatus encodes the message and wraps it in a status stanza', async () => {
    const sent: BinaryNode[] = []
    const ops = createNewsletterStatusOps({
        sendNode: async (node) => {
            sent.push(node)
        },
        query: async () => {
            throw new Error('not used')
        },
        buildMessageContent: async () => ({ plaintext: proto.Message.encode({ conversation: 'hi' }).finish() }),
        generateStanzaId: async () => 'GEN1'
    })

    const result = await ops.sendStatus({ jid: CHANNEL, content: 'ignored' })

    assert.equal(result.id, 'GEN1')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].tag, 'status')
    assert.equal(sent[0].attrs.id, 'GEN1')
    // The attribution context is applied by default.
    assert.equal(result.payload.length > 0, true)
})

test('sendStatus resolves the server id when asked and the waiter resolves', async () => {
    let waited: { jid: string; messageId: string } | undefined
    const ops = createNewsletterStatusOps({
        sendNode: async () => undefined,
        query: async () => {
            throw new Error('not used')
        },
        buildMessageContent: async () => ({ plaintext: proto.Message.encode({ conversation: 'hi' }).finish() }),
        generateStanzaId: async () => 'GEN2',
        waitForServerId: async ({ jid, messageId }) => {
            waited = { jid, messageId }
            return 777
        }
    })

    const result = await ops.sendStatus({ jid: CHANNEL, content: 'x', resolveServerId: true })

    assert.equal(result.serverId, 777)
    assert.deepEqual(waited, { jid: CHANNEL, messageId: 'GEN2' })
})

test('reactToStatus and revokeStatus send their stanzas', async () => {
    const sent: BinaryNode[] = []
    const ops = createNewsletterStatusOps({
        sendNode: async (node) => {
            sent.push(node)
        },
        query: async () => {
            throw new Error('not used')
        },
        buildMessageContent: async () => ({ plaintext: proto.Message.encode({ conversation: 'hi' }).finish() }),
        generateStanzaId: async () => 'GEN3'
    })

    await ops.reactToStatus({
        jid: CHANNEL,
        messageId: 'S1',
        parentServerId: 900,
        reaction: '1f44d'
    })
    await ops.revokeStatus({ jid: CHANNEL, statusId: 'S1' })

    assert.equal(sent[0].attrs.type, 'reaction')
    assert.equal(sent[1].attrs.edit, '8')
})
