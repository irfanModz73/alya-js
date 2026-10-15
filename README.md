<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/vinikjkkj/zapo/master/.github/assets/logo.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/vinikjkkj/zapo/master/.github/assets/logo-light.png" />
    <img src="https://raw.githubusercontent.com/vinikjkkj/zapo/master/.github/assets/logo-light.png" alt="zapo" width="400" />
  </picture>
</p>

<p align="center">
  <strong>High-performance TypeScript implementation of the WhatsApp Web protocol.</strong><br />
  Built for high-scalability workloads, multi-session operation, and full user configurability.<br />
  <em>Fork of <a href="https://github.com/vinikjkkj/zapo">zapo-js</a> with bot-focused additions.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/alya-js"><img alt="npm version" src="https://img.shields.io/npm/v/alya-js?color=CB3837" /></a>
  <a href="https://www.npmjs.com/package/alya-js"><img alt="npm package size" src="https://img.shields.io/npm/unpacked-size/alya-js?label=package%20size&color=2F855A" /></a>
  <a href="https://github.com/irfanModz73/alya-js"><img alt="fork" src="https://img.shields.io/badge/fork%20of-zapo--js-3178C6" /></a>
  <img alt="node version" src="https://img.shields.io/badge/node-%3E%3D20.9.0-339933" />
  <img alt="language" src="https://img.shields.io/badge/language-TypeScript-3178C6" />
  <img alt="focus" src="https://img.shields.io/badge/focus-high--scale%20%2B%20multi--session-0A7EA4" />
</p>

<p align="center">
  📚 <strong>Documentation:</strong> <a href="https://zapo.to/">zapo.to</a> ·
  🛠 <strong>Contributing:</strong> <a href="CONTRIBUTING.md">CONTRIBUTING.md</a> ·
  💛 <strong>Sponsor:</strong> <a href="https://github.com/sponsors/vinikjkkj">GitHub Sponsors</a>
</p>

---

## Fork notice

