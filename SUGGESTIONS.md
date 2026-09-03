# Suggestions for the next season

Notes collected while auditing `plugins/` and adding the presence plugins. Nothing here is required for
the bot to run — it is a backlog of what would make the next round of work easier and safer.

## 1. Guard rails that would have caught the bugs fixed in this pass

The audit found the same three classes of defect repeated across plugins:

- unguarded `message.reply_message.<x>` / `message.mention[0]` access (throws when the command is used
  without a reply or a mention),
- missing imports that only fail at runtime (`jidToNum` in `lydia.js`),
- typos in metadata and in property names (`decs:` instead of `desc:`, `reply_message.txt` instead of
  `reply_message.text`, which silently disabled adding filters by reply).

Recommended:

- add ESLint (`eslint:recommended` + `no-undef`, `no-unused-vars`) and Prettier with a `yarn lint`
  script, and run it in CI on `plugins/**` — all three classes above are statically detectable;
- add a tiny CI check that every `bot({ pattern, desc })` has a `desc` and that every
  `lang.plugins.<name>.<key>` referenced in `plugins/` exists in **all** files under `lang/`
  (a missing key currently crashes at load time, since `lang.plugins.foo` is `undefined`);
- add JSDoc typedefs (or `// @ts-check`) for the `Message` class so plugin authors get completion for
  `mention`, `reply_message`, `client`, `getGids`, `groupMetadata`, ...

## 2. Plugin API gaps

- **No first-class event hook for plugins.** Presence tracking has to reach into `message.client.ev`
  from inside a command handler and attach lazily, because a plugin has no way to receive the socket
  at startup. An `onConnect(client)` (or `bot({ on: 'connection' }, ...)`) hook would let plugins
  subscribe to Baileys events (`presence.update`, `call`, `chats.upsert`, `contacts.update`) directly
  and would remove the "run a command once to arm the tracker" caveat of `plugins/presence.js`.
- **No documented contact/chat enumeration.** `listContacts(session)` only returns imported vCards, and
  chats have to be reconstructed from `getGids()` + `groupMetadata()`. A `getChats(session)` helper
  backed by the store would make `whoson` far more accurate outside groups.
- **`isUser()` / `isGroup()` from `lib/` throw** in a bare Node process (`by is not a function`), so
  plugins end up re-implementing `jid.endsWith('@s.whatsapp.net')`. Worth fixing at the source and
  exporting a single JID helper module.
- **`getData` / `setData` are a global key-value bucket.** Multi-session installs must namespace keys
  by bot jid manually (as `plugins/presence.js` does). A session-scoped `setData(session, key, value)`
  would prevent cross-session leaks.

## 3. Presence features worth extending

The new `whoson` / `presence` / `stalk` commands only know what WhatsApp actually sends:

- presence is only delivered for users who share "last seen / online", and only while the socket is
  connected — restarts create gaps in the history;
- the history is capped at 40 transitions per target and kept in a single JSON blob.

Next steps:

- move the tracking log into its own Sequelize model (`jid`, `session`, `state`, `at`) so reports can
  be aggregated (daily online time, most active hours, weekly summary) without loading a blob;
- a `stalk graph` command rendering an hour-by-hour activity chart from that table;
- opt-in privacy switch (`STALK_ENABLED`) plus an audit trail, since presence tracking is sensitive and
  should be an explicit choice of the bot owner;
- re-subscribe presence on `connection.update: open` instead of on a 5-minute timer.

## 4. Other Baileys-based plugins that fit the current structure

- **`call`** — auto-reject incoming calls and warn/block the caller (Baileys `call` event +
  `rejectCall`), configurable per contact.
- **`vv`** — resend a view-once message that was replied to.
- **`chatinfo`** — unread counts, last activity and pinned/archived state per chat.
- **`typing` / `recording`** — send a presence update to a chat on demand (`sendPresenceUpdate`).
- **`labels`** — read/apply WhatsApp Business labels (`labels.edit` / `labelAssociation` events).
- **`newsletter`** — the socket already exposes newsletter methods (`getChannelMetadata`,
  `newsletterReactMessage`); a small plugin could follow/unfollow and react to channel posts.
- **`statuswatch`** — log which contacts posted a status and optionally auto-view it.
- **`backupchat`** — export a chat to a text/HTML file using the stored messages.

## 5. Housekeeping

- `plugins/news.js` and `plugins/editor.js` still hard-code their `desc` strings instead of using
  `lang.plugins.*` — they are the last two plugins that are not localizable.
- `lang/ml.json` was indented inconsistently (fixed in this pass); a `yarn format:lang` script that
  rewrites every language file with `JSON.stringify(json, null, 2)` would keep them aligned.
- `database.db` sits in the repository root; it is ignored, but a `data/` directory would make the
  Docker/Heroku volumes clearer.
- Dependency install currently fails with plain `yarn install` on Node 22 because of the `jimp` /
  `baileys` peer range; pinning `jimp` to the version Baileys expects would remove the need for
  `--ignore-engines` / `--legacy-peer-deps`.
