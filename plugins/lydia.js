const { setLydia, bot, jidToNum, lang } = require('../lib/')

bot(
  {
    pattern: 'lydia ?(.*)',
    desc: lang.plugins.lydia.desc,
    type: 'misc',
  },
  async (message, match) => {
    if (!match) return await message.send(lang.plugins.lydia.usage)

    const user = message.mention?.[0] || message.reply_message?.jid
    if (user) {
      match = match.replace(`@${jidToNum(user)}`, '').trim()
    }
    if (match !== 'on' && match !== 'off') return await message.send(lang.plugins.lydia.usage)

    await setLydia(message.jid, match === 'on', user, message.id)
    return await message.send(
      `${match === 'on' ? lang.plugins.lydia.activated : lang.plugins.lydia.deactivated}${
        user ? '' : `\n${lang.plugins.lydia.note}`
      }`
    )
  }
)
