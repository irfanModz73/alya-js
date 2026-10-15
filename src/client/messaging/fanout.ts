import type { WaAuthCredentials } from '@auth/types'
import type { Logger } from '@infra/log/types'
import { PromiseDedup } from '@infra/perf/PromiseDedup'
import { normalizeDeviceJid, splitJid, toUserJid } from '@protocol/jid'
import type { SignalDeviceSyncApi } from '@signal/api/SignalDeviceSyncApi'
import { toError } from '@util/primitives'

export type DeviceFanoutResolver = {
    /**
     * Device JIDs an outgoing direct message is encrypted to. With
     * `noSelfSync`, none of this account's own devices are included, so the
     * message is delivered to the recipient without landing in the paired
     * phones' own chat.
     */
    resolveDirectFanoutDeviceJids(
        recipientJid: string,
        selfDeviceJid: string,
        noSelfSync?: boolean
    ): Promise<readonly string[]>

    /**
     * Device JIDs an outgoing group message is encrypted to. Always drops the
     * account's base JIDs; `noSelfSync` additionally drops its secondary
     * devices, which the participant scan would otherwise carry through.
     */
    resolveGroupParticipantDeviceJids(
        participantUserJids: readonly string[],
        noSelfSync?: boolean
    ): Promise<readonly string[]>

    resolveOwnPeerDeviceJids(): Promise<readonly string[]>

    resolveSelfDeviceJidForRecipient(
        recipientJid: string,
        meJid: string,
        meLid: string | null | undefined
    ): string
}

