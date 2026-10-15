import assert from 'node:assert/strict'
import test from 'node:test'

import {
    parseCallLogRecord,
    WA_CALL_LOG_RESULTS,
    WA_CALL_LOG_TYPES
} from '@client/events/call-log'
import { proto } from '@proto'

function roundTrip(input: Parameters<typeof proto.CallLogRecord.encode>[0]) {
    return proto.CallLogRecord.decode(proto.CallLogRecord.encode(input).finish())
}

test('call log record survives a proto round trip', () => {
    const record = parseCallLogRecord(
        roundTrip({
            callId: 'CALL1',
            callCreatorJid: '62811@s.whatsapp.net',
            groupJid: 'group@g.us',
            startTime: 1_700_000_000,
            duration: 42,
            callResult: proto.CallLogRecord.CallResult.MISSED,
            isIncoming: true,
            isVideo: true,
            isCallLink: true,
            callType: proto.CallLogRecord.CallType.VOICE_CHAT,
            participants: [
                { userJid: '62811@s.whatsapp.net', callResult: proto.CallLogRecord.CallResult.MISSED },
                { userJid: '62822@s.whatsapp.net', callResult: proto.CallLogRecord.CallResult.CONNECTED }
            ]
        })
    )

    assert.deepEqual(record, {
        callId: 'CALL1',
        creatorJid: '62811@s.whatsapp.net',
        groupJid: 'group@g.us',
        startTime: 1_700_000_000,
        duration: 42,
        result: WA_CALL_LOG_RESULTS.MISSED,
        callType: WA_CALL_LOG_TYPES.VOICE_CHAT,
        isIncoming: true,
        isVideo: true,
        isCallLink: true,
        isDndMode: false,
        participants: [
            { jid: '62811@s.whatsapp.net', callResult: WA_CALL_LOG_RESULTS.MISSED },
            { jid: '62822@s.whatsapp.net', callResult: WA_CALL_LOG_RESULTS.CONNECTED }
        ]
    })
})

test('int64 fields decode to numbers, not Long objects', () => {
    const record = parseCallLogRecord(roundTrip({ callId: 'C', startTime: 5, duration: 7 }))

    assert.equal(typeof record?.startTime, 'number')
    assert.equal(typeof record?.duration, 'number')
    assert.equal(record?.startTime, 5)
    assert.equal(record?.duration, 7)
})

test('a record without a call id is rejected', () => {
    assert.equal(parseCallLogRecord(null), null)
    assert.equal(parseCallLogRecord({}), null)
    assert.equal(parseCallLogRecord(roundTrip({ startTime: 1 })), null)
})

test('unknown result ordinals drop the field instead of leaking a number', () => {
    const record = parseCallLogRecord(roundTrip({ callId: 'C', callResult: 99 }))

    assert.equal(record?.callId, 'C')
    assert.equal(record?.result, undefined)
    assert.equal(record?.callType, WA_CALL_LOG_TYPES.REGULAR)
})

test('participants without a user jid are skipped', () => {
    const record = parseCallLogRecord(
        roundTrip({ callId: 'C', participants: [{}, { userJid: '62822@s.whatsapp.net' }] })
    )

    assert.deepEqual(record?.participants, [{ jid: '62822@s.whatsapp.net' }])
})
