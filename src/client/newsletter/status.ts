import {
    parseNewsletterStatusUpdatesResponse,
    type WaNewsletterStatus,
    type WaNewsletterStatusAck,
    type WaNewsletterStatusesPage
} from '@client/events/newsletter-status'
import type { WaSendMessageContent } from '@message/types'
import { proto } from '@proto'
import {
    buildNewsletterStatusNode,
    buildNewsletterStatusReactionNode,
    buildNewsletterStatusRevokeNode,
    buildNewsletterStatusUpdatesIq,
    toNewsletterServerId,
    type WaNewsletterStatusInteraction,
    type WaNewsletterStatusMediaType,
    withNewsletterStatusAttribution
} from '@transport/node/builders/newsletter-status'
import { assertIqResult } from '@transport/node/query'
import type { BinaryNode } from '@transport/types'

/**
 * Newsletter channel status surface - the `<status>` stanza family, distinct
 * from an ordinary newsletter post (`<message>`).
 */
export interface WaNewsletterStatusOps {
    /**
     * Publishes a status to a newsletter channel. Text, image, video, gif and
     * audio are supported; a document or sticker status is rejected because
     * the channel surface does not accept one.
     *
     * A reaction or revoke on that status needs the server id, which only
     * arrives on the `<status>` echo after the publish ack. Pass
     * `resolveServerId` to wait for it and get it back in the result.
     */
    readonly sendStatus: (
        input: WaNewsletterSendStatusInput
    ) => Promise<WaNewsletterSendStatusResult>
    /** Reacts to one of the account's own channel statuses. */
    readonly reactToStatus: (input: WaNewsletterStatusReactInput) => Promise<BinaryNode>
    /** Admin-revokes one of the account's own channel statuses. */
    readonly revokeStatus: (input: {
        readonly jid: string
        readonly statusId: string
    }) => Promise<BinaryNode>
    /** Lists the channel's statuses. */
    readonly fetchStatuses: (input: {
        readonly jid: string
        readonly count?: number
        readonly since?: number
        readonly before?: number | string
        readonly after?: number | string
    }) => Promise<WaNewsletterStatusesPage>
}

export interface WaNewsletterSendStatusInput {
    readonly jid: string
    readonly content: WaSendMessageContent
    /** Present for a media status; must match what the upload produced. */
    readonly mediaType?: WaNewsletterStatusMediaType
    /** Handle returned by the newsletter upload. */
    readonly mediaHandle?: string | number
    readonly interactionType?: WaNewsletterStatusInteraction
    readonly parentServerId?: number | string
    readonly responseServerId?: number | string
    readonly aiContent?: boolean
    readonly messageId?: string
    /** Waits for the `<status>` echo that carries `serverId`. */
    readonly resolveServerId?: boolean
    readonly serverIdTimeoutMs?: number
    /** Skips the newsletter-status context attribution. */
    readonly statusAttribution?: boolean
}

export interface WaNewsletterSendStatusResult {
    readonly id: string
    readonly serverId?: number
    readonly ack: WaNewsletterStatusAck
    readonly payload: Uint8Array
}

export interface WaNewsletterStatusReactInput {
    readonly jid: string
    readonly messageId: string
    readonly parentServerId: number | string
    /** Emoji code; omit to clear the reaction. */
    readonly reaction?: string
}

export interface WaNewsletterStatusDeps {
    readonly sendNode: (node: BinaryNode) => Promise<void>
    readonly query: (node: BinaryNode) => Promise<BinaryNode>
    readonly buildMessageContent: (
        content: WaSendMessageContent
    ) => Promise<{ message: proto.IMessage }>
    readonly generateStanzaId: () => Promise<string>
    /** Resolves the server id from a `<status>` echo; omit to skip the wait. */
    readonly waitForServerId?: (input: {
        jid: string
        messageId: string
        timeoutMs?: number
    }) => Promise<number | undefined>
    /** Wait strategy; defaults to a plain timer. */
    readonly delay?: (ms: number) => Promise<void>
}

const WA_NEWSLETTER_STATUS_SERVER_ID_TIMEOUT_MS = 8_000

/** Builds the newsletter status operations. */
export function createNewsletterStatusOps(deps: WaNewsletterStatusDeps): WaNewsletterStatusOps {
    return {
        sendStatus: async (input) => {
            const built = await deps.buildMessageContent(input.content)
            const message =
                input.statusAttribution === false
                    ? built.message
                    : withNewsletterStatusAttribution(built.message)
            const messageId = input.messageId ?? (await deps.generateStanzaId())
            const payload = proto.Message.encode(message).finish()

            const node = buildNewsletterStatusNode({
                jid: input.jid,
                messageId,
                plaintext: payload,
                ...(input.mediaType ? { mediaType: input.mediaType } : {}),
                ...(input.mediaHandle !== undefined ? { mediaHandle: input.mediaHandle } : {}),
                ...(input.interactionType ? { interactionType: input.interactionType } : {}),
                ...(input.parentServerId !== undefined
                    ? { parentServerId: input.parentServerId }
                    : {}),
                ...(input.responseServerId !== undefined
                    ? { responseServerId: input.responseServerId }
                    : {}),
                ...(input.aiContent ? { aiContent: input.aiContent } : {})
            })

            await deps.sendNode(node)
            // The publish ack carries only class/id/t. The server id the
            // reaction path needs arrives on a separate stanza, so a caller
            // that asked for it waits for that echo here.
            const serverId =
                input.resolveServerId && deps.waitForServerId
                    ? await deps.waitForServerId({
                          jid: input.jid,
                          messageId,
                          timeoutMs:
                              input.serverIdTimeoutMs ?? WA_NEWSLETTER_STATUS_SERVER_ID_TIMEOUT_MS
                      })
                    : undefined
            return {
                id: messageId,
                ...(serverId !== undefined ? { serverId } : {}),
                ack: {
                    class: 'status',
                    from: input.jid,
                    id: messageId,
                    node
                },
                payload
            }
        },

        reactToStatus: async (input) => {
            const node = buildNewsletterStatusReactionNode({
                jid: input.jid,
                messageId: input.messageId,
                parentServerId: toNewsletterServerId(input.parentServerId, 'parentServerId'),
                ...(input.reaction !== undefined ? { reaction: input.reaction } : {})
            })
            await deps.sendNode(node)
            return node
        },

        revokeStatus: async (input) => {
            const node = buildNewsletterStatusRevokeNode({
                jid: input.jid,
                statusId: input.statusId
            })
            await deps.sendNode(node)
            return node
        },

        fetchStatuses: async (input) => {
            const node = buildNewsletterStatusUpdatesIq(input)
            const result = await deps.query(node)
            assertIqResult(result, 'newsletter.fetchStatuses')
            return parseNewsletterStatusUpdatesResponse(result)
        }
    }
}

export type { WaNewsletterStatus }
