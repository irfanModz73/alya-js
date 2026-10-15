import assert from 'node:assert/strict'
import test from 'node:test'

import {
    createStatusInteractions,
    WA_STATUS_LIKE_EMOJI
} from '@client/coordinators/status-interactions'
import { classifyStatusMedia, listStatuses } from '@client/status-query'
import { proto } from '@proto'
import type { WaMessageStore } from '@store/contracts/message.store'

function storeOf(rows: readonly Record<string, unknown>[]): WaMessageStore {
    return {
        listByThread: async () => rows,
        getById: async () => null,
        upsert: async () => undefined,
        upsertBatch: async () => undefined,
        deleteById: async () => 0,
        clear: async () => undefined
    } as unknown as WaMessageStore
}

function imageRow(id: string, owner: string, caption = '') {
    return {
        id,
        threadJid: 'status@broadcast',
        participantJid: owner,
        fromMe: false,
        timestampMs: 1_700_000_000,
        messageBytes: proto.Message.encode({
            imageMessage: { mimetype: 'image/jpeg', caption }
        }).finish()
    }
}

test('classifyStatusMedia detects each media kind and skips text', () => {
    assert.equal(classifyStatusMedia({ imageMessage: {} }), 'image')
    assert.equal(classifyStatusMedia({ videoMessage: {} }), 'video')
    assert.equal(classifyStatusMedia({ audioMessage: {} }), 'audio')
    assert.equal(classifyStatusMedia({ stickerMessage: {} }), 'sticker')
    assert.equal(classifyStatusMedia({ documentMessage: {} }), 'document')
    assert.equal(classifyStatusMedia({ conversation: 'hi' }), null)
    assert.equal(classifyStatusMedia(null), null)
})

test('listStatuses unwraps document-with-caption and reads the caption', async () => {
    const row = {
        id: 'S1',
        threadJid: 'status@broadcast',
        participantJid: '628@s.whatsapp.net',
        fromMe: false,
        timestampMs: 1_700_000_000,
        messageBytes: proto.Message.encode({
            documentWithCaptionMessage: {
                message: { imageMessage: { mimetype: 'image/jpeg', caption: 'caption here' } }
            }
        }).finish()
    }

    const [entry] = await listStatuses(storeOf([row]), { chats: ['status@broadcast'] })

    assert.equal(entry.mediaKind, 'image')
    assert.equal(entry.caption, 'caption here')
})

test('listStatuses filters by owner', async () => {
    const rows = [imageRow('A', '111@s.whatsapp.net'), imageRow('B', '222@s.whatsapp.net')]

    const entries = await listStatuses(storeOf(rows), {
        chats: ['status@broadcast'],
        owner: '222@s.whatsapp.net'
    })

    assert.deepEqual(
        entries.map((e) => e.id),
        ['B']
    )
})

test('listStatuses applies the since cutoff', async () => {
    const old = { ...imageRow('OLD', '111@s.whatsapp.net'), timestampMs: 1_000 }
    const fresh = { ...imageRow('NEW', '111@s.whatsapp.net'), timestampMs: 9_000 }

    const entries = await listStatuses(storeOf([old, fresh]), {
        chats: ['status@broadcast'],
        since: 5_000
    })

    assert.deepEqual(
        entries.map((e) => e.id),
        ['NEW']
    )
})

test('react sends a reaction to status@broadcast with the owner as participant', async () => {
    const sent: unknown[] = []
    const status = createStatusInteractions({
        messageStore: storeOf([]),
        sendMessage: async (to, content, options) => {
            sent.push({ to, content, options })
            return { id: 'ack', attempts: 1 } as never
        },
        downloadBytes: async () => new Uint8Array()
    })

    await status.react({ statusId: 'S1', owner: '628@s.whatsapp.net', emoji: '🔥' })

    assert.equal(sent.length, 1)
    const call = sent[0] as {
        to: string
        content: { type: string; emoji: string; target: Record<string, string> }
    }
    assert.equal(call.to, 'status@broadcast')
    assert.equal(call.content.type, 'reaction')
    assert.equal(call.content.emoji, '🔥')
    assert.deepEqual(call.content.target, {
        remoteJid: 'status@broadcast',
        id: 'S1',
        fromMe: false,
        participant: '628@s.whatsapp.net'
    })
})

