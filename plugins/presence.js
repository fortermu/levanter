const {
  bot,
  lang,
  sleep,
  getData,
  setData,
  jidToNum,
  numToJid,
  parsedJid,
  listContacts,
  formatTime,
  secondsToHms,
} = require('../lib/')

const MAX_SCAN = 250
const MAX_GROUPS = 25
const MAX_LOGS = 40
const SCAN_WAIT = 8000
const RESUBSCRIBE_INTERVAL = 5 * 60 * 1000

const live = new Map()
const attached = new WeakSet()

const isUserJid = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')

const storeKey = (client) => `stalk_${jidToNum(client?.user?.jid || client?.user?.id || 'default')}`

const loadTargets = async (client) => (await getData(storeKey(client))) || {}

const saveTargets = async (client, targets) => await setData(storeKey(client), targets)

const state = (presence) => {
  const states = lang.plugins.presence.states
  if (presence === 'composing') return states.typing
  if (presence === 'recording') return states.recording
  if (presence === 'unavailable') return states.offline
  if (!presence) return states.unknown
  return states.online
}

const time = (ms) => (ms ? formatTime(Math.floor(ms / 1000)) : '-')

const duration = (seconds) => secondsToHms(seconds) || '-'

const since = (ms) => (ms ? duration(Math.floor((Date.now() - ms) / 1000)) : '-')

const onlineIn24h = (logs) => {
  if (!logs?.length) return 0
  const from = Date.now() - 24 * 60 * 60 * 1000
  let total = 0
  let open = null
  for (const log of logs) {
    if (log.s === 'online') open = Math.max(log.t, from)
    else if (open !== null) {
      if (log.t > from) total += log.t - open
      open = null
    }
  }
  if (open !== null) total += Date.now() - open
  return Math.floor(total / 1000)
}

const notify = async (client, chat, text, jid) => {
  try {
    await client.sendMessage(chat, { text, mentions: [jid] })
  } catch (error) {
    /* chat may no longer be reachable */
  }
}

const record = async (client, jid, data) => {
  const presence = data?.lastKnownPresence
  if (!presence) return
  const now = Date.now()
  const online = presence !== 'unavailable'
  const prev = live.get(jid)
  live.set(jid, {
    presence,
    online,
    lastSeen: data.lastSeen ? data.lastSeen * 1000 : prev?.lastSeen,
    since: prev && prev.online === online ? prev.since : now,
  })
  if (prev && prev.online === online) return
  const targets = await loadTargets(client)
  const target = targets[jid]
  if (!target) return
  target.logs = [...(target.logs || []), { t: now, s: online ? 'online' : 'offline' }].slice(
    -MAX_LOGS
  )
  let offlineAfter = 0
  if (online) target.lastOnline = now
  else {
    target.lastOffline = now
    if (prev?.since) offlineAfter = Math.floor((now - prev.since) / 1000)
  }
  await saveTargets(client, targets)
  if (!target.chat) return
  const num = jidToNum(jid)
  const text = online
    ? lang.plugins.stalk.notify_online.format(num, time(now))
    : lang.plugins.stalk.notify_offline.format(num, time(now), duration(offlineAfter))
  await notify(client, target.chat, text, jid)
}

const subscribeAll = async (client) => {
  const targets = await loadTargets(client)
  for (const jid of Object.keys(targets)) {
    try {
      await client.presenceSubscribe(jid)
    } catch (error) {
      /* target may be unreachable */
    }
    await sleep(100)
  }
}

const attach = (client) => {
  if (!client?.ev || attached.has(client)) return
  attached.add(client)
  client.ev.on('presence.update', async ({ presences }) => {
    if (!presences) return
    for (const [jid, data] of Object.entries(presences)) {
      try {
        await record(client, jid, data)
      } catch (error) {
        /* keep listening on failures */
      }
    }
  })
  subscribeAll(client).catch(() => {})
  const timer = setInterval(() => subscribeAll(client).catch(() => {}), RESUBSCRIBE_INTERVAL)
  if (timer.unref) timer.unref()
}

const targetOf = (message, match) => {
  const [jid] = parsedJid(match || '')
  if (jid) return jid
  const num = (match || '').replace(/[^0-9]/g, '')
  if (num.length > 5) return numToJid(num)
  return message.mention?.[0] || message.reply_message?.jid || (!message.isGroup && message.jid)
}

const chatJids = async (message) => {
  const jids = []
  try {
    const gids = await message.getGids()
    for (const gid of Object.keys(gids || {}).slice(0, MAX_GROUPS)) {
      try {
        const participants = await message.groupMetadata(gid)
        for (const { id } of participants) jids.push(id)
      } catch (error) {
        /* metadata may be unavailable */
      }
    }
  } catch (error) {
    /* no group chats */
  }
  try {
    const contacts = (await listContacts(message.id)) || []
    for (const contact of contacts) {
      const jid =
        typeof contact === 'string'
          ? contact
          : contact?.jid || contact?.id || (contact?.number && numToJid(contact.number))
      if (jid) jids.push(jid)
    }
  } catch (error) {
    /* contacts are optional */
  }
  return jids
}

const scan = async (message, jids) => {
  for (const jid of jids) {
    try {
      await message.client.presenceSubscribe(jid)
    } catch (error) {
      /* ignore unreachable targets */
    }
    await sleep(80)
  }
  await sleep(SCAN_WAIT)
  return jids.filter((jid) => live.get(jid)?.online)
}

