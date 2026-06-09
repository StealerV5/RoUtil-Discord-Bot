// systems/robloxext.js — Extended Roblox lookup commands
const { EmbedBuilder } = require('discord.js');

async function rGet(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'RoUtil-Bot/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function handleCommand(message, command, args) {
    const r = (c) => message.reply(c);

    // ── !roblox <username> ────────────────────────────────────────────────────
    if (command === 'roblox') {
        const query = args.join(' ');
        if (!query) return r('❌ Usage: `!roblox <username>`');
        const loading = await r('🔍 Fetching Roblox profile…');
        try {
            const search = await rGet(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(query)}&limit=5`);
            const users = search.data || [];
            if (!users.length) return loading.edit('❌ No Roblox user found with that username.');
            const user = users[0];
            const [detail, fl, fw, fr] = await Promise.all([
                rGet(`https://users.roblox.com/v1/users/${user.id}`).catch(() => user),
                rGet(`https://friends.roblox.com/v1/users/${user.id}/followers/count`).catch(() => ({ count: 0 })),
                rGet(`https://friends.roblox.com/v1/users/${user.id}/followings/count`).catch(() => ({ count: 0 })),
                rGet(`https://friends.roblox.com/v1/users/${user.id}/friends/count`).catch(() => ({ count: 0 }))
            ]);
            const embed = new EmbedBuilder()
                .setColor(0x00b4d8)
                .setTitle(`🎮 ${detail.displayName || user.displayName} (@${detail.name || user.name})`)
                .setURL(`https://www.roblox.com/users/${user.id}/profile`)
                .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${user.id}&width=420&height=420&format=png`)
                .setDescription(detail.description?.slice(0, 300) || '_No description set._')
                .addFields(
                    { name: '🆔 User ID',    value: user.id.toString(),                          inline: true },
                    { name: '👥 Followers',  value: (fl.count ?? 0).toLocaleString(),            inline: true },
                    { name: '➡️ Following',  value: (fw.count ?? 0).toLocaleString(),            inline: true },
                    { name: '🤝 Friends',    value: (fr.count ?? 0).toLocaleString(),            inline: true },
                    { name: '📅 Joined',     value: detail.created
                        ? `<t:${Math.floor(new Date(detail.created).getTime() / 1000)}:D>`
                        : 'Unknown',                                                               inline: true }
                )
                .setFooter({ text: 'Roblox Profile' });
            return loading.edit({ content: null, embeds: [embed] });
        } catch (err) {
            return loading.edit(`❌ Failed to fetch profile: ${err.message}`);
        }
    }

    // ── !gameinfo <placeId> ───────────────────────────────────────────────────
    if (command === 'gameinfo') {
        const placeId = args[0];
        if (!placeId || isNaN(placeId)) return r('❌ Usage: `!gameinfo <placeId>`. Example: `!gameinfo 185655149`');
        const loading = await r('🔍 Fetching game info…');
        try {
            const univData = await rGet(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
            const universeId = univData.universeId;
            if (!universeId) return loading.edit('❌ Could not find a game with that place ID.');
            const [gameData, iconData] = await Promise.all([
                rGet(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
                rGet(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`).catch(() => null)
            ]);
            const g = gameData.data?.[0];
            if (!g) return loading.edit('❌ Game data not found.');
            const embed = new EmbedBuilder()
                .setColor(0x00b4d8)
                .setTitle(`🎮 ${g.name}`)
                .setURL(`https://www.roblox.com/games/${placeId}`)
                .setDescription(g.description?.slice(0, 300) || '_No description._')
                .addFields(
                    { name: '👥 Visits',      value: (g.visits   ?? 0).toLocaleString(), inline: true },
                    { name: '🟢 Playing',     value: (g.playing  ?? 0).toLocaleString(), inline: true },
                    { name: '👍 Favorites',   value: (g.favoritedCount ?? 0).toLocaleString(), inline: true },
                    { name: '🔓 Access',      value: g.isPublic ? 'Public' : 'Private',  inline: true },
                    { name: '💰 Price',       value: g.price ? `${g.price} R$` : 'Free', inline: true },
                    { name: '🆔 Universe ID', value: universeId.toString(),               inline: true }
                )
                .setFooter({ text: 'Roblox Games' });
            const icon = iconData?.data?.[0]?.imageUrl;
            if (icon) embed.setThumbnail(icon);
            return loading.edit({ content: null, embeds: [embed] });
        } catch (err) {
            return loading.edit(`❌ Failed to fetch game: ${err.message}`);
        }
    }

    // ── !groupinfo <groupId> ──────────────────────────────────────────────────
    if (command === 'groupinfo') {
        const groupId = args[0];
        if (!groupId || isNaN(groupId)) return r('❌ Usage: `!groupinfo <groupId>`');
        const loading = await r('🔍 Fetching group info…');
        try {
            const [g, iconData] = await Promise.all([
                rGet(`https://groups.roblox.com/v1/groups/${groupId}`),
                rGet(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${groupId}&size=420x420&format=Png&isCircular=false`).catch(() => null)
            ]);
            if (g.errors) return loading.edit('❌ Group not found.');
            const embed = new EmbedBuilder()
                .setColor(0x00b4d8)
                .setTitle(`🏛️ ${g.name}`)
                .setURL(`https://www.roblox.com/groups/${groupId}`)
                .setDescription(g.description?.slice(0, 300) || '_No description._')
                .addFields(
                    { name: '👤 Owner',    value: g.owner?.username ?? 'None',              inline: true },
                    { name: '👥 Members',  value: (g.memberCount ?? 0).toLocaleString(),    inline: true },
                    { name: '🔒 Public',   value: g.publicEntryAllowed ? 'Yes' : 'No',      inline: true },
                    { name: '🆔 Group ID', value: groupId,                                  inline: true }
                )
                .setFooter({ text: 'Roblox Groups' });
            const icon = iconData?.data?.[0]?.imageUrl;
            if (icon) embed.setThumbnail(icon);
            return loading.edit({ content: null, embeds: [embed] });
        } catch (err) {
            return loading.edit(`❌ Failed to fetch group: ${err.message}`);
        }
    }

    // ── !groupranks <groupId> ─────────────────────────────────────────────────
    if (command === 'groupranks') {
        const groupId = args[0];
        if (!groupId || isNaN(groupId)) return r('❌ Usage: `!groupranks <groupId>`');
        const loading = await r('🔍 Fetching group ranks…');
        try {
            const data = await rGet(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
            if (!data.roles?.length) return loading.edit('❌ Group not found or has no ranks.');
            const lines = data.roles.map(r2 => `**[${r2.rank}]** ${r2.name} — ${(r2.memberCount ?? 0).toLocaleString()} members`);
            const embed = new EmbedBuilder()
                .setColor(0x00b4d8)
                .setTitle('🏛️ Group Ranks')
                .setDescription(lines.join('\n'))
                .setFooter({ text: `Group ${groupId}  •  ${data.roles.length} total ranks` });
            return loading.edit({ content: null, embeds: [embed] });
        } catch (err) {
            return loading.edit(`❌ Failed to fetch ranks: ${err.message}`);
        }
    }

    // ── !groupmembers <groupId> ───────────────────────────────────────────────
    if (command === 'groupmembers') {
        const groupId = args[0];
        if (!groupId || isNaN(groupId)) return r('❌ Usage: `!groupmembers <groupId>`');
        const loading = await r('🔍 Fetching group members…');
        try {
            const [g, roles] = await Promise.all([
                rGet(`https://groups.roblox.com/v1/groups/${groupId}`),
                rGet(`https://groups.roblox.com/v1/groups/${groupId}/roles`)
            ]);
            if (g.errors) return loading.edit('❌ Group not found.');
            const top = (roles.roles || []).filter(r2 => r2.memberCount > 0).sort((a, b) => b.rank - a.rank).slice(0, 10);
            const lines = top.map(r2 => `**[${r2.rank}]** ${r2.name} — ${(r2.memberCount ?? 0).toLocaleString()} members`);
            const embed = new EmbedBuilder()
                .setColor(0x00b4d8)
                .setTitle(`👥 ${g.name} — Members`)
                .setDescription(lines.join('\n') || '*No members.*')
                .addFields({ name: 'Total Members', value: (g.memberCount ?? 0).toLocaleString(), inline: true })
                .setFooter({ text: 'Showing top 10 populated ranks' });
            return loading.edit({ content: null, embeds: [embed] });
        } catch (err) {
            return loading.edit(`❌ Failed to fetch group: ${err.message}`);
        }
    }

    // ── !badgeinfo <badgeId> ──────────────────────────────────────────────────
    if (command === 'badgeinfo') {
        const badgeId = args[0];
        if (!badgeId || isNaN(badgeId)) return r('❌ Usage: `!badgeinfo <badgeId>`');
        const loading = await r('🔍 Fetching badge info…');
        try {
            const b = await rGet(`https://badges.roblox.com/v1/badges/${badgeId}`);
            if (b.errors || !b.id) return loading.edit('❌ Badge not found.');
            const embed = new EmbedBuilder()
                .setColor(0xffd700)
                .setTitle(`🏅 ${b.name}`)
                .setDescription(b.description?.slice(0, 300) || '_No description._')
                .addFields(
                    { name: '🆔 Badge ID',  value: b.id.toString(),                         inline: true },
                    { name: '🎮 Game',      value: b.awardingUniverse?.name ?? 'Unknown',   inline: true },
                    { name: '✅ Enabled',   value: b.enabled ? 'Yes' : 'No',               inline: true },
                    { name: '📅 Created',   value: b.created
                        ? `<t:${Math.floor(new Date(b.created).getTime() / 1000)}:D>`
                        : 'Unknown',                                                          inline: true },
                    { name: '📈 Win Rate',  value: b.statistics?.winRatePercentage != null
                        ? `${b.statistics.winRatePercentage.toFixed(2)}%`
                        : 'Unknown',                                                          inline: true }
                )
                .setFooter({ text: 'Roblox Badges' });
            return loading.edit({ content: null, embeds: [embed] });
        } catch (err) {
            return loading.edit(`❌ Failed to fetch badge: ${err.message}`);
        }
    }

    // ── !topgames ─────────────────────────────────────────────────────────────
    if (command === 'topgames' || command === 'featuredgames') {
        const loading = await r('🔍 Fetching top Roblox games…');
        try {
            const data = await rGet('https://games.roblox.com/v1/games/list?model.sortToken=&model.gameFilter=0&model.timeFilter=0&model.genreFilter=0&model.maxRows=10&model.startRows=0&model.exclusiveStartId=0&model.sortOrder=2&model.hasMoreRows=false');
            const games = data.games?.slice(0, 10) || [];
            if (!games.length) return loading.edit('❌ Could not fetch top games right now.');
            const lines = games.map((g, i) => `**${i + 1}.** [${g.name}](https://www.roblox.com/games/${g.placeId}) — 🟢 ${(g.playerCount ?? 0).toLocaleString()} playing`);
            return loading.edit({ content: null, embeds: [new EmbedBuilder().setColor(0x00b4d8).setTitle('🎮 Top Roblox Games').setDescription(lines.join('\n')).setFooter({ text: 'Roblox Games' })] });
        } catch {
            return loading.edit('❌ Failed to fetch top games from Roblox.');
        }
    }

    // ── !newgames ─────────────────────────────────────────────────────────────
    if (command === 'newgames') {
        const loading = await r('🔍 Fetching new Roblox games…');
        try {
            const data = await rGet('https://games.roblox.com/v1/games/list?model.sortToken=&model.gameFilter=0&model.timeFilter=0&model.genreFilter=0&model.maxRows=10&model.startRows=0&model.exclusiveStartId=0&model.sortOrder=4&model.hasMoreRows=false');
            const games = data.games?.slice(0, 10) || [];
            if (!games.length) return loading.edit('❌ Could not fetch new games right now.');
            const lines = games.map((g, i) => `**${i + 1}.** [${g.name}](https://www.roblox.com/games/${g.placeId})`);
            return loading.edit({ content: null, embeds: [new EmbedBuilder().setColor(0x00b4d8).setTitle('🆕 New Roblox Games').setDescription(lines.join('\n')).setFooter({ text: 'Roblox Games' })] });
        } catch {
            return loading.edit('❌ Failed to fetch new games from Roblox.');
        }
    }

    // ── !gamesearch <query> ───────────────────────────────────────────────────
    if (command === 'gamesearch') {
        const query = args.join(' ');
        if (!query) return r('❌ Usage: `!gamesearch <query>`');
        const loading = await r(`🔍 Searching Roblox games for **"${query}"**…`);
        try {
            const data = await rGet(`https://games.roblox.com/v1/games/list?model.keyword=${encodeURIComponent(query)}&model.maxRows=10&model.startRows=0`);
            const games = data.games?.slice(0, 10) || [];
            if (!games.length) return loading.edit(`❌ No games found for **"${query}"**.`);
            const lines = games.map((g, i) => `**${i + 1}.** [${g.name}](https://www.roblox.com/games/${g.placeId}) — 🟢 ${(g.playerCount ?? 0).toLocaleString()} playing`);
            return loading.edit({ content: null, embeds: [new EmbedBuilder().setColor(0x00b4d8).setTitle(`🔍 Game Search: "${query}"`).setDescription(lines.join('\n'))] });
        } catch {
            return loading.edit('❌ Failed to search Roblox games.');
        }
    }
}

const ROBLOX_EXT_CMDS = ['roblox','gameinfo','groupinfo','groupranks','groupmembers','badgeinfo','topgames','featuredgames','newgames','gamesearch'];
module.exports = { handleCommand, ROBLOX_EXT_CMDS };
