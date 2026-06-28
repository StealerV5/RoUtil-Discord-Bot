// commands/jtc-setup.js
module.exports = {
  name: 'jtc-setup',
  aliases: ['join-to-create-setup', 'jtcsetup'],
  description: 'Configure Join-to-Create. Usage: jtc-setup <lobbyChannelId> [userLimit] [namePattern] (optionally comma-separated role IDs allowed)',
  async execute({ client, message, args }) {
    if (!message.member.permissions.has('ManageGuild')) return message.reply('You need Manage Server permission to configure JTC.');
    const lobby = args[0];
    if (!lobby) return message.reply('Usage: jtc-setup <lobbyChannelId|#voiceChannel> [userLimit] [namePattern] [allowedRoleIds(comma-separated)]');

    // resolve channel id if mention
    let lobbyId = lobby.replace('<#', '').replace('>', '');
    const channel = message.guild.channels.cache.get(lobbyId);
    if (!channel || channel.type !== 2) return message.reply('Lobby channel not found or is not a voice channel.');

    const userLimit = parseInt(args[1]) || 0;
    const namePattern = args[2] || "{user}'s room";
    const allowedRoleIds = args[3] ? args[3].split(',').map(s => s.trim()) : [];

    await client.jtcManager.setConfig(message.guild.id, {
      lobbyChannelId: channel.id,
      userLimit: userLimit,
      namePattern,
      allowedRoleIds
    });

    message.channel.send(`JTC configured. Users who join <#${channel.id}> will be moved into private channels named: ${namePattern}`);
  }
};
