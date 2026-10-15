import { createAdminOps, type WaNewsletterAdminOps } from '@client/newsletter/admin'
import { createDiscoveryOps, type WaNewsletterDiscoveryOps } from '@client/newsletter/discovery'
import {
    createMessagingOps,
    type WaNewsletterMessagingDeps,
    type WaNewsletterMessagingOps
} from '@client/newsletter/messaging'
import type { WaNewsletterMexDeps } from '@client/newsletter/mex'
import { createNewsletterStatusOps, type WaNewsletterStatusOps } from '@client/newsletter/status'
import type { WaSendMessageContent } from '@message/types'
import type { Proto } from '@proto'

export { parseNewsletterMetadata } from '@client/newsletter/parse'

export type {
    WaNewsletterAdminInfo,
    WaNewsletterAdminInviteInput,
    WaNewsletterAdminInviteResult,
    WaNewsletterAdminProfile,
    WaNewsletterCapabilityExposure,
    WaNewsletterCreateInput,
    WaNewsletterDehydratedMetadata,
    WaNewsletterDirectoryCategoriesPreviewOptions,
    WaNewsletterDirectoryCategoryPreview,
    WaNewsletterDirectoryListOptions,
    WaNewsletterDirectoryResults,
    WaNewsletterDirectorySearchOptions,
    WaNewsletterDirectoryView,
    WaNewsletterFetchOptions,
    WaNewsletterFollower,
    WaNewsletterFollowersOptions,
    WaNewsletterFollowersPage,
    WaNewsletterInsightMetricRequest,
    WaNewsletterMetadata,
    WaNewsletterMuteInput,
    WaNewsletterPicture,
    WaNewsletterPollVoter,
    WaNewsletterReactInput,
    WaNewsletterReactionSenders,
    WaNewsletterRecommendedOptions,
    WaNewsletterRevokeInput,
    WaNewsletterSendOptions,
    WaNewsletterSendResult,
    WaNewsletterSimilarOptions,
    WaNewsletterUpdateInput,
    WaNewsletterViewReceiptInput,
    WaNewsletterVotePollInput,
    WaPageInfo
} from '@client/newsletter/types'

/**
 * Newsletter coordinator surface – combines the discovery, admin, and
 * messaging operation sets. Accessed via {@link WaClient.newsletter}.
 */
export type WaNewsletterCoordinator = WaNewsletterDiscoveryOps &
    WaNewsletterAdminOps &
    WaNewsletterMessagingOps &
    WaNewsletterStatusOps

export type WaNewsletterCoordinatorOptions = WaNewsletterMessagingDeps & {
    /** Builds the outgoing message payload for a status publish. */
    readonly buildStatusContent?: (
        content: WaSendMessageContent
    ) => Promise<{ message: Proto.IMessage }>
    readonly waitForServerId?: (input: {
        jid: string
        messageId: string
        timeoutMs?: number
    }) => Promise<number | undefined>
}

/** Builds a {@link WaNewsletterCoordinator} from its MEX/messaging dependencies. */
export function createNewsletterCoordinator(
    options: WaNewsletterCoordinatorOptions
): WaNewsletterCoordinator {
    const mexDeps: WaNewsletterMexDeps = options
    return {
        ...createDiscoveryOps(mexDeps),
        ...createAdminOps(mexDeps),
        ...createMessagingOps(options),
        ...createNewsletterStatusOps({
            sendNode: options.sendNode,
            query: (node) => options.mexSocket.query(node),
            buildMessageContent:
                options.buildStatusContent ??
                (() => Promise.resolve({ message: { conversation: '' } })),
            generateStanzaId: options.generateStanzaId,
            ...(options.waitForServerId ? { waitForServerId: options.waitForServerId } : {})
        })
    }
}