export function createDeviceFanoutResolver(options: {
    readonly signalDeviceSync: SignalDeviceSyncApi
    readonly getCurrentCredentials: () => WaAuthCredentials | null
    readonly logger: Logger
}): DeviceFanoutResolver {
    const { signalDeviceSync, getCurrentCredentials, logger } = options
    const dedup = new PromiseDedup()

    const resolveDirectFanoutDeviceJids = async (
        recipientJid: string,
        selfDeviceJidForRecipient: string,
        noSelfSync?: boolean
    ): Promise<readonly string[]> => {
        const recipientUserJid = toUserJid(recipientJid)
        const meUserJid = toUserJid(selfDeviceJidForRecipient)
        const targets =
            recipientUserJid === meUserJid ? [recipientUserJid] : [recipientUserJid, meUserJid]

        try {
            const synced = await signalDeviceSync.syncDeviceList(targets)
            const byUser = new Map<string, readonly string[]>()
            for (let index = 0; index < synced.length; index += 1) {
                const entry = synced[index]
                byUser.set(toUserJid(entry.jid), entry.deviceJids)
            }

            const fanout = new Set<string>()
            const recipientDevices = byUser.get(recipientUserJid) ?? []
            if (recipientDevices.length === 0) {
                fanout.add(recipientUserJid)
            } else {
                for (let index = 0; index < recipientDevices.length; index += 1) {
                    fanout.add(recipientDevices[index])
                }
            }

            // Without this the account's own devices join the fanout, and every
            // outgoing bot message shows up on the paired phones as a chat the
            // user never started. Dropping them here is enough: the stanza is
            // still acked for the recipient, this device only stops mirroring.
            if (!noSelfSync) {
                const meDevices = byUser.get(meUserJid) ?? []
                const normalizedMeJid = normalizeDeviceJid(selfDeviceJidForRecipient)
                for (let index = 0; index < meDevices.length; index += 1) {
                    const deviceJid = meDevices[index]
                    if (normalizeDeviceJid(deviceJid) === normalizedMeJid) {
                        continue
                    }
                    fanout.add(deviceJid)
                }
            }

            return [...fanout]
        } catch (error) {
            logger.debug('signal device fanout sync failed, falling back to direct recipient', {
                to: recipientJid,
                message: toError(error).message
            })
            return [recipientUserJid]
        }
    }

    /**
     * Every device JID this account owns, in both addressing forms. Used by
     * the `noSelfSync` group path, where the participant scan only learns the
     * account's base JID.
     */
    const resolveOwnDeviceJids = async (
        meJid: string,
        meLid: string | null | undefined
    ): Promise<readonly string[]> => {
        const ownUserJids = new Set<string>()
        ownUserJids.add(toUserJid(meJid))
        if (meLid && meLid.includes('@')) {
            ownUserJids.add(toUserJid(meLid))
        }
        const deviceJids = new Set<string>()
        try {
            const synced = await signalDeviceSync.syncDeviceList([...ownUserJids])
            for (const entry of synced) {
                for (const deviceJid of entry.deviceJids) {
                    try {
                        deviceJids.add(normalizeDeviceJid(deviceJid))
                    } catch (error) {
                        logger.trace('ignoring malformed own device jid', {
                            deviceJid,
                            message: toError(error).message
                        })
                    }
                }
            }
        } catch (error) {
            logger.debug('own device sync failed, noSelfSync group fanout keeps base jid only', {
                message: toError(error).message
            })
            return []
        }
        return [...deviceJids]
    }

    const resolveGroupParticipantDeviceJidsInternal = async (
        participantUserJids: readonly string[],
        noSelfSync?: boolean
    ): Promise<readonly string[]> => {
        const meDeviceJids = new Set<string>()
        const credentials = getCurrentCredentials()
        const meJid = credentials?.meJid
        if (meJid) {
            try {
                meDeviceJids.add(normalizeDeviceJid(meJid))
            } catch (error) {
                logger.trace('ignoring malformed me jid', {
                    meJid,
                    message: toError(error).message
                })
            }
        }

        const meLid = credentials?.meLid
        if (meLid && meLid.includes('@')) {
            try {
                meDeviceJids.add(normalizeDeviceJid(meLid))
            } catch (error) {
                logger.trace('ignoring malformed me lid jid', {
                    meLid,
                    message: toError(error).message
                })
            }
        }

        // The two entries above are the account's base JIDs only, so the
        // secondary devices (`111:1@...`) survive the membership check below.
        // A `noSelfSync` send has to drop those too, otherwise the paired
        // phones still receive the message inside the group.
        if (noSelfSync && meJid) {
            const ownDevices = await resolveOwnDeviceJids(meJid, meLid)
            for (const deviceJid of ownDevices) {
                meDeviceJids.add(deviceJid)
            }
        }

        const candidateUserSet = new Set<string>()
        for (let index = 0; index < participantUserJids.length; index += 1) {
            candidateUserSet.add(participantUserJids[index])
        }
        const candidateUsers = Array.from(candidateUserSet)
        if (candidateUsers.length === 0) {
            return []
        }

        try {
            const synced = await signalDeviceSync.syncDeviceList(candidateUsers)
            const fanout = new Set<string>()
            for (const entry of synced) {
                if (entry.deviceJids.length === 0) {
                    const normalizedEntryJid = normalizeDeviceJid(entry.jid)
                    if (meDeviceJids.has(normalizedEntryJid)) {
                        continue
                    }
                    fanout.add(normalizedEntryJid)
                    continue
                }

                for (const deviceJid of entry.deviceJids) {
                    const normalizedDeviceJid = normalizeDeviceJid(deviceJid)
                    if (meDeviceJids.has(normalizedDeviceJid)) {
                        continue
                    }
                    fanout.add(normalizedDeviceJid)
                }
            }
            return [...fanout]
        } catch (error) {
            logger.debug(
                'group participant device sync failed, falling back to participant user jids',
                {
                    participants: candidateUsers.length,
                    message: toError(error).message
                }
            )
            const fallbackJids = new Set<string>()
            for (const candidateJid of candidateUsers) {
                try {
                    const normalizedCandidateJid = normalizeDeviceJid(candidateJid)
                    if (meDeviceJids.has(normalizedCandidateJid)) {
                        continue
                    }
                    fallbackJids.add(normalizedCandidateJid)
                } catch (fallbackError) {
                    logger.trace(
                        'ignoring malformed participant jid in fallback fanout resolution',
                        {
                            participantJid: candidateJid,
                            message: toError(fallbackError).message
                        }
                    )
                }
            }
            return [...fallbackJids]
        }
    }

    const resolveOwnPeerDeviceJids = async (): Promise<readonly string[]> => {
        const credentials = getCurrentCredentials()
        const meJid = credentials?.meJid
        if (!meJid) {
            throw new Error('resolveOwnPeerDeviceJids requires registered meJid')
        }
        const meUserJid = toUserJid(meJid)
        const meDevices = new Set<string>()
        meDevices.add(normalizeDeviceJid(meJid))

        const meLid = credentials?.meLid
        if (meLid && meLid.includes('@')) {
            try {
                meDevices.add(normalizeDeviceJid(meLid))
            } catch (error) {
                logger.trace('ignoring malformed me lid jid while resolving peer devices', {
                    meLid,
                    message: toError(error).message
                })
            }
        }

        try {
            const synced = await signalDeviceSync.syncDeviceList([meUserJid])
            const peerDevices = new Set<string>()
            for (const entry of synced) {
                const sourceDevices = entry.deviceJids.length > 0 ? entry.deviceJids : [entry.jid]
                for (const deviceJid of sourceDevices) {
                    try {
                        const normalized = normalizeDeviceJid(deviceJid)
                        if (meDevices.has(normalized)) {
                            continue
                        }
                        peerDevices.add(normalized)
                    } catch (error) {
                        logger.trace(
                            'ignoring malformed peer device jid while resolving app-state peers',
                            {
                                deviceJid,
                                message: toError(error).message
                            }
                        )
                    }
                }
            }
            return [...peerDevices]
        } catch (error) {
            logger.warn('failed to resolve peer devices for app-state key request', {
                message: toError(error).message
            })
            return []
        }
    }

    const resolveSelfDeviceJidForRecipient = (
        recipientJid: string,
        meJid: string,
        meLid: string | null | undefined
    ): string => {
        if (splitJid(recipientJid).server !== 'lid') {
            return meJid
        }
        if (!meLid || !meLid.includes('@')) {
            return meJid
        }
        return meLid
    }

    const resolveGroupParticipantDeviceJids = (
        participantUserJids: readonly string[],
        noSelfSync?: boolean
    ): Promise<readonly string[]> =>
        // The flag is part of the key: a noSelfSync resolution must never join
        // an in-flight full fanout, or the send would leak to own devices.
        dedup.run(`group:${noSelfSync ? 'noself' : 'all'}:${participantUserJids.join(',')}`, () =>
            resolveGroupParticipantDeviceJidsInternal(participantUserJids, noSelfSync)
        )

    return {
        resolveDirectFanoutDeviceJids,
        resolveGroupParticipantDeviceJids,
        resolveOwnPeerDeviceJids,
        resolveSelfDeviceJidForRecipient
    }
}