**`alya-js` is a fork of [`zapo-js`](https://github.com/vinikjkkj/zapo)** by
[vinikjkkj](https://github.com/vinikjkkj), the original author and copyright
holder.

- Upstream: <https://github.com/vinikjkkj/zapo> — upstream docs at
  <https://zapo.to/>
- License: MIT, unchanged. The original copyright notice in [`LICENSE`](LICENSE)
  is preserved as MIT requires.
- Upstream is tracked as the `upstream` remote, so this fork can pull in
  upstream changes: `git fetch upstream && git merge upstream/master`.
- Upstream `CHANGELOG.md` files and the original documentation links are left
  as-is; they describe releases published under the `zapo-js` name.

Everything below the fork notice describes `alya-js`. Features not listed in
[What this fork adds](#what-this-fork-adds) come from upstream.

## What this fork adds

Everything here is either a wrapper over an existing upstream API or a
read-only parser. **None of it introduce a new protocol stanza**, except the
newsletter status port, which was carried over from observed wire traffic.

### Messaging

| Feature | Usage |
| --- | --- |
| Skip self-sync on a send | `client.message.send(jid, content, { noSelfSync: true })` — drops this account's own devices from the fanout, so bot traffic does not mirror back into the paired phones. Works on 1:1 and group sends. |
| Delete a group status | `client.group.deleteStatus({ groupJid, messageId, participant? })` — revokes a text, image, video, or audio status posted in a group. |
| Send the blocklist | `client.privacy.sendBlockList({ to, options })` — fetches the live blocklist and publishes it as a plain-text message. |

### Status interactions

| Feature | Usage |
| --- | --- |
| React to a status | `client.status.react({ statusId, owner, emoji })` |
| Like a status | `client.status.like({ statusId, owner })` — a status like is a heart reaction; the wire format has no separate like. |
| Bulk apply | `client.status.apply({ targets, action: 'react' \| 'like', emoji, intervalMs })` — reacts across every status an owner published, counting failures instead of throwing on the first one. |
| Download a contact's statuses | `client.status.download({ chatJid, owner?, kinds?, maxBytes? })` — media only; text statuses carry nothing to download. |
| Download a group's statuses | `client.status.downloadGroup(groupJid)` |

Statuses are read from the message store: contact statuses live in the
`status@broadcast` thread with the owner on `participantJid`, group statuses
live in the group thread. **Only statuses this client actually observed are
visible** — anything missed while disconnected was never persisted.

### Group moderation

| Feature | Usage |
| --- | --- |
| Link filter | `evaluateGroupLink(event, { isAllowedSender, deleteMessage, kinds })` — classifies and removes promotional links (TikTok, Instagram, group invites, WhatsApp channels, Telegram, or any generic URL) from non-admin senders. Admins, super-admins, and the group owner pass. Pure decision function; the two effects are injected ports. |
| Allow list helper | `createAdminAllowList(loadMetadata)` — builds the `isAllowedSender` check from a group-metadata lookup. |

### Newsletter channel status

The `<status>` stanza family for newsletter channels, ported from a Baileys
module: publishing a text/media channel status, the `question` /
`question_response` / `question_reshare` interactions, reacting to a status,
admin revoke, and the `<status_updates>` query with its parsers.

```ts
const { id, serverId } = await client.newsletter.sendStatus({
    jid: newsletterJid,
    content: { image: { media: './cover.jpg', mimetype: 'image/jpeg' } },
    mediaType: 'image',
    resolveServerId: true
})
await client.newsletter.reactToStatus({ jid: newsletterJid, messageId: id, parentServerId: serverId, reaction: '❤️' })
```

A channel status address is a **server id**, not a message id. The publish ack
carries only `class`, `id`, and `t`; the server id arrives in a separate
`<status>` echo, so `sendStatus` only returns one when `resolveServerId` is
set **and** a `waitForServerId` port is supplied.

### Call history

`parseCallLogRecord(record)` parses a `CallLogRecord` out of an app-state
`callLogAction` patch. Outcomes and call types decode to readable strings
(`'MISSED'`, `'VOICE_CHAT'`), and `int64` fields go through `longToNumber`
because they decode to `Long` objects that the number coercion helpers reject.

> This parser is read-only. It does **not** make `client.voip` expose a call
> history: `@alya-js/voip` still tracks live calls only, and a call is dropped
> from its in-memory set as soon as it ends.

## Stability Notice

> `alya-js` is stable as of `1.0.0`. The public API follows SemVer:
> breaking changes ship only in a major release; minors add features,
> patches fix bugs.

## Install

```bash
npm install alya-js
```

Zero mandatory runtime dependencies. Pick the optional packages you need
on top: a persistent store, the media processor for thumbnails /
voice-note metadata, and the native crypto accelerator.

```bash
# Persistent store - choose one
npm install @alya-js/store-sqlite better-sqlite3
# or @alya-js/store-redis ioredis
# or @alya-js/store-postgres pg
# or @alya-js/store-mysql mysql2
# or @alya-js/store-mongo mongodb

# Optional - thumbnails + waveforms + voice-note normalization
npm install @alya-js/media-utils sharp
# plus a system `ffmpeg` + `ffprobe` on PATH (see media-utils README)

# Optional - Rust crypto accelerator, no code change required
npm install @alya-js/native

# Optional - structured logging
npm install pino pino-pretty
```

`@alya-js/native` is picked up automatically once installed: the core
resolves it on first use and falls back to the JS implementation when it is
absent, so nothing else changes. It accelerates the two primitives that
dominate the messaging hot path, X25519 ECDH and XEdDSA sign / verify. The
published build is the WASM one (`ZAPO_NATIVE_BACKEND=auto` tries the NAPI
addon first, then WASM); the compiled NAPI addon is not on npm yet and has
to be built from `packages/native`. Set `ZAPO_NATIVE_BACKEND=js` to opt out.

## Quick Start

```ts
import { ConsoleLogger, createStore, WaClient } from 'alya-js'
import { createSqliteStore } from '@alya-js/store-sqlite'

const store = createStore({
    backends: {
        sqlite: createSqliteStore({ path: '.auth/state.sqlite' })
    },
    providers: {
        auth: 'sqlite',
        signal: 'sqlite',
        preKey: 'sqlite',
        session: 'sqlite',
        identity: 'sqlite',
        senderKey: 'sqlite',
        appState: 'sqlite',
        privacyToken: 'sqlite',
        messages: 'sqlite', // 'none' to skip the message archive
        threads: 'sqlite', // 'none' to skip
        contacts: 'sqlite' // 'none' to skip
    }
})

const client = new WaClient({ store, sessionId: 'default' }, new ConsoleLogger('info'))

client.on('auth_qr', ({ qr }) => {
    console.log('scan this:', qr)
})

client.on('auth_paired', ({ credentials }) => {
    console.log('paired as', credentials.meJid)
})

client.on('message', async (event) => {
    if (event.message?.conversation === 'ping') {
        await client.message.send(event.key.remoteJid, 'pong')
    }
})

await client.connect()
```

That's the minimum to pair, listen for messages, and reply. For everything
else - sending media, reactions, polls, groups, newsletters, app-state
mutations, business profile, events catalog, store providers, the typed
event map, and the architectural reasoning - read the guides at
**[zapo.to](https://zapo.to/)**.

## Packages

The core lives at the repo root (`alya-js`). Optional packages live in
[`packages/`](packages/) and ship under the `@alya-js/*` scope. Install
only what you need.

| Package                                              | Peer dependency                                                                       | Purpose                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@alya-js/store-sqlite`](packages/store-sqlite)     | `better-sqlite3`                                                                      | SQLite persistent store (single-process bots, dev sessions, small-to-medium prod).                                                               |
| [`@alya-js/store-redis`](packages/store-redis)       | `ioredis`                                                                             | Redis-backed store with native TTL eviction.                                                                                                     |
| [`@alya-js/store-mongo`](packages/store-mongo)       | `mongodb`                                                                             | MongoDB-backed store with TTL-index eviction.                                                                                                    |
| [`@alya-js/store-mysql`](packages/store-mysql)       | `mysql2`                                                                              | MySQL / MariaDB-backed store with background cleanup poller.                                                                                     |
| [`@alya-js/store-postgres`](packages/store-postgres) | `pg`                                                                                  | PostgreSQL-backed store with background cleanup poller.                                                                                          |
| [`@alya-js/media-utils`](packages/media-utils)       | `sharp` + `file-type` + `ffmpeg`                                                      | `WaMediaProcessor`: thumbnails, waveforms, voice-note normalization.                                                                             |
| [`@alya-js/native`](packages/native)                 | (none)                                                                                | Rust crypto accelerator for the messaging hot path (X25519 ECDH, XEdDSA sign / verify). Auto-detected once installed; ships as a WASM build.     |
| [`@alya-js/voip`](packages/voip)                     | `@roamhq/wrtc` + `libmlow-wasm-fork`                                                  | `client.voip` plugin for calls: MLow/WASM codec, SRTP, STUN, WebRTC/SCTP relay transport.                                                        |
| [`@alya-js/voip-media`](packages/voip-media)         | `libmlow-wasm-fork` (optional, to carry media) + `@roamhq/wrtc` (optional, Node host) | Call media plane with no Node or `alya-js` dependency, so it runs in the browser: relay transport, STUN, SRTP, RTP/RTCP, MLow codec.             |
| [`@alya-js/wam`](packages/wam)                       | (none)                                                                                | `client.wam` plugin emitting the client-side WAM telemetry batches WA Web sends, for wire parity and anti-fingerprinting.                        |
| [`@alya-js/fake-server`](packages/fake-server)       | (none)                                                                                | In-process fake WhatsApp Web server for end-to-end testing.                                                                                      |
| [`@alya-js/mcp-server`](packages/mcp-server)         | `@modelcontextprotocol/sdk`                                                           | **Dev-only.** MCP server exposing multi-session `WaClient`s as dynamic tools for an LLM agent (Claude Code / Cursor / etc.). Not for production. |

Each package's README has the install + config + integration notes.

## Documentation

- **[zapo.to](https://zapo.to/)** - guides, full API reference, examples,
  protocol notes ([llms.txt](https://zapo.to/llms.txt) index or
  [llms-full.txt](https://zapo.to/llms-full.txt) for LLM context)
- **[`vinikjkkj/zapo-docs`](https://github.com/vinikjkkj/zapo-docs)** -
  source of zapo.to (open issues/PRs there for doc fixes)
- **Per-package READMEs** under [`packages/`](packages/) - one per
  optional package
- **[`AGENTS.md`](AGENTS.md)** - architecture spec + coding rules
  (contributor-facing)

## Contributing

Pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for
setup, repo layout, CI, release flow, and the conventions PRs must follow.

Contributors also agree to the [Code of Conduct](CODE_OF_CONDUCT.md),
which includes an **AI-Assisted Contributions** policy covering
disclosure, human ownership, and the rule against bundle-hallucinated
protocol claims.

## Security

Found a vulnerability in the crypto, auth, or Signal layer? Please
**do not open a public issue**. Report it privately via
[GitHub Security Advisories](https://github.com/vinikjkkj/zapo/security/advisories/new)
or email `contact@vinicius.email`. Scope, response window, and
disclosure timeline are documented in [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © vinikjkkj

## Support the Project

If `zapo` is useful in your production or study setup, you can support
ongoing development on GitHub Sponsors:
[github.com/sponsors/vinikjkkj](https://github.com/sponsors/vinikjkkj).

## Disclaimer

This project is an independent implementation for engineering and
interoperability research. It is not affiliated with or endorsed by
WhatsApp.