test('like uses the heart emoji', async () => {
    const sent: string[] = []
    const status = createStatusInteractions({
        messageStore: storeOf([]),
        sendMessage: async (_to, content) => {
            sent.push((content as { emoji: string }).emoji)
            return { id: 'ack', attempts: 1 } as never
        },
        downloadBytes: async () => new Uint8Array()
    })

    await status.like({ statusId: 'S1', owner: '628@s.whatsapp.net' })

    assert.deepEqual(sent, [WA_STATUS_LIKE_EMOJI])
})

test('apply reacts to every status of one owner and counts failures', async () => {
    const rows = [imageRow('A', '111@s.whatsapp.net'), imageRow('B', '111@s.whatsapp.net')]
    let calls = 0
    const status = createStatusInteractions({
        messageStore: storeOf(rows),
        sendMessage: async (_to, content) => {
            calls += 1
            if (calls === 2) throw new Error('ack timeout')
            return { id: 'ack', attempts: 1 } as never
        },
        downloadBytes: async () => new Uint8Array()
    })

    const result = await status.apply({
        targets: ['111@s.whatsapp.net'],
        action: 'react',
        emoji: '❤️'
    })

    assert.equal(result.attempted, 2)
    assert.equal(result.reacted, 1)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].message, 'ack timeout')
})

test('apply with action like ignores the supplied emoji', async () => {
    const emojis: string[] = []
    const status = createStatusInteractions({
        messageStore: storeOf([imageRow('A', '111@s.whatsapp.net')]),
        sendMessage: async (_to, content) => {
            emojis.push((content as { emoji: string }).emoji)
            return { id: 'ack', attempts: 1 } as never
        },
        downloadBytes: async () => new Uint8Array()
    })

    await status.apply({ targets: ['111@s.whatsapp.net'], action: 'like', emoji: 'ZZZ' })

    assert.deepEqual(emojis, [WA_STATUS_LIKE_EMOJI])
})

test('download returns bytes for media statuses and skips text', async () => {
    const rows = [
        imageRow('A', '111@s.whatsapp.net'),
        {
            id: 'T',
            threadJid: 'status@broadcast',
            participantJid: '111@s.whatsapp.net',
            fromMe: false,
            messageBytes: proto.Message.encode({ conversation: 'text only' }).finish()
        }
    ]
    const status = createStatusInteractions({
        messageStore: storeOf(rows),
        sendMessage: async () => ({ id: 'ack', attempts: 1 }) as never,
        downloadBytes: async () => new Uint8Array([1, 2, 3])
    })

    const out = await status.download({ chatJid: 'status@broadcast' })

    assert.equal(out.length, 1)
    assert.equal(out[0].entry.id, 'A')
    assert.deepEqual([...out[0].bytes], [1, 2, 3])
})

test('downloadGroup scans the group thread and skips text statuses', async () => {
    const scanned: string[] = []
    const rows = [
        {
            id: 'G1',
            threadJid: 'group@g.us',
            participantJid: '111@s.whatsapp.net',
            fromMe: false,
            messageBytes: proto.Message.encode({ videoMessage: { mimetype: 'video/mp4' } }).finish()
        },
        {
            id: 'G2',
            threadJid: 'group@g.us',
            participantJid: '111@s.whatsapp.net',
            fromMe: false,
            messageBytes: proto.Message.encode({ conversation: 'text' }).finish()
        }
    ]
    const status = createStatusInteractions({
        messageStore: {
            listByThread: async (threadJid) => {
                scanned.push(threadJid)
                return rows
            },
            getById: async () => null,
            upsert: async () => undefined,
            upsertBatch: async () => undefined,
            deleteById: async () => 0,
            clear: async () => undefined
        } as unknown as WaMessageStore,
        sendMessage: async () => ({ id: 'ack', attempts: 1 }) as never,
        downloadBytes: async () => new Uint8Array([7])
    })

    const out = await status.downloadGroup('group@g.us')

    assert.deepEqual(scanned, ['group@g.us'])
    assert.equal(out.length, 1)
    assert.equal(out[0].entry.id, 'G1')
    assert.equal(out[0].entry.mediaKind, 'video')
})
