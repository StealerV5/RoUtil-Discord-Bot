// events/messageCreate.js
const path = require('path');
const fs = require('fs');

module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return; // ignore DMs for now

      const prefix = await client.prefixManager.getPrefix(message.guild.id);
      if (!message.content.startsWith(prefix)) return;

      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();
      if (!commandName) return;

      const command = client.commands.get(commandName);
      if (!command) return;

      await command.execute({ client, message, args, prefix });
    } catch (err) {
      console.error('Error handling messageCreate:', err);
    }
  });
};
