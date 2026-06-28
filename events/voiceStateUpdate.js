// events/voiceStateUpdate.js
module.exports = (client) => {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      // ignore bot moves
      if (newState.member && newState.member.user.bot) return;

      const guild = newState.guild || oldState.guild;
      if (!guild) return;

      const conf = await client.jtcManager.getConfig(guild.id);
      if (!conf || !conf.lobbyChannelId) return; // no JTC configured

      // User joined the lobby -> create a private channel
      if (!oldState.channelId && newState.channelId === conf.lobbyChannelId) {
        const lobby = newState.channel;
        if (!lobby) return;
        const category = lobby.parent;
        const member = newState.member;

        const channelName = (conf.namePattern || "{user}'s room").replace('{user}', member.displayName);
        const userLimit = conf.userLimit || 0; // 0 = unlimited

        const overwrites = [
          {
            id: guild.roles.everyone.id,
            deny: ['Connect']
          },
          {
            id: member.id,
            allow: ['Connect', 'ViewChannel', 'Speak', 'Stream']
          }
        ];

        // allow roles if configured
        if (conf.allowedRoleIds && Array.isArray(conf.allowedRoleIds)) {
          for (const rId of conf.allowedRoleIds) {
            overwrites.push({ id: rId, allow: ['Connect', 'ViewChannel', 'Speak'] });
          }
        }

        const newChannel = await guild.channels.create({
          name: channelName,
          type: 2, // GUILD_VOICE in v14 numeric constant
          parent: category ? category.id : null,
          permissionOverwrites: overwrites,
          userLimit: userLimit
        });

        // move the member into the new channel
        try {
          await member.voice.setChannel(newChannel);
        } catch (err) {
          console.warn('Failed to move member into newly created JTC channel:', err);
        }

        // persist created channel
        await client.jtcManager.addCreated(guild.id, newChannel.id);
      }

      // Handle leaving: if a tracked channel becomes empty -> delete
      const maybeChannelLeft = oldState.channel;
      if (maybeChannelLeft) {
        const wasCreated = await client.jtcManager.isCreated(guild.id, maybeChannelLeft.id);
        if (wasCreated) {
          // if channel exists and has 0 members, delete it
          const fetched = guild.channels.cache.get(maybeChannelLeft.id) || await guild.channels.fetch(maybeChannelLeft.id).catch(() => null);
          if (fetched && fetched.members.size === 0) {
            await fetched.delete('JTC: empty, cleaning up');
            await client.jtcManager.removeCreated(guild.id, maybeChannelLeft.id);
          }
        }
      }
    } catch (err) {
      console.error('voiceStateUpdate handler error:', err);
    }
  });
};
