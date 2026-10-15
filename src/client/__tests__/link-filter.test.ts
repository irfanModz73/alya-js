import assert from 'node:assert/strict'
import test from 'node:test'

import {
    createAdminAllowList,
    evaluateGroupLink,
    findFirstLink,
    getMessageText,
    WA_LINK_KINDS
} from '@client/link-filter'
import type { WaIncomingMessageEvent } from '@client/types'

function groupEvent(message: unknown, overrides: Partial<WaIncomingMessageEvent['key']> = {}) {
    return {
        key: {
            remoteJid: 'group@g.us',
            id: 'M1',
            fromMe: false,
            isGroup: true,
            participant: '111@s.whatsapp.net',
            ...overrides
        },
        message
    } as unknown as WaIncomingMessageEvent
}

test('findFirstLink classifies each link kind and keeps the full url', () => {
    assert.equal(findFirstLink('https://vt.tiktok.com/abc')?.kind, WA_LINK_KINDS.TIKTOK)
    assert.equal(findFirstLink('https://vt.tiktok.com/abc')?.url, 'https://vt.tiktok.com/abc')
    assert.equal(findFirstLink('https://instagram.com/u')?.kind, WA_LINK_KINDS.INSTAGRAM)
    assert.equal(
        findFirstLink('https://chat.whatsapp.com/ABC123')?.kind,
        WA_LINK_KINDS.WHATSAPP_GROUP_INVITE
    )
    assert.equal(findFirstLink('whatsapp://channel/99')?.kind, WA_LINK_KINDS.WHATSAPP_CHANNEL)
    assert.equal(findFirstLink('https://t.me/durov')?.kind, WA_LINK_KINDS.TELEGRAM)
    assert.equal(findFirstLink('https://example.com')?.kind, WA_LINK_KINDS.GENERIC)
    assert.equal(findFirstLink('halo dunia'), null)
})

test('getMessageText reads captions out of media envelopes', () => {
    assert.equal(getMessageText({ conversation: 'hi' }), 'hi')
    assert.equal(getMessageText({ extendedTextMessage: { text: 'hi' } }), 'hi')
    assert.equal(getMessageText({ imageMessage: { caption: 'hi' } }), 'hi')
    assert.equal(
        getMessageText({
            documentWithCaptionMessage: { message: { videoMessage: { caption: 'hi' } } }
        }),
        'hi'
    )
    assert.equal(getMessageText(null), '')
})

test('a non-admin link is deleted', async () => {
    const deleted: unknown[] = []
    const result = await evaluateGroupLink(
        groupEvent({ conversation: 'https://vt.tiktok.com/x' }),
        {
            isAllowedSender: async () => false,
            deleteMessage: async (...args) => {
                deleted.push(args)
                return true
            }
        }
    )

    assert.deepEqual(result, {
        matched: true,
        kind: WA_LINK_KINDS.TIKTOK,
        url: 'https://vt.tiktok.com/x',
        action: 'deleted'
    })
    assert.deepEqual(deleted, [['group@g.us', 'M1', '111@s.whatsapp.net']])
})

test('an admin link is allowed through untouched', async () => {
    let called = false
    const result = await evaluateGroupLink(groupEvent({ conversation: 'https://t.me/x' }), {
        isAllowedSender: async () => true,
        deleteMessage: async () => {
            called = true
            return true
        }
    })

    assert.equal(result.action, 'allowed')
    assert.equal(called, false)
})

test('own messages are ignored', async () => {
    const result = await evaluateGroupLink(
        groupEvent({ conversation: 'https://t.me/x' }, { fromMe: true }),
        { isAllowedSender: async () => false, deleteMessage: async () => true }
    )

    assert.deepEqual(result, { matched: false, action: 'ignored' })
})

test('non-group messages are ignored', async () => {
    const result = await evaluateGroupLink(
        groupEvent(
            { conversation: 'https://t.me/x' },
            { isGroup: false, remoteJid: 'a@s.whatsapp.net' }
        ),
        { isAllowedSender: async () => false, deleteMessage: async () => true }
    )

    assert.deepEqual(result, { matched: false, action: 'ignored' })
})

test('messages without a link are ignored', async () => {
    const result = await evaluateGroupLink(groupEvent({ conversation: 'halo' }), {
        isAllowedSender: async () => false,
        deleteMessage: async () => true
    })

    assert.deepEqual(result, { matched: false, action: 'ignored' })
})

test('a throwing delete is reported, not rethrown', async () => {
    const result = await evaluateGroupLink(groupEvent({ conversation: 'https://t.me/x' }), {
        isAllowedSender: async () => false,
        deleteMessage: async () => {
            throw new Error('nope')
        }
    })

    assert.equal(result.action, 'delete_failed')
})

test('kinds filter narrows which links are actioned', async () => {
    const opts = {
        isAllowedSender: async () => false,
        deleteMessage: async () => true
    }
    const tiktok = await evaluateGroupLink(groupEvent({ conversation: 'https://t.me/x' }), {
        ...opts,
        kinds: [WA_LINK_KINDS.TIKTOK]
    })
    assert.equal(tiktok.matched, false)

    const allowed = await evaluateGroupLink(groupEvent({ conversation: 'https://t.me/x' }), {
        ...opts,
        kinds: [WA_LINK_KINDS.TELEGRAM]
    })
    assert.equal(allowed.action, 'deleted')
})

test('allow list admits admins, superadmins and the owner only', async () => {
    const isAllowed = createAdminAllowList(async () => ({
        owner: '999@s.whatsapp.net',
        participants: [
            { jid: '1@s.whatsapp.net', type: 'admin' },
            { jid: '2@s.whatsapp.net', type: 'superadmin' },
            { jid: '3@s.whatsapp.net', type: 'participant' }
        ]
    }))

    assert.equal(await isAllowed('g@g.us', '1@s.whatsapp.net'), true)
    assert.equal(await isAllowed('g@g.us', '2@s.whatsapp.net'), true)
    assert.equal(await isAllowed('g@g.us', '999@s.whatsapp.net'), true)
    assert.equal(await isAllowed('g@g.us', '3@s.whatsapp.net'), false)
    assert.equal(await isAllowed('g@g.us', '404@s.whatsapp.net'), false)
})
