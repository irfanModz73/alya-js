import { type Proto , proto as protoNs } from '@proto'
import { findNodeChild, getNodeChildrenByTag, getNodeTextContent } from '@transport/node/helpers'
import type { BinaryNode } from '@transport/types'
import { bytesToBase64 } from '@util/bytes'

/** Acknowledgement of a newsletter status publication. */
export interface WaNewsletterStatusAck {
    readonly class?: string
    readonly from?: string
    readonly id?: string
    readonly t?: number
    readonly serverId?: number
    readonly edit?: string
    readonly error?: string
    readonly applicationError?: number
    readonly backoff?: number
    readonly node: BinaryNode
}

export interface WaNewsletterStatusAdminProfile {
    readonly id?: string
    readonly name?: string
    readonly pictureId?: string
    readonly pictureDirectPath?: string
}

export interface WaNewsletterStatusReactionCount {
    readonly code?: string
    readonly count?: number
}

export interface WaNewsletterStatus {
    readonly id?: string
    readonly serverId?: number
    readonly t?: number
    readonly isSender: boolean
    readonly type?: string
    readonly edit?: string
    readonly mediaType?: string
    readonly interactionType?: string
    readonly reaction?: string
    readonly adminProfile?: WaNewsletterStatusAdminProfile
    readonly paidPartnership: boolean
    readonly aiContent: boolean
    readonly editTimestamp?: number
    readonly originalTimestamp?: number
    readonly reactionCounts?: readonly WaNewsletterStatusReactionCount[]
    readonly viewsCount?: number
    readonly responsesCount?: number
    readonly message?: Proto.IMessage
    readonly node: BinaryNode
}

export interface WaNewsletterStatusesPage {
    readonly jid?: string
    readonly t?: number
    readonly statuses: readonly WaNewsletterStatus[]
}

