import { proto, type Proto } from '@proto'
import { tryAsString } from '@util/coercion'
import { longToNumber } from '@util/primitives'

/** Mirrors `WAProto.CallLogRecord.CallResult`. */
export const WA_CALL_LOG_RESULTS = Object.freeze({
    CONNECTED: 'CONNECTED',
    REJECTED: 'REJECTED',
    CANCELLED: 'CANCELLED',
    ACCEPTED_ELSEWHERE: 'ACCEPTEDELSEWHERE',
    MISSED: 'MISSED',
    INVALID: 'INVALID',
    UNAVAILABLE: 'UNAVAILABLE',
    UPCOMING: 'UPCOMING',
    FAILED: 'FAILED',
    ABANDONED: 'ABANDONED',
    ONGOING: 'ONGOING'
} as const)

export type WaCallLogResult = (typeof WA_CALL_LOG_RESULTS)[keyof typeof WA_CALL_LOG_RESULTS]

/** Mirrors `WAProto.CallLogRecord.CallType`. */
export const WA_CALL_LOG_TYPES = Object.freeze({
    REGULAR: 'REGULAR',
    SCHEDULED_CALL: 'SCHEDULED_CALL',
    VOICE_CHAT: 'VOICE_CHAT'
} as const)

export type WaCallLogType = (typeof WA_CALL_LOG_TYPES)[keyof typeof WA_CALL_LOG_TYPES]

const CALL_RESULT_BY_ORDINAL = Object.freeze({
    0: WA_CALL_LOG_RESULTS.CONNECTED,
    1: WA_CALL_LOG_RESULTS.REJECTED,
    2: WA_CALL_LOG_RESULTS.CANCELLED,
    3: WA_CALL_LOG_RESULTS.ACCEPTED_ELSEWHERE,
    4: WA_CALL_LOG_RESULTS.MISSED,
    5: WA_CALL_LOG_RESULTS.INVALID,
    6: WA_CALL_LOG_RESULTS.UNAVAILABLE,
    7: WA_CALL_LOG_RESULTS.UPCOMING,
    8: WA_CALL_LOG_RESULTS.FAILED,
    9: WA_CALL_LOG_RESULTS.ABANDONED,
    10: WA_CALL_LOG_RESULTS.ONGOING
} as const)

const CALL_TYPE_BY_ORDINAL = Object.freeze({
    0: WA_CALL_LOG_TYPES.REGULAR,
    1: WA_CALL_LOG_TYPES.SCHEDULED_CALL,
    2: WA_CALL_LOG_TYPES.VOICE_CHAT
} as const)

function resolveCallResult(value: unknown): WaCallLogResult | undefined {
    if (typeof value !== 'number') return undefined
    return CALL_RESULT_BY_ORDINAL[value as keyof typeof CALL_RESULT_BY_ORDINAL]
}

function resolveCallType(value: unknown): WaCallLogType {
    if (typeof value !== 'number') return WA_CALL_LOG_TYPES.REGULAR
    return (
        CALL_TYPE_BY_ORDINAL[value as keyof typeof CALL_TYPE_BY_ORDINAL] ??
        WA_CALL_LOG_TYPES.REGULAR
    )
}

export interface WaCallLogParticipant {
    readonly jid: string
    readonly callResult?: WaCallLogResult
}

export interface WaCallLogRecord {
    readonly callId: string
    readonly creatorJid?: string
    readonly groupJid?: string
    /** Unix seconds. */
    readonly startTime?: number
    /** Seconds the call lasted. */
    readonly duration?: number
    readonly result?: WaCallLogResult
    readonly callType: WaCallLogType
    readonly isIncoming: boolean
    readonly isVideo: boolean
    readonly isCallLink: boolean
    readonly isDndMode: boolean
    readonly scheduledCallId?: string
    readonly participants: readonly WaCallLogParticipant[]
}

/**
 * Proto `int64` fields decode to a `Long` object, so the coercion helpers in
 * `@util/coercion` return `null` for them. The call timestamps and durations
 * never approach 2^53, so a plain conversion is safe.
 */
function resolveLong(value: unknown): number | null {
    if (value === undefined || value === null) return null
    const converted = longToNumber(value as Parameters<typeof longToNumber>[0])
    return Number.isFinite(converted) ? converted : null
}

/**
 * Parses a single `CallLogRecord` out of an app-state `callLogAction` patch
 * (schema `CallLog`, value field `callLogAction`).
 *
 * Parse-only. The record fields are fixed by the vendored proto; which
 * notification delivers the patch still needs a real-flow test.
 */
export function parseCallLogRecord(
    record: Proto.ICallLogRecord | null | undefined
): WaCallLogRecord | null {
    if (!record) return null
    const callId = tryAsString(record.callId)
    if (!callId) return null

    const participants = record.participants ?? []
    const parsedParticipants: WaCallLogParticipant[] = new Array(participants.length)
    let participantCount = 0
    for (let index = 0; index < participants.length; index += 1) {
        const participant = participants[index]
        const jid = tryAsString(participant?.userJid)
        if (!jid) continue
        const result = resolveCallResult(participant?.callResult)
        parsedParticipants[participantCount] = {
            jid,
            ...(result !== undefined ? { callResult: result } : {})
        }
        participantCount += 1
    }
    parsedParticipants.length = participantCount

    const creatorJid = tryAsString(record.callCreatorJid)
    const groupJid = tryAsString(record.groupJid)
    const scheduledCallId = tryAsString(record.scheduledCallId)
    const startTime = resolveLong(record.startTime)
    const duration = resolveLong(record.duration)
    const result = resolveCallResult(record.callResult)

    return {
        callId,
        ...(creatorJid ? { creatorJid } : {}),
        ...(groupJid ? { groupJid } : {}),
        ...(startTime !== null ? { startTime } : {}),
        ...(duration !== null ? { duration } : {}),
        ...(result !== undefined ? { result } : {}),
        callType: resolveCallType(record.callType),
        isIncoming: record.isIncoming === true,
        isVideo: record.isVideo === true,
        isCallLink: record.isCallLink === true,
        isDndMode: record.isDndMode === true,
        ...(scheduledCallId ? { scheduledCallId } : {}),
        participants: parsedParticipants
    }
}

export { proto }
