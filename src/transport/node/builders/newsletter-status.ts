import { proto, type Proto } from '@proto'
import { WA_IQ_TYPES, WA_NODE_TAGS, WA_XMLNS } from '@protocol/constants'
import { isNewsletterJid } from '@protocol/jid'
import { buildIqNode } from '@transport/node/query'
import type { BinaryNode } from '@transport/types'

/** Interaction kinds a newsletter status can carry. */
export const WA_NEWSLETTER_STATUS_INTERACTIONS = Object.freeze({
    QUESTION: 'question',
    QUESTION_RESPONSE: 'question_response',
    QUESTION_RESHARE: 'question_reshare'
} as const)

export type WaNewsletterStatusInteraction =
    (typeof WA_NEWSLETTER_STATUS_INTERACTIONS)[keyof typeof WA_NEWSLETTER_STATUS_INTERACTIONS]

/** Media kinds a newsletter status can carry. */
export const WA_NEWSLETTER_STATUS_MEDIA_TYPES = Object.freeze({
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    GIF: 'gif'
} as const)

export type WaNewsletterStatusMediaType =
    (typeof WA_NEWSLETTER_STATUS_MEDIA_TYPES)[keyof typeof WA_NEWSLETTER_STATUS_MEDIA_TYPES]

/**
 * `edit` attribute values on a newsletter status stanza.
 *
 * `7` marks an edit that clears a reaction, `8` an admin revoke. Both are
 * literal values from the wire format, not ordinals we choose.
 */
export const WA_NEWSLETTER_STATUS_EDITS = Object.freeze({
    REACTION_REVOKE: '7',
    ADMIN_REVOKE: '8'
} as const)

/**
 * The server assigns ids in this range and rejects anything outside it, so a
 * status id has to be validated before it goes back on the wire.
 */
export const WA_NEWSLETTER_SERVER_ID_MIN = 99
export const WA_NEWSLETTER_SERVER_ID_MAX = 2_147_476_647

/** Validates and normalizes a newsletter server id. */
export function toNewsletterServerId(value: number | string, label: string): string {
    const parsed = typeof value === 'number' ? value : Number.parseInt(value.trim(), 10)
    if (
        !Number.isInteger(parsed) ||
        parsed < WA_NEWSLETTER_SERVER_ID_MIN ||
        parsed > WA_NEWSLETTER_SERVER_ID_MAX
    ) {
        throw new Error(
            `newsletter server id ${label} must be an integer in ${WA_NEWSLETTER_SERVER_ID_MIN}..${WA_NEWSLETTER_SERVER_ID_MAX}, got ${String(value)}`
        )
    }
    return String(parsed)
}

function assertNewsletter(jid: string): void {
    if (!isNewsletterJid(jid)) {
        throw new Error(`newsletter status target must be a @newsletter jid, got ${jid}`)
    }
}

export interface WaNewsletterStatusMetaInput {
    readonly interactionType?: WaNewsletterStatusInteraction
    readonly parentServerId?: number | string
    readonly responseServerId?: number | string
    readonly aiContent?: boolean
}

function buildMetaNode(input: WaNewsletterStatusMetaInput): BinaryNode | undefined {
    const attrs: Record<string, string> = {}
    const interaction = input.interactionType
    if (interaction) {
        if (interaction !== WA_NEWSLETTER_STATUS_INTERACTIONS.QUESTION) {
            attrs.interaction_type = interaction
        }
        if (interaction === WA_NEWSLETTER_STATUS_INTERACTIONS.QUESTION_RESHARE) {
            if (input.parentServerId === undefined || input.responseServerId === undefined) {
                throw new Error('question_reshare requires parentServerId and responseServerId')
            }
            attrs.parent_server_id = toNewsletterServerId(input.parentServerId, 'parentServerId')
            attrs.response_server_id = String(input.responseServerId)
        } else if (
            interaction === WA_NEWSLETTER_STATUS_INTERACTIONS.QUESTION_RESPONSE &&
            input.responseServerId !== undefined
        ) {
            attrs.response_server_id = String(input.responseServerId)
        }
    }
    if (!interaction && !input.aiContent) return undefined
    return {
        tag: 'meta',
        attrs,
        ...(input.aiContent
            ? { content: [{ tag: 'ai_content', attrs: {}, content: undefined }] }
            : {})
    }
}

/**
 * Adds the newsletter-status attribution to a message's context so a reply
 * carries the channel provenance.
 */
export function withNewsletterStatusAttribution(message: Proto.IMessage): Proto.IMessage {
    const contextInfo: Proto.IContextInfo = {
        ...(message.contextInfo ?? {}),
        statusAttributions: [{ type: proto.StatusAttribution.Type.NEWSLETTER_STATUS }],
        featureEligibilities: { canBeReshared: true }
    }
    return { ...message, contextInfo }
}

export interface BuildNewsletterStatusInput extends WaNewsletterStatusMetaInput {
    readonly jid: string
    readonly messageId: string
    /** Encoded `Proto.Message` payload. */
    readonly plaintext: Uint8Array
    readonly mediaType?: WaNewsletterStatusMediaType
    /** Media handle returned by the newsletter upload, or its id. */
    readonly mediaHandle?: string | number
}