function readIntAttr(attrs: Record<string, string> | undefined, key: string): number | undefined {
    const raw = attrs?.[key]
    if (raw === undefined || raw === '') return undefined
    const parsed = Number.parseInt(String(raw), 10)
    return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Parses an `<ack>` for a newsletter status publish. Throws on a class, id or
 * `from` mismatch so a mismatched ack is never mistaken for success.
 */
export function parseNewsletterStatusAck(
    node: BinaryNode,
    expected?: { readonly jid?: string; readonly messageId?: string }
): WaNewsletterStatusAck {
    if (node.tag !== WA_ACK_TAG) {
        throw new Error(`newsletter status expected <${WA_ACK_TAG}>, got <${node.tag}>`)
    }
    const attrs = node.attrs
    if (attrs.class !== undefined && attrs.class !== 'status') {
        throw new Error(`newsletter status ack has class "${attrs.class}", expected "status"`)
    }
    if (
        expected?.messageId !== undefined &&
        attrs.id !== undefined &&
        attrs.id !== expected.messageId
    ) {
        throw new Error(`newsletter status ack id mismatch: ${attrs.id} != ${expected.messageId}`)
    }
    if (expected?.jid !== undefined && attrs.from !== undefined && attrs.from !== expected.jid) {
        throw new Error(`newsletter status ack from mismatch: ${attrs.from} != ${expected.jid}`)
    }
    return {
        ...(attrs.class !== undefined ? { class: attrs.class } : {}),
        ...(attrs.from !== undefined ? { from: attrs.from } : {}),
        ...(attrs.id !== undefined ? { id: attrs.id } : {}),
        ...(readIntAttr(attrs, 't') !== undefined ? { t: readIntAttr(attrs, 't')! } : {}),
        ...(readIntAttr(attrs, 'server_id') !== undefined
            ? { serverId: readIntAttr(attrs, 'server_id')! }
            : {}),
        ...(attrs.edit !== undefined ? { edit: attrs.edit } : {}),
        ...(attrs.error !== undefined && attrs.error !== '' ? { error: String(attrs.error) } : {}),
        ...(readIntAttr(attrs, 'application_error') !== undefined
            ? { applicationError: readIntAttr(attrs, 'application_error')! }
            : {}),
        ...(readIntAttr(attrs, 'backoff') !== undefined
            ? { backoff: readIntAttr(attrs, 'backoff')! }
            : {}),
        node
    }
}

const WA_ACK_TAG = 'ack'

function decodeStatusPayload(plaintext: BinaryNode | undefined): Proto.IMessage | undefined {
    const bytes = plaintext?.content
    if (!bytes || Array.isArray(bytes)) return undefined
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    try {
        return protoNs.Message.decode(view)
    } catch {
        return undefined
    }
}

function parseAdminProfile(
    meta: BinaryNode | undefined
): WaNewsletterStatusAdminProfile | undefined {
    const adminProfile = meta ? findNodeChild(meta, 'admin_profile') : undefined
    if (!adminProfile) return undefined
    const name = findNodeChild(adminProfile, 'name')
    const picture = findNodeChild(adminProfile, 'picture')
    const content = name?.content
    const nameText =
        typeof content === 'string'
            ? content
            : content instanceof Uint8Array
              ? bytesToBase64(content)
              : undefined
    return {
        ...(adminProfile.attrs?.id ? { id: adminProfile.attrs.id } : {}),
        ...(nameText !== undefined ? { name: nameText } : {}),
        ...(picture?.attrs?.id ? { pictureId: picture.attrs.id } : {}),
        ...(picture?.attrs?.direct_path ? { pictureDirectPath: picture.attrs.direct_path } : {})
    }
}

/** Parses one `<status>` node out of a statuses list or update. */
export function parseNewsletterStatusNode(status: BinaryNode): WaNewsletterStatus {
    const plaintext = findNodeChild(status, 'plaintext')
    const reaction = findNodeChild(status, 'reaction')
    const meta = findNodeChild(status, 'meta')
    const reactions = findNodeChild(status, 'reactions')
    const viewsCount = findNodeChild(status, 'views_count')
    const responsesCount = findNodeChild(status, 'responses_count')
    const reactionEntries = reactions ? getNodeChildrenByTag(reactions, 'reaction') : []
    return {
        ...(status.attrs?.id ? { id: status.attrs.id } : {}),
        ...(readIntAttr(status.attrs, 'server_id') !== undefined
            ? { serverId: readIntAttr(status.attrs, 'server_id')! }
            : {}),
        ...(readIntAttr(status.attrs, 't') !== undefined
            ? { t: readIntAttr(status.attrs, 't')! }
            : {}),
        isSender: status.attrs?.is_sender === 'true',
        ...(status.attrs?.type ? { type: status.attrs.type } : {}),
        ...(status.attrs?.edit ? { edit: status.attrs.edit } : {}),
        ...(plaintext?.attrs?.mediatype ? { mediaType: plaintext.attrs.mediatype } : {}),
        ...(meta?.attrs?.interaction_type ? { interactionType: meta.attrs.interaction_type } : {}),
        ...(reaction ? { reaction: reaction.attrs?.code ?? '' } : {}),
        ...(parseAdminProfile(meta) ? { adminProfile: parseAdminProfile(meta)! } : {}),
        paidPartnership: meta ? findNodeChild(meta, 'paid_partnership') !== undefined : false,
        aiContent: meta ? findNodeChild(meta, 'ai_content') !== undefined : false,
        ...(readIntAttr(meta?.attrs, 'msg_edit_t') !== undefined
            ? { editTimestamp: readIntAttr(meta?.attrs, 'msg_edit_t')! }
            : {}),
        ...(readIntAttr(meta?.attrs, 'original_msg_t') !== undefined
            ? { originalTimestamp: readIntAttr(meta?.attrs, 'original_msg_t')! }
            : {}),
        ...(reactions
            ? {
                  reactionCounts: reactionEntries.map((entry) => ({
                      ...(entry.attrs?.code ? { code: entry.attrs.code } : {}),
                      ...(readIntAttr(entry.attrs, 'count') !== undefined
                          ? { count: readIntAttr(entry.attrs, 'count')! }
                          : {})
                  }))
              }
            : {}),
        ...(readIntAttr(viewsCount?.attrs, 'count') !== undefined
            ? { viewsCount: readIntAttr(viewsCount?.attrs, 'count')! }
            : {}),
        ...(readIntAttr(responsesCount?.attrs, 'count') !== undefined
            ? { responsesCount: readIntAttr(responsesCount?.attrs, 'count')! }
            : {}),
        ...(decodeStatusPayload(plaintext) ? { message: decodeStatusPayload(plaintext)! } : {}),
        node: status
    }
}

/**
 * Parses a `<statuses>` list.
 *
 * Throws when the wrapper is absent rather than returning an empty list, so a
 * shape change surfaces as an error instead of looking like an empty channel.
 */
export function parseNewsletterStatusesResponse(node: BinaryNode): WaNewsletterStatusesPage {
    const statuses = findNodeChild(node, 'statuses')
    if (!statuses) {
        const children = Array.isArray(node.content)
            ? node.content.map((child) => child?.tag).join(', ')
            : ''
        throw new Error(`newsletter statuses response has no <statuses> child, got [${children}]`)
    }
    return {
        ...(statuses.attrs?.jid ? { jid: statuses.attrs.jid } : {}),
        ...(readIntAttr(statuses.attrs, 't') !== undefined
            ? { t: readIntAttr(statuses.attrs, 't')! }
            : {}),
        statuses: getNodeChildrenByTag(statuses, 'status').map(parseNewsletterStatusNode)
    }
}

/** Parses a `<status_updates>` response. */
export function parseNewsletterStatusUpdatesResponse(node: BinaryNode): WaNewsletterStatusesPage {
    const updates = findNodeChild(node, 'status_updates')
    if (!updates) {
        const children = Array.isArray(node.content)
            ? node.content.map((child) => child?.tag).join(', ')
            : ''
        throw new Error(
            `newsletter status updates response has no <status_updates> child, got [${children}]`
        )
    }
    return parseNewsletterStatusesResponse(updates)
}

/**
 * Reads a server id out of a `<status>` echo. The publish ack carries only
 * `class`, `id`, and `t`; the server id arrives in a separate stanza, and a
 * reaction or revoke cannot be built without it.
 */
export function readNewsletterStatusServerId(node: BinaryNode): number | undefined {
    if (node.tag !== 'status') return undefined
    return readIntAttr(node.attrs, 'server_id')
}

export { getNodeTextContent }
