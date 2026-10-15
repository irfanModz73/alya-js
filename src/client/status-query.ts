import type { Proto } from '@proto'
import { WA_DEFAULTS } from '@protocol/defaults'
import type { WaMessageStore, WaStoredMessageRecord } from '@store/contracts/message.store'
import { proto as protoNs } from '@proto'

/** Status media kinds a caller can ask for. Text is deliberately excluded. */
export const WA_STATUS_MEDIA_KINDS = Object.freeze({
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    DOCUMENT: 'document',
    STICKER: 'sticker'
} as const)

export type WaStatusMediaKind = (typeof WA_STATUS_MEDIA_KINDS)[keyof typeof WA_STATUS_MEDIA_KINDS]

export interface WaStatusEntry {
    readonly id: string
    /** Author of the status: the owner for `status@broadcast`, the group for a group status. */
    readonly ownerJid: string
    /** Chat the status lives in: `status@broadcast`, or the group JID. */
    readonly chatJid: string
    readonly fromMe: boolean
    readonly timestampMs?: number
    readonly mediaKind: WaStatusMediaKind
    readonly mimetype?: string
    readonly caption?: string
    readonly message: Proto.IMessage
}

export interface WaStatusListOptions {
    /** Owner to filter by. Omit to list every author seen so far. */
    readonly owner?: string
    /** Only entries newer than this timestamp (ms). */
    readonly since?: number
    /** Restrict to these media kinds. Omit for every kind. */
    readonly kinds?: readonly WaStatusMediaKind[]
    /** Caps the scan. Defaults to the store page size. */
    readonly limit?: number
}

/**
 * Classifies a stored message into a status media kind, or `null` when it
 * carries no media (text status, poll, protocol message, reaction).
 */
export function classifyStatusMedia(
    message: Proto.IMessage | null | undefined
): WaStatusMediaKind | null {
    if (!message) return null
    const inner = message.documentWithCaptionMessage?.message ?? message
    if (inner.imageMessage) return WA_STATUS_MEDIA_KINDS.IMAGE
    if (inner.videoMessage) return WA_STATUS_MEDIA_KINDS.VIDEO
    if (inner.audioMessage) return WA_STATUS_MEDIA_KINDS.AUDIO
    if (inner.stickerMessage) return WA_STATUS_MEDIA_KINDS.STICKER
    if (inner.documentMessage) return WA_STATUS_MEDIA_KINDS.DOCUMENT
    return null
}

function toEntry(record: WaStoredMessageRecord, message: Proto.IMessage): WaStatusEntry | null {
    const mediaKind = classifyStatusMedia(message)
    if (!mediaKind) return null
    const inner = message.documentWithCaptionMessage?.message ?? message
    const media =
        inner.imageMessage ??
        inner.videoMessage ??
        inner.audioMessage ??
        inner.stickerMessage ??
        inner.documentMessage
    const caption = inner.conversation ?? media?.caption ?? undefined
    return {
        id: record.id,
        ownerJid: record.participantJid ?? record.senderJid ?? record.threadJid,
        chatJid: record.threadJid,
        fromMe: record.fromMe,
        ...(record.timestampMs !== undefined ? { timestampMs: record.timestampMs } : {}),
        mediaKind,
        ...(media?.mimetype ? { mimetype: media.mimetype } : {}),
        ...(caption ? { caption } : {}),
        message
    }
}

/**
 * Lists statuses from the message store.
 *
 * Statuses are not stored in a dedicated table: contact statuses land in the
 * `status@broadcast` thread with the owner on `participantJid`, and group
 * statuses land in the group thread. Both are therefore a thread scan, so
 * `listByThread` is called once per target chat and filtered in memory.
 *
 * Only statuses this client actually observed are returned. Anything missed
 * while disconnected was never persisted and cannot be recovered here.
 */
export async function listStatuses(
    messageStore: WaMessageStore,
    options: WaStatusListOptions & { readonly chats: readonly string[] }
): Promise<readonly WaStatusEntry[]> {
    const entries: WaStatusEntry[] = []
    const seen = new Set<string>()
    for (const chatJid of options.chats) {
        const records = await messageStore.listByThread(chatJid, options.limit)
        for (const record of records) {
            if (seen.has(record.id)) continue
            if (options.since !== undefined) {
                const ts = record.timestampMs
                if (ts !== undefined && ts < options.since) continue
            }
            const bytes = record.messageBytes
            if (!bytes || bytes.length === 0) continue
            let message: Proto.IMessage
            try {
                message = protoNs.Message.decode(bytes)
            } catch {
                continue
            }
            const entry = toEntry(record, message)
            if (!entry) continue
            seen.add(record.id)
            entries.push(entry)
        }
    }
    if (options.owner) {
        const owner = options.owner
        return entries.filter((entry) => entry.ownerJid === owner)
    }
    if (options.kinds && options.kinds.length > 0) {
        const kinds = new Set(options.kinds)
        return entries.filter((entry) => kinds.has(entry.mediaKind))
    }
    return entries
}

export function statusBroadcastJid(): string {
    return WA_DEFAULTS.STATUS_BROADCAST_JID
}
