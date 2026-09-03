const { mediafire, bot, isUrl, lang } = require('../lib')

bot(
  {
    pattern: 'mediafire ?(.*)',
    desc: lang.plugins.mediafire.desc,
    type: 'download',
  },
  async (message, match) => {
    match = isUrl(match || message.reply_message?.text)
    if (!match) return await message.send(lang.plugins.mediafire.usage)
    const result = await mediafire(match)
    if (!result)
      return await message.send(lang.plugins.mediafire.not_found, {
        quoted: message.quoted,
      })
    return await message.sendFromUrl(result)
  }
)