bot(
  {
    pattern: 'whoson ?(.*)',
    desc: lang.plugins.whoson.desc,
    type: 'whatsapp',
  },
  async (message, match) => {
    attach(message.client)
    const all = (match || '').trim().toLowerCase() === 'all'
    let jids = []
    if (message.isGroup && !all) {
      jids = (await message.groupMetadata(message.jid)).map(({ id }) => id)
    } else {
      jids = await chatJids(message)
    }
    const self = message.client.user?.jid
    jids = [...new Set(jids)].filter((jid) => isUserJid(jid) && jid !== self).slice(0, MAX_SCAN)
    if (!jids.length) return await message.send(lang.plugins.whoson.usage)
    await message.send(lang.plugins.whoson.scanning.format(jids.length))
    const online = await scan(message, jids)
    if (!online.length) return await message.send(lang.plugins.whoson.none)
    let msg = lang.plugins.whoson.title.format(online.length)
    online.forEach((jid, i) => {
      msg += lang.plugins.whoson.item.format(i + 1, jidToNum(jid), state(live.get(jid)?.presence))
    })
    msg += lang.plugins.whoson.note
    return await message.send(msg.trim(), { contextInfo: { mentionedJid: online } })
  }
)

bot(
  {
    pattern: 'presence ?(.*)',
    desc: lang.plugins.presence.desc,
    type: 'whatsapp',
  },
  async (message, match) => {
    attach(message.client)
    const jid = targetOf(message, match)
    if (!isUserJid(jid)) return await message.send(lang.plugins.presence.usage)
    await message.client.presenceSubscribe(jid)
    await sleep(SCAN_WAIT)
    const data = live.get(jid)
    const num = jidToNum(jid)
    if (!data) return await message.send(lang.plugins.presence.unknown.format(num))
    return await message.send(
      lang.plugins.presence.result.format(
        num,
        state(data.presence),
        since(data.since),
        time(data.lastSeen)
      ),
      { contextInfo: { mentionedJid: [jid] } }
    )
  }
)

bot(
  {
    pattern: 'stalk ?(.*)',
    desc: lang.plugins.stalk.desc,
    type: 'whatsapp',
  },
  async (message, match) => {
    attach(message.client)
    const input = (match || '').trim()
    const [action, ...rest] = input.split(' ')
    const args = rest.join(' ')
    const targets = await loadTargets(message.client)

    if (action.toLowerCase() === 'list' || (!input && Object.keys(targets).length)) {
      const jids = Object.keys(targets)
      if (!jids.length) return await message.send(lang.plugins.stalk.empty)
      let msg = lang.plugins.stalk.list_title.format(jids.length)
      jids.forEach((jid, i) => {
        msg += lang.plugins.stalk.list_item.format(
          i + 1,
          jidToNum(jid),
          state(live.get(jid)?.presence)
        )
      })
      return await message.send(msg.trim(), { contextInfo: { mentionedJid: jids } })
    }

    if (!input) return await message.send(lang.plugins.stalk.usage)

    if (action.toLowerCase() === 'stop') {
      if (args.toLowerCase() === 'all') {
        const count = Object.keys(targets).length
        await saveTargets(message.client, {})
        return await message.send(lang.plugins.stalk.removed_all.format(count))
      }
      const jid = targetOf(message, args)
      if (!targets[jid]) return await message.send(lang.plugins.stalk.not_tracked.format(jidToNum(jid)))
      delete targets[jid]
      await saveTargets(message.client, targets)
      return await message.send(lang.plugins.stalk.removed.format(jidToNum(jid)))
    }

    if (action.toLowerCase() === 'check') {
      const jid = targetOf(message, args)
      const target = targets[jid]
      if (!target) return await message.send(lang.plugins.stalk.not_tracked.format(jidToNum(jid)))
      const data = live.get(jid)
      let msg = lang.plugins.stalk.report.format(
        jidToNum(jid),
        state(data?.presence),
        since(data?.since),
        time(target.lastOnline),
        time(target.lastOffline),
        duration(onlineIn24h(target.logs)),
        time(target.addedAt)
      )
      const logs = (target.logs || []).slice(-10)
      msg += logs.length
        ? lang.plugins.stalk.history.format(
            logs
              .map((log) =>
                lang.plugins.stalk.history_item.format(
                  time(log.t),
                  log.s === 'online'
                    ? lang.plugins.presence.states.online
                    : lang.plugins.presence.states.offline
                )
              )
              .join('\n')
          )
        : `\n\n${lang.plugins.stalk.no_history}`
      return await message.send(msg, { contextInfo: { mentionedJid: [jid] } })
    }

    const jid = targetOf(message, input)
    if (!isUserJid(jid)) return await message.send(lang.plugins.stalk.usage)
    if (targets[jid]) return await message.send(lang.plugins.stalk.exists.format(jidToNum(jid)))
    targets[jid] = { chat: message.jid, addedAt: Date.now(), logs: [] }
    await saveTargets(message.client, targets)
    await message.client.presenceSubscribe(jid)
    return await message.send(lang.plugins.stalk.added.format(jidToNum(jid)), {
      contextInfo: { mentionedJid: [jid] },
    })
  }
)