/**
 * Builds the `<status>` stanza that publishes a newsletter status.
 */
export function buildNewsletterStatusNode(input: BuildNewsletterStatusInput): BinaryNode {
    assertNewsletter(input.jid)
    if (!input.messageId) {
        throw new Error('newsletter status requires a messageId')
    }
    const handle =
        input.mediaHandle !== undefined && input.mediaHandle !== ''
            ? String(input.mediaHandle)
            : undefined
    if (handle && !input.mediaType) {
        throw new Error('newsletter status media handle requires a mediaType')
    }
    if (input.mediaType && !handle) {
        throw new Error('newsletter status media requires the handle returned by the upload')
    }
    const interaction = input.interactionType
    if (interaction === WA_NEWSLETTER_STATUS_INTERACTIONS.QUESTION_RESHARE && !input.mediaType) {
        throw new Error('question_reshare requires media')
    }
    if (interaction === WA_NEWSLETTER_STATUS_INTERACTIONS.QUESTION_RESPONSE) {
        if (input.mediaType) {
            throw new Error('question_response is published as a text status')
        }
        if (input.parentServerId === undefined) {
            throw new Error('question_response requires parentServerId')
        }
    }

    const attrs: Record<string, string> = {
        to: input.jid,
        id: input.messageId,
        type: input.mediaType ? 'media' : 'text'
    }
    if (input.mediaType && handle) {
        attrs.media_id = handle
    }
    if (interaction === WA_NEWSLETTER_STATUS_INTERACTIONS.QUESTION_RESPONSE) {
        attrs.server_id = toNewsletterServerId(input.parentServerId!, 'parentServerId')
    }

    const content: BinaryNode[] = [
        {
            tag: WA_NODE_TAGS.PLAINTEXT,
            attrs: input.mediaType ? { mediatype: input.mediaType } : {},
            content: input.plaintext
        }
    ]
    const meta = buildMetaNode(input)
    if (meta) content.push(meta)

    return { tag: WA_NODE_TAGS.STATUS, attrs, content }
}

export interface BuildNewsletterStatusReactionInput {
    readonly jid: string
    readonly messageId: string
    readonly parentServerId: number | string
    /** Emoji code, or empty to clear the reaction. */
    readonly reaction?: string
}

export function buildNewsletterStatusReactionNode(
    input: BuildNewsletterStatusReactionInput
): BinaryNode {
    assertNewsletter(input.jid)
    if (!input.messageId) {
        throw new Error('newsletter status reaction requires a messageId')
    }
    if (input.parentServerId === undefined) {
        throw new Error('newsletter status reaction requires parentServerId')
    }
    const revoking = input.reaction === undefined || input.reaction === ''
    const attrs: Record<string, string> = {
        to: input.jid,
        id: input.messageId,
        server_id: toNewsletterServerId(input.parentServerId, 'parentServerId'),
        type: 'reaction'
    }
    if (revoking) {
        attrs.edit = WA_NEWSLETTER_STATUS_EDITS.REACTION_REVOKE
    }
    return {
        tag: WA_NODE_TAGS.STATUS,
        attrs,
        content: [
            {
                tag: 'reaction',
                attrs: revoking ? {} : { code: input.reaction },
                content: undefined
            }
        ]
    }
}

export function buildNewsletterStatusRevokeNode(input: {
    readonly jid: string
    readonly statusId: string
}): BinaryNode {
    assertNewsletter(input.jid)
    if (!input.statusId) {
        throw new Error('newsletter status revoke requires a statusId')
    }
    return {
        tag: WA_NODE_TAGS.STATUS,
        attrs: {
            to: input.jid,
            id: input.statusId,
            type: 'text',
            edit: WA_NEWSLETTER_STATUS_EDITS.ADMIN_REVOKE
        },
        content: [{ tag: WA_NODE_TAGS.PLAINTEXT, attrs: {}, content: undefined }]
    }
}

/** Wraps a newsletter admin profile status message for publication. */
export function buildNewsletterAdminProfileStatusMessage(message: Proto.IMessage): Proto.IMessage {
    return {
        newsletterAdminProfileStatusMessage: {
            message
        }
    }
}

export interface BuildNewsletterStatusFetchInput {
    readonly jid: string
    readonly count?: number
    readonly since?: number
    readonly before?: number | string
    readonly after?: number | string
}

/** `<status_updates>` paging query. */
export function buildNewsletterStatusUpdatesIq(input: BuildNewsletterStatusFetchInput): BinaryNode {
    assertNewsletter(input.jid)
    const attrs: Record<string, string> = { count: String(input.count ?? 20) }
    if (input.since !== undefined) attrs.since = String(input.since)
    if (input.before !== undefined) {
        attrs.before = toNewsletterServerId(input.before, 'before')
    } else if (input.after !== undefined) {
        attrs.after = toNewsletterServerId(input.after, 'after')
    }
    return buildIqNode(WA_IQ_TYPES.GET, input.jid, WA_XMLNS.NEWSLETTER, [
        { tag: 'status_updates', attrs }
    ])
}
