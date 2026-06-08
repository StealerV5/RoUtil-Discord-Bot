// systems/loa.js — Leave of Absence panel, request tickets, and approval
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, PermissionFlagsBits, ModalBuilder,
    TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder
} = require('discord.js');
const { load, save } = require('../db');

function getCfg(gid)  { return load('modConfig', {})[gid] || {}; }
function getLoaDb()   { return load('loa', {}); }
function saveLoaDb(d) { save('loa', d); }

// ── !loasetup ─────────────────────────────────────────────────────────────────

async function handleCommand(message, command) {
    const gid = message.guild.id;
    const cfg = getCfg(gid);

    if (!message.member.permissions.has('Administrator') &&
        !(cfg.hrRoles || []).some(r => message.member.roles.cache.has(r))) {
        return message.reply('❌ Administrator or HR role required.');
    }

    if (command === 'loasetup') {
        // Send the LOA request panel
        await message.reply('✅ Posting the LOA panel...');
        await message.channel.send({
            embeds: [new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('🌴 Leave of Absence Request')
                .setDescription(
                    'Need time away from your staff duties? Submit a **Leave of Absence** request using the button below.\n\n' +
                    '**Your LOA will:**\n' +
                    '• Pause inactivity tracking\n' +
                    '• Prevent automatic demotion for inactivity\n' +
                    '• Be reviewed and approved by HR\n\n' +
                    '**Please provide a start date, end date, and reason.**'
                )
                .setFooter({ text: 'LOA System • Honest, transparent leave management' })
            ],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('loa_create').setLabel('🌴 Submit LOA Request').setStyle(ButtonStyle.Success)
            )]
        });
    }

    if (command === 'loaend') {
        // Manually end own LOA
        const db = getLoaDb();
        if (!db[gid]?.[message.author.id]?.active) {
            return message.reply('❌ You don\'t have an active LOA.');
        }
        db[gid][message.author.id].active = false;
        const staffDb = load('staffData', {});
        if (staffDb[gid]?.[message.author.id]) {
            staffDb[gid][message.author.id].isLOA = false;
        }
        save('staffData', staffDb);
        saveLoaDb(db);

        const logCh = message.guild.channels.cache.get(cfg.logs?.loa);
        if (logCh) logCh.send({ embeds: [new EmbedBuilder().setColor(0x57f287)
            .setTitle('✅ LOA Ended').setDescription(`<@${message.author.id}> has returned from Leave of Absence.`)] });

        return message.reply('✅ Your LOA has been ended. Welcome back!');
    }
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    const gid = interaction.guild.id;
    const cfg = getCfg(gid);

    // ── Open LOA modal ────────────────────────────────────────────────────────
    if (interaction.customId === 'loa_create') {
        return interaction.showModal(
            new ModalBuilder()
                .setCustomId('loa_modal')
                .setTitle('🌴 Leave of Absence Request')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('loa_reason')
                            .setLabel('Reason for LOA').setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('Explain why you need to take a leave of absence...')
                            .setMinLength(10).setMaxLength(500).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('loa_start')
                            .setLabel('Start Date (e.g. June 10, 2026)').setStyle(TextInputStyle.Short)
                            .setRequired(true).setMaxLength(30)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('loa_end')
                            .setLabel('End Date (e.g. June 20, 2026)').setStyle(TextInputStyle.Short)
                            .setRequired(true).setMaxLength(30)
                    )
                )
        );
    }

    // ── LOA modal submitted ───────────────────────────────────────────────────
    if (interaction.customId === 'loa_modal') {
        const reason    = interaction.fields.getTextInputValue('loa_reason');
        const startDate = interaction.fields.getTextInputValue('loa_start');
        const endDate   = interaction.fields.getTextInputValue('loa_end');

        await interaction.deferReply({ ephemeral: true });

        // Create private LOA review channel
        const modRoles = [...(cfg.modRoles || []), ...(cfg.hrRoles || [])];
        const channel  = await interaction.guild.channels.create({
            name: `loa-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
            type: ChannelType.GuildText,
            parent: cfg.loaCategoryId || null,
            permissionOverwrites: [
                { id: interaction.guild.id,       deny:  [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
                { id: interaction.client.user.id,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
                ...modRoles.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
            ]
        }).catch(() => null);

        if (!channel) {
            return interaction.editReply('❌ Failed to create LOA channel. Check bot permissions and category settings.');
        }

        await interaction.editReply({ content: `✅ Your LOA request has been submitted: ${channel}` });

        const embed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('🌴 LOA Request')
            .addFields(
                { name: '👤 Staff Member', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                { name: '📅 Submitted',    value: `<t:${Math.floor(Date.now() / 1000)}:F>`,             inline: true },
                { name: '🗓️ Start Date',  value: startDate,                                             inline: true },
                { name: '🗓️ End Date',    value: endDate,                                               inline: true },
                { name: '📋 Reason',       value: reason,                                               inline: false }
            )
            .setFooter({ text: 'Awaiting HR review' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`loa_approve_${channel.id}_${interaction.user.id}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`loa_deny_${channel.id}_${interaction.user.id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`loa_close_${channel.id}`).setLabel('🔒 Close').setStyle(ButtonStyle.Secondary)
        );

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });

        // Also log to LOA log channel
        const logCh = interaction.guild.channels.cache.get(cfg.logs?.loa);
        if (logCh) logCh.send({ embeds: [embed] });

        // Store pending LOA
        const db = getLoaDb();
        if (!db[gid]) db[gid] = {};
        if (!db[gid][interaction.user.id]) db[gid][interaction.user.id] = { active: false, history: [] };
        db[gid][interaction.user.id].pending = { reason, startDate, endDate, channelId: channel.id, submitted: Date.now() };
        saveLoaDb(db);
    }

    // ── Approve LOA ────────────────────────────────────────────────────────────
    if (interaction.customId.startsWith('loa_approve_')) {
        const [, , channelId, userId] = interaction.customId.split('_');
        const hrRoles = [...(cfg.hrRoles || []), ...(cfg.mgmtRoles || [])];
        if (!interaction.member.permissions.has('Administrator') && !hrRoles.some(r => interaction.member.roles.cache.has(r))) {
            return interaction.reply({ content: '❌ HR role required to approve LOA.', ephemeral: true });
        }

        const db     = getLoaDb();
        const record = db[gid]?.[userId];
        if (record?.pending) {
            record.active   = true;
            record.history  = record.history || [];
            record.history.push({ ...record.pending, approvedBy: interaction.user.id, approved: true });
            Object.assign(record, record.pending);
            delete record.pending;
            saveLoaDb(db);

            // Mark in staff data
            const staffDb = load('staffData', {});
            if (staffDb[gid]?.[userId]) { staffDb[gid][userId].isLOA = true; save('staffData', staffDb); }
        }

        const ch = interaction.guild.channels.cache.get(channelId);
        if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0x57f287)
            .setTitle('✅ LOA Approved').setDescription(`Your LOA has been **approved** by <@${interaction.user.id}>.\n\nEnjoy your time off! Remember to submit \`!loaend\` when you return.`)] });

        await interaction.update({ components: [] });

        const logCh = interaction.guild.channels.cache.get(cfg.logs?.loa);
        if (logCh) logCh.send({ embeds: [new EmbedBuilder().setColor(0x57f287)
            .setTitle('✅ LOA Approved').addFields(
                { name: 'Staff Member', value: `<@${userId}>`,              inline: true },
                { name: 'Approved By', value: interaction.user.tag,         inline: true }
            )] });
    }

    // ── Deny LOA ───────────────────────────────────────────────────────────────
    if (interaction.customId.startsWith('loa_deny_')) {
        const [, , channelId, userId] = interaction.customId.split('_');
        const hrRoles = [...(cfg.hrRoles || []), ...(cfg.mgmtRoles || [])];
        if (!interaction.member.permissions.has('Administrator') && !hrRoles.some(r => interaction.member.roles.cache.has(r))) {
            return interaction.reply({ content: '❌ HR role required to deny LOA.', ephemeral: true });
        }

        const db = getLoaDb();
        if (db[gid]?.[userId]) { delete db[gid][userId].pending; saveLoaDb(db); }

        const ch = interaction.guild.channels.cache.get(channelId);
        if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0xed4245)
            .setTitle('❌ LOA Denied').setDescription(`Your LOA request has been **denied** by <@${interaction.user.id}>.`)] });

        await interaction.update({ components: [] });
    }

    // ── Close LOA channel ──────────────────────────────────────────────────────
    if (interaction.customId.startsWith('loa_close_')) {
        const channelId = interaction.customId.slice('loa_close_'.length);
        const ch = interaction.guild.channels.cache.get(channelId);
        if (ch) {
            await interaction.reply({ content: '🔒 Closing channel in 5 seconds...', ephemeral: true });
            setTimeout(() => ch.delete().catch(() => {}), 5_000);
        }
    }
}

module.exports = { handleCommand, handleInteraction };
