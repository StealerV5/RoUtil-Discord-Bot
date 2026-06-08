// systems/activity.js — Message activity tracking, scores, and leaderboard
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { load, save } = require('../db');

// ── Activity tracking (call from messageCreate) ───────────────────────────────

function trackMessage(guildId, userId) {
    const db = load('activity', {});
    if (!db[guildId]) db[guildId] = {};
    if (!db[guildId][userId]) db[guildId][userId] = { messages: 0, score: 0, lastSeen: null, weekMessages: 0, weekStart: null };

    const rec = db[guildId][userId];
    const now = Date.now();

    // Reset weekly counter if new week
    const weekMs = 7 * 24 * 3600000;
    if (!rec.weekStart || now - rec.weekStart > weekMs) {
        rec.weekMessages = 0;
        rec.weekStart    = now;
    }

    rec.messages++;
    rec.weekMessages++;
    rec.lastSeen = now;

    // Score: 1 point per message, diminishing after 50/day
    if (rec.messages % 5 === 0) rec.score++;

    save('activity', db);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function handleCommand(message, command, args) {
    const gid = message.guild.id;
    const db  = load('activity', {});

    if (command === 'activity') {
        const target = message.mentions.members.first() || message.member;
        const uid    = target.id;
        const rec    = db[gid]?.[uid] || { messages: 0, score: 0, weekMessages: 0, lastSeen: null };

        const embed = new EmbedBuilder().setColor(0x3498db)
            .setTitle(`📊 Activity — ${target.user.tag}`)
            .setThumbnail(target.user.displayAvatarURL())
            .addFields(
                { name: '💬 Total Messages', value: `${rec.messages}`,     inline: true },
                { name: '📅 This Week',       value: `${rec.weekMessages}`, inline: true },
                { name: '⭐ Activity Score',  value: `${rec.score}`,        inline: true },
                { name: '👁️ Last Seen',       value: rec.lastSeen ? `<t:${Math.floor(rec.lastSeen / 1000)}:R>` : 'Unknown', inline: true }
            )
            .setFooter({ text: 'Activity tracked via message count' });

        return message.reply({ embeds: [embed] });
    }

    if (command === 'leaderboard') {
        const guildData = db[gid] || {};
        const sorted    = Object.entries(guildData)
            .map(([uid, rec]) => ({ uid, ...rec }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 15);

        if (!sorted.length) return message.reply('📋 No activity data recorded yet.');

        const medals = ['🥇', '🥈', '🥉'];
        const embed  = new EmbedBuilder().setColor(0xf1c40f)
            .setTitle('🏆 Activity Leaderboard')
            .setDescription(sorted.map((r, i) =>
                `${medals[i] || `**${i + 1}.**`} <@${r.uid}> — ⭐ \`${r.score}\` score — 💬 \`${r.messages}\` messages`
            ).join('\n'))
            .setFooter({ text: `Top ${sorted.length} most active staff members • Updated in real-time` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('act_weekly').setLabel('📅 Weekly View').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('act_refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Primary)
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    if (command === 'resetactivity') {
        if (!message.member.permissions.has('Administrator')) return message.reply('❌ Administrator only.');
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Mention a user to reset their activity.');
        if (db[gid]?.[target.id]) {
            db[gid][target.id] = { messages: 0, score: 0, weekMessages: 0, weekStart: null, lastSeen: null };
            save('activity', db);
        }
        return message.reply(`✅ Activity reset for <@${target.id}>.`);
    }

    if (command === 'addscore') {
        if (!message.member.permissions.has('Administrator')) return message.reply('❌ Administrator only.');
        const target = message.mentions.members.first();
        const points = parseInt(args[1]) || 0;
        if (!target || !points) return message.reply('❌ Usage: `!addscore @user <points>`');
        if (!db[gid]) db[gid] = {};
        if (!db[gid][target.id]) db[gid][target.id] = { messages: 0, score: 0, weekMessages: 0, lastSeen: null };
        db[gid][target.id].score += points;
        save('activity', db);
        return message.reply(`✅ Added **${points}** score points to <@${target.id}>. New score: \`${db[gid][target.id].score}\`.`);
    }
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    const gid = interaction.guild.id;
    const db  = load('activity', {});

    if (interaction.customId === 'act_weekly') {
        const guildData = db[gid] || {};
        const sorted    = Object.entries(guildData)
            .map(([uid, rec]) => ({ uid, ...rec }))
            .sort((a, b) => (b.weekMessages || 0) - (a.weekMessages || 0))
            .slice(0, 15);

        const medals = ['🥇', '🥈', '🥉'];
        const embed  = new EmbedBuilder().setColor(0x3498db)
            .setTitle('📅 Weekly Activity Leaderboard')
            .setDescription(sorted.length
                ? sorted.map((r, i) => `${medals[i] || `**${i + 1}.**`} <@${r.uid}> — 💬 \`${r.weekMessages || 0}\` messages this week`).join('\n')
                : 'No activity data for this week.'
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.customId === 'act_refresh') {
        const guildData = db[gid] || {};
        const sorted    = Object.entries(guildData)
            .map(([uid, rec]) => ({ uid, ...rec }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 15);

        const medals = ['🥇', '🥈', '🥉'];
        const embed  = new EmbedBuilder().setColor(0xf1c40f)
            .setTitle('🏆 Activity Leaderboard (Refreshed)')
            .setDescription(sorted.map((r, i) =>
                `${medals[i] || `**${i + 1}.**`} <@${r.uid}> — ⭐ \`${r.score}\` score — 💬 \`${r.messages}\` messages`
            ).join('\n'))
            .setTimestamp();

        return interaction.update({ embeds: [embed] });
    }
}

module.exports = { handleCommand, handleInteraction, trackMessage };
