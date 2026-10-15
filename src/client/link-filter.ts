import type { WaIncomingMessageEvent } from '@client/types'
import { WA_GROUP_PARTICIPANT_TYPES } from '@protocol/group'
import { isGroupJid } from '@protocol/jid'

export interface WaLinkMatch {
    readonly kind: WaLinkKind
    readonly url: string
}

export const WA_LINK_KINDS = Object.freeze({
    TIKTOK: 'tiktok',
    INSTAGRAM: 'instagram',
    FACEBOOK: 'facebook',
    WHATSAPP_CHANNEL: 'whatsapp_channel',
    WHATSAPP_GROUP_INVITE: 'whatsapp_group_invite',
    TELEGRAM: 'telegram',
    GENERIC: 'generic'
} as const)

export type WaLinkKind = (typeof WA_LINK_KINDS)[keyof typeof WA_LINK_KINDS]

/**
 * Link shapes the filter treats as promotional or off-platform. Order matters
 * only in that the first match wins, so the specific hosts come before the
 * generic http fallback.
 */
const WA_LINK_PATTERNS: readonly (readonly [RegExp, WaLinkKind])[] = Object.freeze([
    [/\b(?:https?:\/\/)?(?:www\.)?(?:vm|vt)\.tiktok\.com(?:\/[^\s]*)?/iu, WA_LINK_KINDS.TIKTOK],
    [/\b(?:https?:\/\/)?(?:www\.)?tiktok\.com(?:\/[^\s]*)?/iu, WA_LINK_KINDS.TIKTOK],
    [/\b(?:https?:\/\/)?(?:www\.)?instagram\.com(?:\/[^\s]*)?/iu, WA_LINK_KINDS.INSTAGRAM],
    [/\b(?:https?:\/\/)?(?:www\.)?fb\.com(?:\/[^\s]*)?/iu, WA_LINK_KINDS.FACEBOOK],
    [/\b(?:https?:\/\/)?(?:www\.)?facebook\.com(?:\/[^\s]*)?/iu, WA_LINK_KINDS.FACEBOOK],
    [
        /\b(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/[A-Za-z0-9]+/iu,
        WA_LINK_KINDS.WHATSAPP_GROUP_INVITE
    ],
    [/\bwhatsapp:\/\/(?:channel\/)?\/?[A-Za-z0-9]+/iu, WA_LINK_KINDS.WHATSAPP_CHANNEL],
    [/\b(?:https?:\/\/)?(?:www\.)?t\.me(?:\/[^\s]*)?/iu, WA_LINK_KINDS.TELEGRAM],
    [/\bhttps?:\/\/[^\s]+/iu, WA_LINK_KINDS.GENERIC]
] as const)

/** Extracts the first link in `text` and classifies it. */
export function findFirstLink(text: string): WaLinkMatch | null {
    for (const [pattern, kind] of WA_LINK_PATTERNS) {
        const match = pattern.exec(text)
        if (match) {
            return { kind, url: match[0] }
        }
    }
    return null
}

/** Pulls the display text out of any message content shape. */
export function getMessageText(message: unknown): string {
    if (!message || typeof message !== 'object') return ''
    const m = message as Record<string, unknown>
    const inner = (m.documentWithCaptionMessage as Record<string, unknown> | undefined)?.message
    const target = (inner ?? m) as Record<string, unknown>
    const candidates = [
        target.conversation,
        (target.extendedTextMessage as Record<string, unknown> | undefined)?.text,
        (target.imageMessage as Record<string, unknown> | undefined)?.caption,
        (target.videoMessage as Record<string, unknown> | undefined)?.caption,
        (target.documentMessage as Record<string, unknown> | undefined)?.caption
    ]
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0) return candidate
    }
    return ''
}

export interface WaLinkFilterOptions {
    /** Decides whether a sender may post links. Defaults to admins and super-admins. */
    readonly isAllowedSender: (groupJid: string, senderJid: string) => Promise<boolean>
    /** Removes the offending message. Defaults to a no-op returning `false`. */
    readonly deleteMessage?: (chatJid: string, id: string, participant?: string) => Promise<boolean>
    readonly logger?: { readonly debug: (m: string, c?: unknown) => void }
    /** Restrict the filter to these link kinds. Omit for every matched kind. */
    readonly kinds?: readonly WaLinkKind[]
}

export interface WaLinkFilterResult {
    readonly matched: boolean
    readonly kind?: WaLinkKind
    readonly url?: string
    readonly action: 'ignored' | 'allowed' | 'deleted' | 'delete_failed'
}

/**
 * Decides what to do with an incoming group message that carries a link.
 *
 * Pure with respect to I/O: the only side effects are through the injected
 * `isAllowedSender` / `deleteMessage` ports, so the decision is testable
 * without a connection.
 */
export async function evaluateGroupLink(
    event: WaIncomingMessageEvent,
    options: WaLinkFilterOptions
): Promise<WaLinkFilterResult> {
    const key = event.key
    if (!key?.isGroup || !key.remoteJid) {
        return { matched: false, action: 'ignored' }
    }
    if (key.fromMe) {
        return { matched: false, action: 'ignored' }
    }

    const text = getMessageText(event.message)
    if (!text) {
        return { matched: false, action: 'ignored' }
    }
    const link = findFirstLink(text)
    if (!link) {
        return { matched: false, action: 'ignored' }
    }
    if (options.kinds && options.kinds.length > 0 && !options.kinds.includes(link.kind)) {
        return { matched: false, action: 'ignored' }
    }

    const senderJid = key.participant
    if (!senderJid) {
        return { matched: true, kind: link.kind, url: link.url, action: 'ignored' }
    }

    if (await options.isAllowedSender(key.remoteJid, senderJid)) {
        return { matched: true, kind: link.kind, url: link.url, action: 'allowed' }
    }

    if (!options.deleteMessage) {
        return { matched: true, kind: link.kind, url: link.url, action: 'delete_failed' }
    }

    try {
        const deleted = await options.deleteMessage(key.remoteJid, key.id, senderJid)
        return {
            matched: true,
            kind: link.kind,
            url: link.url,
            action: deleted ? 'deleted' : 'delete_failed'
        }
    } catch (error) {
        options.logger?.debug('antiLink delete failed', {
            groupJid: key.remoteJid,
            id: key.id,
            error: error instanceof Error ? error.message : String(error)
        })
        return { matched: true, kind: link.kind, url: link.url, action: 'delete_failed' }
    }
}

/**
 * Builds an `isAllowedSender` from a group-metadata lookup: admins, super
 * admins, and the group owner pass.
 */
export function createAdminAllowList(
    loadMetadata: (groupJid: string) => Promise<{
        readonly owner?: string
        readonly participants: readonly { readonly jid: string; readonly type: string }[]
    } | null>,
    allowOwners = true
): (groupJid: string, senderJid: string) => Promise<boolean> {
    return async (groupJid, senderJid) => {
        const metadata = await loadMetadata(groupJid)
        if (!metadata) return false
        if (allowOwners && metadata.owner && metadata.owner === senderJid) {
            return true
        }
        const participant = metadata.participants.find((p) => p.jid === senderJid)
        if (!participant) return false
        return (
            participant.type === WA_GROUP_PARTICIPANT_TYPES.ADMIN ||
            participant.type === WA_GROUP_PARTICIPANT_TYPES.SUPERADMIN
        )
    }
}

export { isGroupJid }
