// commands/setprefix.js
module.exports = {
  name: 'setprefix',
  aliases: ['prefix'],
  description: 'Set a custom command prefix for this guild.',
  async execute({ client, message, args }) {
    if (!message.member.permissions.has('ManageGuild')) return message.reply('You need Manage Server permission to change the prefix.');
    const newPrefix = args[0];
    if (!newPrefix) return message.reply('Usage: setprefix <newPrefix>');
    await client.prefixManager.setPrefix(message.guild.id, newPrefix);
    message.channel.send(`Prefix updated to: \\`${newPrefix}\\``);
  }
};
