// systems/promotions.js — Promotion and demotion request system
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionFlagsBits
} = require('discord.js');
const { load, save } = require('../db');

function getCfg(gid) { return load('modConfig', {})[gid] || {}; }

// ── !promotionsetup ───────────────────────────────────────────────────────────

async function handleCommand(message, command, args) {
    const gid = message.guild.id;
    const cfg = getCfg(gid);

    const isHR = message.member.permissions.has('Administrator') ||
                 [...(cfg.hrRoles || []), ...(cfg.mgmtRoles || [])].some(r => message.member.roles.cache.has(r));

    // ── !promotionsetup ───────────────────────────────────────────────────────
    if (command === 'promotionsetup') {
        if (!message.member.permissions.has('Administrator')) return message.reply('❌ Administrator only.');

        await message.channel.send({
            embeds: [new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('📈 Promotion Request Panel')
                .setDescription(
                    'Staff members who believe they meet the requirements for promotion can submit a request below.\n\n' +
                    '**Promotion Requirements (contact HR for specifics):**\n' +
                    '• Time in current rank\n' +
                    '• Required trainings completed\n' +
                    '• Activity requirements met\n' +
                    '• Clean disciplinary record\n\n' +
                    'Your request will be reviewed by HR and Management.'
                )
                .setFooter({ text: 'Promotion System • Merit-based advancement' })
            ],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('promo_request').setLabel('📈 Request Promotion').setStyle(ButtonStyle.Primary)
            )]
        });

        await message.reply('✅ Promotion panel posted.');
    }

    // ── !demotionsetup ────────────────────────────────────────────────────────
    if (command === 'demotionsetup') {
        if (!message.member.permissions.has('Administrator')) return message.reply('❌ Administrator only.');

        await message.channel.send({
            embeds: [new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle('📉 Demotion Review Panel')
                .setDescription(
                    'HR and Management can submit demotion recommendations here.\n\n' +
                    '**Automatic demotion triggers:**\n' +
                    '• 3 active strikes\n' +
                    '• Extended inactivity without LOA\n' +
                    '• Failed performance review\n' +
                    '• Policy violations'
                )
                .setFooter({ text: 'Demotion System • Accountability enforcement' })
            ],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('promo_demotion').setLabel('📉 Submit Demotion').setStyle(ButtonStyle.Danger)
            )]
        });

        await message.reply('✅ Demotion panel posted.');
    }

    // ── !promote (manual) ─────────────────────────────────────────────────────
    if (command === 'promote') {
        if (!isHR) return message.reply('❌ HR role required.');
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Usage: `!promote @user <new rank name> <reason>`');
        const rest  = args.slice(1).join(' ');
        await createPromoDecision(message.guild, cfg, target, message.member, 'promotion', rest || 'Promotion approved by HR.');
        message.reply('✅ Promotion logged and posted to log channel.');
    }

    // ── !checkpromotion ───────────────────────────────────────────────────────
    if (command === 'checkpromotion') {
        const target = message.mentions.members.first() || message.member;
        const uid    = target.id;
        const staffDb = load('staffData', {});
        const rec    = staffDb[gid]?.[uid];
        const actDb  = load('activity', {});
        const act    = actDb[gid]?.[uid] || { messages: 0, score: 0 };

        const embed = new EmbedBuilder().setColor(0x3498db)
            .setTitle(`📊 Promotion Check — ${target.user.tag}`)
            .addFields(
                { name: '🔴 Active Strikes', value: `${rec?.activeStrikes || 0}`, inline: true },
                { name: '⚠️ Warnings',       value: `${rec?.warnings?.length || 0}`, inline: true },
                { name: '🔴 Suspended',      value: rec?.isSuspended ? 'Yes' : 'No', inline: true },
                { name: '💬 Activity Score', value: `${act.score}`, inline: true },
                { name: '🎓 Trainings',      value: `${rec?.trainings?.length || 0}`, inline: true },
                { name: '📈 Promotions',     value: `${rec?.promotions?.length || 0}`, inline: true }
            );

        const eligible = !rec?.isSuspended && !rec?.isTerminated && (rec?.activeStrikes || 0) < 2;
        embed.setDescription(eligible
            ? '✅ **Eligible for promotion review.** Submit a promotion request or contact HR.'
            : '❌ **Not currently eligible.** Resolve active strikes or suspension first.'
        );

        return message.reply({ embeds: [embed] });
    }
}

// ── Helper: create promo/demotion log entry ───────────────────────────────────

