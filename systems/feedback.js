// systems/feedback.js — Staff feedback panel, ticket collection, and logging
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionFlagsBits, StringSelectMenuBuilder
} = require('discord.js');
const { load, save } = require('../db');

function getCfg(gid) { return load('modConfig', {})[gid] || {}; }

// ── !feedbacksetup ────────────────────────────────────────────────────────────

async function handleCommand(message) {
    if (!message.member.permissions.has('Administrator')) return message.reply('❌ Administrator only.');

    await message.channel.send({
        embeds: [new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('💬 Staff Feedback System')
            .setDescription(
                'Have feedback about a staff member? You can submit it anonymously or with your name attached.\n\n' +
                '**Your feedback helps us:**\n' +
                '• Recognize outstanding staff performance\n' +
                '• Identify areas for improvement\n' +
                '• Maintain a high standard of conduct\n\n' +
                'All feedback is reviewed by HR and Management.'
            )
            .setFooter({ text: 'Feedback System • Your voice matters' })
        ],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fb_positive').setLabel('⭐ Positive Feedback').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('fb_negative').setLabel('⚠️ Concern / Issue').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('fb_general').setLabel('💬 General Feedback').setStyle(ButtonStyle.Primary)
        )]
    });

    await message.reply('✅ Feedback panel posted.');
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    const gid = interaction.guild.id;
    const cfg = getCfg(gid);

    const typeMap = {
        'fb_positive': { title: '⭐ Positive Feedback',    color: 0x57f287, label: 'Positive' },
        'fb_negative': { title: '⚠️ Staff Concern / Issue', color: 0xe74c3c, label: 'Concern' },
        'fb_general':  { title: '💬 General Feedback',     color: 0x9b59b6, label: 'General' }
    };

    if (typeMap[interaction.customId]) {
        const type = typeMap[interaction.customId];
        return interaction.showModal(
            new ModalBuilder().setCustomId(`fb_modal_${interaction.customId.replace('fb_', '')}`)
                .setTitle(type.title)
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('fb_staff').setLabel('Staff Member (Username or @mention)')
                            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('fb_dept').setLabel('Department (if known)')
                            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('fb_rating').setLabel('Rating (1-5)')
                            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1)
                            .setPlaceholder('Enter a number between 1 and 5')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('fb_details').setLabel('Detailed Feedback')
                            .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(20).setMaxLength(1000)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('fb_anon').setLabel('Submit Anonymously? (yes/no)')
                            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)
                            .setPlaceholder('yes or no')
                    )
                )
        );
    }

    // ── Feedback modal submitted ───────────────────────────────────────────────
    if (interaction.customId.startsWith('fb_modal_')) {
        const typeKey = interaction.customId.slice('fb_modal_'.length);
        const label   = typeMap[`fb_${typeKey}`]?.label || 'General';
        const color   = typeMap[`fb_${typeKey}`]?.color || 0x9b59b6;

        const staff   = interaction.fields.getTextInputValue('fb_staff');
        const dept    = interaction.fields.getTextInputValue('fb_dept') || 'Unknown';
        const rating  = interaction.fields.getTextInputValue('fb_rating');
        const details = interaction.fields.getTextInputValue('fb_details');
        const anon    = interaction.fields.getTextInputValue('fb_anon').toLowerCase().startsWith('y');

        const ratingNum = parseInt(rating);
        if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return interaction.reply({ content: '❌ Rating must be between 1 and 5.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // Create feedback ticket channel (private, only HR can see)
        const hrRoles = [...(cfg.hrRoles || []), ...(cfg.mgmtRoles || [])];
        const channel = await interaction.guild.channels.create({
            name: `feedback-${String(Date.now()).slice(-5)}`,
            type: ChannelType.GuildText,
            parent: cfg.feedbackCategoryId || null,
            permissionOverwrites: [
                { id: interaction.guild.id,      deny:  [PermissionFlagsBits.ViewChannel] },
                { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
                ...hrRoles.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
            ]
        }).catch(() => null);

        await interaction.editReply({ content: '✅ Your feedback has been submitted. Thank you!' });

        const stars = '⭐'.repeat(ratingNum) + '☆'.repeat(5 - ratingNum);
        const embed = new EmbedBuilder().setColor(color)
            .setTitle(`💬 ${label} Feedback`)
            .addFields(
                { name: '👤 Submitted By', value: anon ? '🔒 Anonymous' : `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                { name: '🎯 About',        value: staff,                                                                           inline: true },
                { name: '🏢 Department',   value: dept,                                                                            inline: true },
                { name: '⭐ Rating',       value: `${stars} (${ratingNum}/5)`,                                                    inline: true },
                { name: '📅 Date',         value: `<t:${Math.floor(Date.now() / 1000)}:F>`,                                       inline: true },
                { name: '📋 Feedback',     value: details,                                                                         inline: false }
            )
            .setFooter({ text: `Type: ${label}` });

        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`fb_resolve_${channel?.id || 'none'}`).setLabel('✅ Mark Resolved').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`fb_close_${channel?.id || 'none'}`).setLabel('🔒 Close').setStyle(ButtonStyle.Secondary)
        );

        if (channel) await channel.send({ embeds: [embed], components: [closeRow] });

        // Log to feedback log channel
        const logCh = interaction.guild.channels.cache.get(cfg.logs?.feedback);
        if (logCh) logCh.send({ embeds: [embed] });

        // Store feedback rating in staff data
        const fbDb = load('feedbackData', {});
        if (!fbDb[gid]) fbDb[gid] = {};
        if (!fbDb[gid].entries) fbDb[gid].entries = [];
        fbDb[gid].entries.push({
            type: label, staff, dept, rating: ratingNum, details,
            anonymous: anon, submitter: anon ? null : interaction.user.id,
            date: Date.now()
        });
        save('feedbackData', fbDb);
    }

    // ── Resolve feedback ───────────────────────────────────────────────────────
    if (interaction.customId.startsWith('fb_resolve_') || interaction.customId.startsWith('fb_close_')) {
        const channelId = interaction.customId.split('_').pop();
        const ch = interaction.guild.channels.cache.get(channelId);
        if (interaction.customId.startsWith('fb_resolve_')) {
            await interaction.reply({ content: '✅ Feedback marked as resolved.', ephemeral: true });
            await interaction.message.edit({ components: [] });
        } else {
            await interaction.reply({ content: '🔒 Closing channel in 5 seconds...', ephemeral: true });
            setTimeout(() => ch?.delete().catch(() => {}), 5_000);
        }
    }
}

module.exports = { handleCommand, handleInteraction };
