// systems/staffProfile.js — Staff profile and history display
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { load } = require('../db');

async function handleCommand(message, args) {
    const gid    = message.guild.id;
    const target = message.mentions.members.first() || message.member;
    const uid    = target.id;

    const staffDb = load('staffData', {});
    const record  = staffDb[gid]?.[uid];

    const caseDb = load('cases', {});
    const cases  = (caseDb[gid]?.list || []).filter(c => c.userId === uid);

    // Activity
    const actDb  = load('activity', {});
    const act    = actDb[gid]?.[uid] || { messages: 0, score: 0 };

    // LOA
    const loaDb  = load('loa', {});
    const loaRec = loaDb[gid]?.[uid];

    // Build status string
    const statusParts = [];
    if (record?.isTerminated) statusParts.push('🚫 Terminated');
    else if (record?.isBanned) statusParts.push('🔨 Banned');
    else if (record?.isSuspended) statusParts.push(`🔴 Suspended${record.suspendedUntil ? ` until <t:${Math.floor(record.suspendedUntil / 1000)}:d>` : ' (Permanent)'}`);
    else if (record?.isLOA) statusParts.push('🌴 On Leave (LOA)');
    else statusParts.push('✅ Active');

    const warnings    = cases.filter(c => c.type === 'warn').length;
    const strikes     = cases.filter(c => c.type === 'strike').length;
    const suspensions = cases.filter(c => c.type === 'suspend').length;
    const demotions   = cases.filter(c => c.type === 'demote').length;
    const promotions  = (record?.promotions || []).length;
    const trainings   = (record?.trainings  || []).length;
    const notes       = cases.filter(c => c.type === 'note').length;

    // Recent cases
    const recent = cases.slice(-5).reverse();

    const embed = new EmbedBuilder()
        .setColor(record?.isTerminated || record?.isBanned ? 0x2c2f33 : record?.isSuspended ? 0xe74c3c : 0x5865f2)
        .setTitle(`👤 Staff Profile — ${target.user.tag}`)
        .setThumbnail(target.user.displayAvatarURL({ size: 256 }))
        .addFields(
            { name: '🆔 User ID',          value: uid,                                inline: true },
            { name: '📅 Joined Server',     value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:d>`, inline: true },
            { name: '⚡ Status',            value: statusParts.join('\n') || '✅ Active', inline: true },
            { name: '\u200b',              value: '\u200b',                            inline: false },
            { name: '⚠️ Warnings',         value: `${warnings}`,   inline: true },
            { name: '❗ Strikes',           value: `${strikes} (${record?.activeStrikes || 0} active)`, inline: true },
            { name: '🔴 Suspensions',       value: `${suspensions}`,  inline: true },
            { name: '📉 Demotions',         value: `${demotions}`,    inline: true },
            { name: '📈 Promotions',        value: `${promotions}`,   inline: true },
            { name: '🎓 Trainings Passed',  value: `${trainings}`,    inline: true },
            { name: '📝 Staff Notes',       value: `${notes}`,        inline: true },
            { name: '💬 Messages (tracked)',value: `${act.messages}`, inline: true },
            { name: '⭐ Activity Score',    value: `${act.score}`,    inline: true },
        );

    if (recent.length) {
        embed.addFields({
            name: '📋 Recent Cases',
            value: recent.map(c =>
                `\`${c.id}\` — **${c.type.toUpperCase()}** — ${c.reason.slice(0, 50)}${c.reason.length > 50 ? '…' : ''}`
            ).join('\n'),
            inline: false
        });
    }

    if (loaRec?.active) {
        embed.addFields({ name: '🌴 Current LOA',
            value: `**Reason:** ${loaRec.reason}\n**Until:** ${loaRec.endDate || 'Unspecified'}`, inline: false });
    }

    embed.setFooter({ text: `${cases.length} total cases • Profile generated` })
         .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`mod_history_${uid}`).setLabel('📋 Full Case History').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`sp_loa_${uid}`).setLabel('🌴 LOA History').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`sp_train_${uid}`).setLabel('🎓 Training Records').setStyle(ButtonStyle.Secondary)
    );

    await message.reply({ embeds: [embed], components: [row] });
}

async function handleInteraction(interaction) {
    const gid = interaction.guild.id;
    const uid = interaction.customId.split('_').pop();

    if (interaction.customId.startsWith('sp_loa_')) {
        const loaDb = load('loa', {});
        const hist  = loaDb[gid]?.[uid]?.history || [];
        const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle(`🌴 LOA History — <@${uid}>`)
            .setDescription(hist.length
                ? hist.map(l => `**${l.startDate}** → **${l.endDate || 'Open'}** — ${l.reason}`).join('\n')
                : 'No LOA records found.'
            );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.customId.startsWith('sp_train_')) {
        const staffDb = load('staffData', {});
        const recs    = staffDb[gid]?.[uid]?.trainings || [];
        const embed   = new EmbedBuilder().setColor(0x3498db).setTitle(`🎓 Training Records — <@${uid}>`)
            .setDescription(recs.length
                ? recs.map(t => `**${t.name}** — ${t.result} — <t:${Math.floor(t.timestamp / 1000)}:d> — Instructor: ${t.instructor}`).join('\n')
                : 'No training records found.'
            );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

module.exports = { handleCommand, handleInteraction };