async function createPromoDecision(guild, cfg, target, mod, type, reason) {
    const gid    = guild.id;
    const db     = load('staffData', {});
    if (!db[gid]) db[gid] = {};
    if (!db[gid][target.id]) db[gid][target.id] = { promotions: [], demotions: [] };

    const key    = type === 'promotion' ? 'promotions' : 'demotions';
    const entry  = { reason, by: mod.id, date: Date.now() };
    db[gid][target.id][key] = db[gid][target.id][key] || [];
    db[gid][target.id][key].push(entry);
    save('staffData', db);

    const embed = new EmbedBuilder()
        .setColor(type === 'promotion' ? 0x3498db : 0xe74c3c)
        .setTitle(type === 'promotion' ? '📈 Promotion Logged' : '📉 Demotion Logged')
        .addFields(
            { name: '👤 Staff Member', value: `<@${target.id}> (${target.user.tag})`, inline: true },
            { name: '🛡️ Approved By',  value: `<@${mod.id}> (${mod.user.tag})`,      inline: true },
            { name: '📋 Reason',        value: reason,                                inline: false },
            { name: '📅 Date',          value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        );

    const logChId = type === 'promotion' ? cfg.logs?.promotions : cfg.logs?.moderation;
    const logCh   = guild.channels.cache.get(logChId);
    if (logCh) await logCh.send({ embeds: [embed] }).catch(() => {});
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    const gid = interaction.guild.id;
    const cfg = getCfg(gid);

    // ── Promotion request modal ────────────────────────────────────────────────
    if (interaction.customId === 'promo_request') {
        return interaction.showModal(
            new ModalBuilder().setCustomId('promo_modal').setTitle('📈 Promotion Request')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('promo_current').setLabel('Current Rank/Role')
                            .setStyle(TextInputStyle.Short).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('promo_desired').setLabel('Requested Rank/Role')
                            .setStyle(TextInputStyle.Short).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('promo_reason').setLabel('Why do you deserve this promotion?')
                            .setStyle(TextInputStyle.Paragraph).setMinLength(30).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('promo_trainings').setLabel('Completed Trainings (list them)')
                            .setStyle(TextInputStyle.Paragraph).setRequired(false)
                    )
                )
        );
    }

    // ── Demotion submit modal ──────────────────────────────────────────────────
    if (interaction.customId === 'promo_demotion') {
        const hrRoles = [...(cfg.hrRoles || []), ...(cfg.mgmtRoles || [])];
        if (!interaction.member.permissions.has('Administrator') && !hrRoles.some(r => interaction.member.roles.cache.has(r))) {
            return interaction.reply({ content: '❌ HR role required to submit demotions.', ephemeral: true });
        }
        return interaction.showModal(
            new ModalBuilder().setCustomId('promo_demotion_modal').setTitle('📉 Demotion Recommendation')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('demote_user').setLabel('Staff Member (Discord Username or ID)')
                            .setStyle(TextInputStyle.Short).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('demote_reason').setLabel('Reason for Demotion')
                            .setStyle(TextInputStyle.Paragraph).setMinLength(20).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('demote_evidence').setLabel('Evidence / Supporting Information')
                            .setStyle(TextInputStyle.Paragraph).setRequired(false)
                    )
                )
        );
    }

    // ── Promotion modal submitted ──────────────────────────────────────────────
    if (interaction.customId === 'promo_modal') {
        const current   = interaction.fields.getTextInputValue('promo_current');
        const desired   = interaction.fields.getTextInputValue('promo_desired');
        const reason    = interaction.fields.getTextInputValue('promo_reason');
        const trainings = interaction.fields.getTextInputValue('promo_trainings') || 'None listed';

        await interaction.deferReply({ ephemeral: true });

        const channel = await interaction.guild.channels.create({
            name: `promo-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
            type: ChannelType.GuildText,
            parent: cfg.promoCategoryId || null,
            permissionOverwrites: [
                { id: interaction.guild.id,      deny:  [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
                { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
                ...[...(cfg.hrRoles || []), ...(cfg.mgmtRoles || [])].map(id => ({
                    id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                }))
            ]
        }).catch(() => null);

        if (!channel) return interaction.editReply('❌ Failed to create promotion channel. Check bot permissions.');
        await interaction.editReply({ content: `✅ Promotion request submitted: ${channel}` });

        const embed = new EmbedBuilder().setColor(0x3498db).setTitle('📈 Promotion Candidate')
            .setThumbnail(interaction.user.displayAvatarURL())
            .addFields(
                { name: '👤 Candidate',       value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                { name: '📅 Submitted',        value: `<t:${Math.floor(Date.now() / 1000)}:F>`,             inline: true },
                { name: '🏅 Current Rank',     value: current,                                              inline: true },
                { name: '📈 Requested Rank',   value: desired,                                              inline: true },
                { name: '🎓 Trainings',        value: trainings,                                            inline: false },
                { name: '📋 Justification',    value: reason,                                               inline: false }
            )
            .setFooter({ text: 'Awaiting HR/Management review' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`promo_approve_${channel.id}_${interaction.user.id}`).setLabel('✅ Approve Promotion').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`promo_deny_${channel.id}_${interaction.user.id}`).setLabel('❌ Deny Promotion').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`promo_close_${channel.id}`).setLabel('🔒 Close').setStyle(ButtonStyle.Secondary)
        );

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
        const logCh = interaction.guild.channels.cache.get(cfg.logs?.promotions);
        if (logCh) logCh.send({ embeds: [embed] });
    }

    // ── Demotion modal submitted ───────────────────────────────────────────────
    if (interaction.customId === 'promo_demotion_modal') {
        const userInput = interaction.fields.getTextInputValue('demote_user');
        const reason    = interaction.fields.getTextInputValue('demote_reason');
        const evidence  = interaction.fields.getTextInputValue('demote_evidence') || 'None provided';

        const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle('📉 Demotion Recommendation')
            .addFields(
                { name: '👤 Staff Member',  value: userInput,                                               inline: true },
                { name: '🛡️ Submitted By', value: `<@${interaction.user.id}> (${interaction.user.tag})`,   inline: true },
                { name: '📋 Reason',         value: reason,                                                 inline: false },
                { name: '📎 Evidence',       value: evidence,                                               inline: false },
                { name: '📅 Date',           value: `<t:${Math.floor(Date.now() / 1000)}:F>`,              inline: true }
            )
            .setFooter({ text: 'Awaiting management approval' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`promo_denappr_${interaction.user.id}`).setLabel('✅ Approve Demotion').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`promo_dendeny_${interaction.user.id}`).setLabel('❌ Deny Recommendation').setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
        const logCh = interaction.guild.channels.cache.get(cfg.logs?.moderation);
        if (logCh) logCh.send({ embeds: [embed] });
    }

    // ── Approve/Deny promotion ─────────────────────────────────────────────────
    if (interaction.customId.startsWith('promo_approve_') || interaction.customId.startsWith('promo_deny_')) {
        const isApprove = interaction.customId.startsWith('promo_approve_');
        const parts     = interaction.customId.split('_');
        const channelId = parts[2];
        const userId    = parts[3];
        const hrRoles   = [...(cfg.hrRoles || []), ...(cfg.mgmtRoles || [])];

        if (!interaction.member.permissions.has('Administrator') && !hrRoles.some(r => interaction.member.roles.cache.has(r))) {
            return interaction.reply({ content: '❌ HR/Management role required.', ephemeral: true });
        }

        const ch = interaction.guild.channels.cache.get(channelId);
        if (ch) await ch.send({ embeds: [new EmbedBuilder()
            .setColor(isApprove ? 0x57f287 : 0xed4245)
            .setTitle(isApprove ? '✅ Promotion Approved' : '❌ Promotion Denied')
            .setDescription(isApprove
                ? `Your promotion request has been **approved** by <@${interaction.user.id}>! Congratulations! 🎉`
                : `Your promotion request has been **denied** by <@${interaction.user.id}>. Please continue working hard and reapply when ready.`
            )] });

        if (isApprove) {
            const db = load('staffData', {});
            if (!db[gid]) db[gid] = {};
            if (!db[gid][userId]) db[gid][userId] = { promotions: [] };
            db[gid][userId].promotions = db[gid][userId].promotions || [];
            db[gid][userId].promotions.push({ by: interaction.user.id, date: Date.now() });
            save('staffData', db);
        }

        await interaction.update({ components: [] });
        setTimeout(() => ch?.delete().catch(() => {}), 10_000);
    }

    // ── Close promo channel ────────────────────────────────────────────────────
    if (interaction.customId.startsWith('promo_close_')) {
        const channelId = interaction.customId.slice('promo_close_'.length);
        const ch = interaction.guild.channels.cache.get(channelId);
        await interaction.reply({ content: '🔒 Closing in 5 seconds...', ephemeral: true });
        setTimeout(() => ch?.delete().catch(() => {}), 5_000);
    }
}

module.exports = { handleCommand, handleInteraction };
