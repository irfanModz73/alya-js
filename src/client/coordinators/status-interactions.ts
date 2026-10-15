import { listStatuses ,type  WaStatusEntry,type  WaStatusListOptions,type  WaStatusMediaKind } from '@client/status-query'
import type { WaSendMessageOptions } from '@client/types'
import type { WaMessagePublishResult, WaSendMessageContent } from '@message/types'
import { WA_DEFAULTS } from '@protocol/defaults'
import type { WaMessageStore } from '@store/contracts/message.store'

/** Emoji the WhatsApp client uses for a status "like". */
export const WA_STATUS_LIKE_EMOJI = '❤️'

export interface WaStatusInteractions {
    /**
     * Reacts to a status by message id. Works on both contact statuses
     * (`status@broadcast`) and group statuses, as long as `chatJid` matches
     * where the status lives. Pass an empty `emoji` to remove the reaction.
     */
    readonly react: (input: WaStatusReactInput) => Promise<WaMessagePublishResult>
    /** Reacts with {@link WA_STATUS_LIKE_EMOJI}. */
    readonly like: (input: WaStatusReactInput) => Promise<WaMessagePublishResult>
    /**
     * Applies one action across every status a set of owners published. The
     * engine lists statuses from the store and reacts to each, so only
     * statuses this client observed are touched.
     */
    readonly apply: (input: WaStatusApplyInput) => Promise<WaStatusApplyResult>
    /**
     * Downloads the media of every status in a chat (a contact's statuses, or
     * a group's). Text statuses carry no media and are skipped.
     */
    readonly download: (input: WaStatusDownloadInput) => Promise<readonly WaStatusDownloaded[]>
    /**
     * Downloads every media status posted in a group. Text is skipped.
     * Convenience wrapper over {@link download} that fixes the chat to the
     * group, so the common case needs one argument.
     */
    readonly downloadGroup: (
        groupJid: string,
        options?: Omit<WaStatusDownloadInput, 'chatJid'>
    ) => Promise<readonly WaStatusDownloaded[]>
}

export interface WaStatusReactInput {
    /** Message id of the status. */
    readonly statusId: string
    /** Author of the status; required for `status@broadcast`, omit for a group status. */
    readonly owner?: string
    /** Chat the status lives in. Defaults to `status@broadcast`. */
    readonly chatJid?: string
    readonly emoji: string
    readonly options?: WaSendMessageOptions
}

export interface WaStatusApplyInput {
    /** Owners to act on. Omit for every author seen. */
    readonly targets?: readonly string[]
    readonly action: 'react' | 'like'
    /** Emoji for the `react` action. Ignored by `like`. */
    readonly emoji?: string
    readonly chats?: readonly string[]
    readonly list?: WaStatusListOptions
    readonly options?: WaSendMessageOptions
    /** Milliseconds to wait between reactions. Defaults to zero. */
    readonly intervalMs?: number
}

export interface WaStatusApplyResult {
    readonly attempted: number
    readonly reacted: number
    readonly failed: readonly { readonly statusId: string; readonly message: string }[]
}

export interface WaStatusDownloadInput {
    readonly owner?: string
    readonly chatJid: string
    readonly kinds?: readonly WaStatusMediaKind[]
    readonly limit?: number
    /** Cap per file. Defaults to the transfer client's own cap. */
    readonly maxBytes?: number
}

export interface WaStatusDownloaded {
    readonly entry: WaStatusEntry
    readonly bytes: Uint8Array
}

export interface WaStatusDependencies {
    readonly messageStore: WaMessageStore
    readonly sendMessage: (
        to: string,
        content: WaSendMessageContent,
        options?: WaSendMessageOptions
    ) => Promise<WaMessagePublishResult>
    readonly downloadBytes: (
        source: { readonly message: WaStatusEntry['message'] },
        options?: { readonly maxBytes?: number }
    ) => Promise<Uint8Array>
    readonly list?: typeof listStatuses
    readonly delay?: (ms: number) => Promise<void>
}

/** Builds the status interaction surface used by {@link WaClient.status}. */
export function createStatusInteractions(deps: WaStatusDependencies): WaStatusInteractions {
    const doList = deps.list ?? listStatuses

    const resolveChatJid = (chatJid?: string): string => chatJid ?? WA_DEFAULTS.STATUS_BROADCAST_JID

    const react = async (input: WaStatusReactInput): Promise<WaMessagePublishResult> => {
        const chatJid = resolveChatJid(input.chatJid)
        const remoteJid = chatJid
        return deps.sendMessage(
            remoteJid,
            {
                type: 'reaction',
                target: {
                    remoteJid,
                    id: input.statusId,
                    fromMe: false,
                    ...(input.owner ? { participant: input.owner } : {})
                },
                emoji: input.emoji
            },
            input.options
        )
    }

    const download = async (
        input: WaStatusDownloadInput
    ): Promise<readonly WaStatusDownloaded[]> => {
        const entries = await doList(deps.messageStore, {
            chats: [input.chatJid],
            ...(input.owner ? { owner: input.owner } : {}),
            ...(input.kinds ? { kinds: input.kinds } : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {})
        })
        const out: WaStatusDownloaded[] = []
        for (const entry of entries) {
            const bytes = await deps.downloadBytes(
                { message: entry.message },
                input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}
            )
            out.push({ entry, bytes })
        }
        return out
    }

    return {
        react,
        like: (input) => react({ ...input, emoji: WA_STATUS_LIKE_EMOJI }),
        apply: async (input) => {
            const chats =
                input.chats ??
                (input.targets && input.targets.length > 0
                    ? [WA_DEFAULTS.STATUS_BROADCAST_JID]
                    : [WA_DEFAULTS.STATUS_BROADCAST_JID])
            const all = await doList(deps.messageStore, {
                chats,
                ...input.list,
                ...(input.targets && input.targets.length > 0 ? { owner: input.targets[0] } : {})
            })
            // Multiple owners: fetch per owner so the store scan stays
            // filtered instead of pulling every author into memory.
            const entries =
                input.targets && input.targets.length > 1
                    ? (
                          await Promise.all(
                              input.targets.map((owner) =>
                                  doList(deps.messageStore, {
                                      chats,
                                      ...input.list,
                                      owner
                                  })
                              )
                          )
                      ).flat()
                    : all

            const emoji = input.action === 'like' ? WA_STATUS_LIKE_EMOJI : (input.emoji ?? '')
            const failed: { statusId: string; message: string }[] = []
            let reacted = 0
            const wait = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
            for (let index = 0; index < entries.length; index += 1) {
                const entry = entries[index]
                try {
                    await react({
                        statusId: entry.id,
                        owner: entry.ownerJid,
                        chatJid: entry.chatJid,
                        emoji,
                        ...(input.options ? { options: input.options } : {})
                    })
                    reacted += 1
                } catch (error) {
                    failed.push({
                        statusId: entry.id,
                        message: error instanceof Error ? error.message : String(error)
                    })
                }
                if (input.intervalMs && index < entries.length - 1) {
                    await wait(input.intervalMs)
                }
            }
            return { attempted: entries.length, reacted, failed }
        },
        download,
        downloadGroup: (groupJid, options) => download({ chatJid: groupJid, ...options })
    }
}
