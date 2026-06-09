// systems/config.js — All setup commands for the staff management system
const {
    EmbedBuilder, ActionRowBuilder,
    RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType,
    ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');
const { load, save } = require('../db');

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCfg(gid) {
    const db = load('modConfig', {});
    if (!db[gid]) db[gid] = {};
    return { db, cfg: db[gid] };
}
function saveCfg(db) { save('modConfig', db); }

// Setup wizard state (in-memory, expires after 10 min)
const setupState = new Map();
function expireState(gid, authorId) {
    setTimeout(() => {
        const s = setupState.get(gid);
        if (s?.authorId === authorId) setupState.delete(gid);
    }, 600_000);
}

// ── Command handler ───────────────────────────────────────────────────────────

async function handleCommand(message, command) {
    if (!message.member.permissions.has('Administrator')) {
        return message.reply('❌ Administrator permission required for setup commands.');
    }
    const gid = message.guild.id;

    // ── !setupmod ─────────────────────────────────────────────────────────────
    if (command === 'setupmod') {
        setupState.set(gid, { authorId: message.author.id, step: 'mod_roles', data: {} });
        expireState(gid, message.author.id);

        return message.reply({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('⚙️ Staff Mod Setup — Step 1: Moderator Roles')
                .setDescription('Select all **Moderator Roles**. These roles can issue warnings, strikes, notes, and suspensions.')
                .addFields({ name: '📋 Steps', value: '1. Moderator Roles\n2. HR Roles\n3. Management Roles\n4. Roblox Group ID (reply with it)', inline: false })
                .setFooter({ text: 'Select all applicable roles • Expires in 10 minutes' })],
            components: [new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder().setCustomId(`cfg_modroles_${gid}`).setPlaceholder('Select Moderator Roles...').setMinValues(1).setMaxValues(20)
            )]
        });
    }

    // ── !setuplogs ────────────────────────────────────────────────────────────
    if (command === 'setuplogs') {
        setupState.set(gid, { authorId: message.author.id, step: 'log_mod', data: {} });
        expireState(gid, message.author.id);

        return message.reply({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('📋 Log Channel Setup — Step 1: Moderation Logs')
                .setDescription('Select the channel for **Moderation Logs** (warnings, strikes, suspensions, bans).')
                .addFields({ name: '📋 Log Channels', value: '1. Moderation Logs\n2. Promotion/Demotion Logs\n3. Appeal Logs\n4. Training Logs\n5. Feedback Logs\n6. LOA Logs', inline: false })
                .setFooter({ text: 'Step 1 of 6 • Expires in 10 minutes' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId(`cfg_log_mod_${gid}`).setPlaceholder('Select moderation log channel...').setChannelTypes(ChannelType.GuildText)
            )]
        });
    }

    // ── !setupranks ───────────────────────────────────────────────────────────
    if (command === 'setupranks') {
        const { cfg } = getCfg(gid);
        return message.reply({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('🏅 Rank Configuration')
                .setDescription(
                    'Reply with rank data in this format (one per line):\n```\n<RobloxRankID> | <RankName> | <DiscordRoleID>\n```\nExample:\n```\n5 | Trainee | 1234567890\n10 | Officer | 9876543210\n255 | Director | 1122334455\n```'
                )
                .setFooter({ text: 'Reply within 5 minutes' })],
        });
    }

    // ── !setupdepartments ──────────────────────────────────────────────────────
    if (command === 'setupdepartments') {
        const depts = ['Administration', 'Moderation', 'Human Resources', 'Internal Affairs', 'Development', 'Security'];
        return message.reply({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('🏢 Department Setup')
                .setDescription(
                    'Departments are pre-configured. Assign roles to each department by replying with:\n```\n<Department> | <RoleID>\n```\n\n**Available Departments:**\n' +
                    depts.map((d, i) => `${i + 1}. ${d}`).join('\n')
                )
                .setFooter({ text: 'Reply within 5 minutes' })],
        });
    }

    // ── !setuproles ───────────────────────────────────────────────────────────
    if (command === 'setuproles') {
        setupState.set(gid, { authorId: message.author.id, step: 'hr_roles', data: {} });
        expireState(gid, message.author.id);

        return message.reply({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('🛡️ Role Configuration — HR Roles')
                .setDescription('Select **HR Roles**. These can issue terminations, bans, and approve promotions.')
                .setFooter({ text: 'Step 1 of 2 • Expires in 10 minutes' })],
            components: [new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder().setCustomId(`cfg_hrroles_${gid}`).setPlaceholder('Select HR Roles...').setMinValues(1).setMaxValues(10)
            )]
        });
    }
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    const gid   = interaction.guild.id;
    const state = setupState.get(gid);

    if (!state) return;
    if (interaction.user.id !== state.authorId) {
        return interaction.reply({ content: '❌ Only the setup initiator can interact with this.', ephemeral: true });
    }

    const { db, cfg } = getCfg(gid);

    // ── Moderator roles ───────────────────────────────────────────────────────
    if (interaction.customId === `cfg_modroles_${gid}`) {
        cfg.modRoles = interaction.values;
        saveCfg(db);
        state.step = 'hr_roles';
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('⚙️ Staff Mod Setup — Step 2: HR Roles')
                .setDescription('Select all **HR Roles**. These can issue terminations, bans, approve promotions, and override moderation decisions.')
                .addFields({ name: '✅ Mod Roles Saved', value: cfg.modRoles.map(r => `<@&${r}>`).join(', '), inline: false })
                .setFooter({ text: 'Step 2 of 4' })],
            components: [new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder().setCustomId(`cfg_hrroles_${gid}`).setPlaceholder('Select HR Roles...').setMinValues(1).setMaxValues(10)
            )]
        });
    }

    // ── HR roles ──────────────────────────────────────────────────────────────
    if (interaction.customId === `cfg_hrroles_${gid}`) {
        cfg.hrRoles = interaction.values;
        saveCfg(db);
        state.step = 'mgmt_roles';
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('⚙️ Staff Mod Setup — Step 3: Management Roles')
                .setDescription('Select all **Management / High Command** Roles. These have full access to all systems.')
                .addFields({ name: '✅ HR Roles Saved', value: cfg.hrRoles.map(r => `<@&${r}>`).join(', '), inline: false })
                .setFooter({ text: 'Step 3 of 4' })],
            components: [new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder().setCustomId(`cfg_mgmtroles_${gid}`).setPlaceholder('Select Management Roles...').setMinValues(1).setMaxValues(10)
            )]
        });
    }

    // ── Management roles ──────────────────────────────────────────────────────
    if (interaction.customId === `cfg_mgmtroles_${gid}`) {
        cfg.mgmtRoles = interaction.values;
        saveCfg(db);
        state.step = 'group_id';
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('⚙️ Staff Mod Setup — Step 4: Roblox Group ID')
                .setDescription('Reply with your **Roblox Group ID** in this channel within 2 minutes.\nType `none` to skip this step.')
                .addFields({ name: '✅ Management Roles Saved', value: cfg.mgmtRoles.map(r => `<@&${r}>`).join(', '), inline: false })
                .setFooter({ text: 'Step 4 of 4 • Reply with Group ID or "none" to skip' })],
            components: []
        });

        // Collect the group ID reply — accept a numeric ID or the word "none"
        const filter  = m => m.author.id === interaction.user.id &&
            (/^\d+$/.test(m.content.trim()) || m.content.trim().toLowerCase() === 'none');
        const replies = await interaction.channel.awaitMessages({ filter, max: 1, time: 120_000 }).catch(() => null);
        if (replies?.size) {
            const answer = replies.first().content.trim();
            cfg.robloxGroupId = answer.toLowerCase() === 'none' ? null : answer;
            saveCfg(db);
            setupState.delete(gid);
            await interaction.channel.send({
                embeds: [new EmbedBuilder().setColor(0x57f287)
                    .setTitle('✅ Staff Mod Setup Complete!')
                    .addFields(
                        { name: '🛡️ Mod Roles',   value: cfg.modRoles.map(r => `<@&${r}>`).join(', '),  inline: false },
                        { name: '⚖️ HR Roles',    value: cfg.hrRoles.map(r => `<@&${r}>`).join(', '),   inline: false },
                        { name: '🏛️ Mgmt Roles', value: cfg.mgmtRoles.map(r => `<@&${r}>`).join(', '), inline: false },
                        { name: '🎮 Group ID',    value: cfg.robloxGroupId ?? 'Not set',                  inline: true  }
                    )
                    .setDescription('Use `!setuplogs` next to configure log channels.')
                ]
            });
        }
    }

    // ── Log channel — moderation ───────────────────────────────────────────────
    if (interaction.customId === `cfg_log_mod_${gid}`) {
        if (!cfg.logs) cfg.logs = {};
        cfg.logs.moderation = interaction.values[0];
        saveCfg(db);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('📋 Log Channel Setup — Step 2: Promotion Logs')
                .setDescription('Select the channel for **Promotion & Demotion Logs**.')
                .addFields({ name: '✅ Moderation Log', value: `<#${cfg.logs.moderation}>`, inline: true })
                .setFooter({ text: 'Step 2 of 6' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId(`cfg_log_promo_${gid}`).setPlaceholder('Select promotion log channel...').setChannelTypes(ChannelType.GuildText)
            )]
        });
    }

    if (interaction.customId === `cfg_log_promo_${gid}`) {
        cfg.logs.promotions = interaction.values[0];
        saveCfg(db);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('📋 Log Channel Setup — Step 3: Appeal Logs')
                .setDescription('Select the channel for **Appeal Logs**.')
                .setFooter({ text: 'Step 3 of 6' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId(`cfg_log_appeal_${gid}`).setPlaceholder('Select appeal log channel...').setChannelTypes(ChannelType.GuildText)
            )]
        });
    }

    if (interaction.customId === `cfg_log_appeal_${gid}`) {
        cfg.logs.appeals = interaction.values[0];
        saveCfg(db);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('📋 Log Channel Setup — Step 4: Training Logs')
                .setDescription('Select the channel for **Training Logs**.')
                .setFooter({ text: 'Step 4 of 6' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId(`cfg_log_train_${gid}`).setPlaceholder('Select training log channel...').setChannelTypes(ChannelType.GuildText)
            )]
        });
    }

    if (interaction.customId === `cfg_log_train_${gid}`) {
        cfg.logs.training = interaction.values[0];
        saveCfg(db);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('📋 Log Channel Setup — Step 5: Feedback Logs')
                .setDescription('Select the channel for **Feedback Logs**.')
                .setFooter({ text: 'Step 5 of 6' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId(`cfg_log_feedback_${gid}`).setPlaceholder('Select feedback log channel...').setChannelTypes(ChannelType.GuildText)
            )]
        });
    }

    if (interaction.customId === `cfg_log_feedback_${gid}`) {
        cfg.logs.feedback = interaction.values[0];
        saveCfg(db);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
                .setTitle('📋 Log Channel Setup — Step 6: LOA Logs')
                .setDescription('Select the channel for **Leave of Absence Logs**.')
                .setFooter({ text: 'Step 6 of 6 • Final step!' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId(`cfg_log_loa_${gid}`).setPlaceholder('Select LOA log channel...').setChannelTypes(ChannelType.GuildText)
            )]
        });
    }

    if (interaction.customId === `cfg_log_loa_${gid}`) {
        cfg.logs.loa = interaction.values[0];
        saveCfg(db);
        setupState.delete(gid);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x57f287)
                .setTitle('✅ Log Channel Setup Complete!')
                .addFields(
                    { name: '🔨 Moderation',   value: `<#${cfg.logs.moderation}>`,  inline: true },
                    { name: '📈 Promotions',   value: `<#${cfg.logs.promotions}>`,  inline: true },
                    { name: '⚖️ Appeals',      value: `<#${cfg.logs.appeals}>`,     inline: true },
                    { name: '🎓 Training',     value: `<#${cfg.logs.training}>`,    inline: true },
                    { name: '💬 Feedback',     value: `<#${cfg.logs.feedback}>`,    inline: true },
                    { name: '🌴 LOA',          value: `<#${cfg.logs.loa}>`,         inline: true }
                )
            ],
            components: []
        });
    }
}

module.exports = { handleCommand, handleInteraction, setupState };
