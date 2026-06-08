// systems/training.js — Training creation, hosting, completion, and records
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { load, save } = require('../db');

function getCfg(gid)    { return load('modConfig', {})[gid] || {}; }
function getTrainDb()   { return load('trainings', {}); }
function saveTrainDb(d) { save('trainings', d); }

function isAllowed(member, cfg) {
    if (member.permissions.has('Administrator')) return true;
    return [...(cfg.modRoles || []), ...(cfg.hrRoles || [])].some(r => member.roles.cache.has(r));
}

// ── Command handler ───────────────────────────────────────────────────────────

async function handleCommand(message, command, args) {
    const gid = message.guild.id;
    const cfg = getCfg(gid);

    if (!isAllowed(message.member, cfg)) {
        return message.reply('❌ Moderator or HR role required for training commands.');
    }

    // ── !trainingcreate <name> | <description> ────────────────────────────────
    if (command === 'trainingcreate') {
        const full  = args.join(' ');
        const [name, ...descParts] = full.split('|');
        if (!name?.trim()) return message.reply('❌ Usage: `!trainingcreate <name> | <description>`');

        const db = getTrainDb();
        if (!db[gid]) db[gid] = { sessions: [], next: 1 };

        const id      = `TRAIN-${String(db[gid].next++).padStart(4, '0')}`;
        const session = {
            id, name: name.trim(),
            description: descParts.join('|').trim() || 'No description provided.',
            createdBy: message.author.id, created: Date.now(),
            status: 'scheduled', instructor: null,
            attendees: [], passed: [], failed: []
        };
        db[gid].sessions.push(session);
        saveTrainDb(db);

        const embed = new EmbedBuilder().setColor(0x3498db)
            .setTitle(`🎓 Training Created — ${session.id}`)
            .addFields(
                { name: '📚 Name',        value: session.name,                                inline: true },
                { name: '🆔 ID',          value: session.id,                                  inline: true },
                { name: '👤 Created By',  value: `<@${message.author.id}>`,                   inline: true },
                { name: '📄 Description', value: session.description,                         inline: false }
            )
            .setFooter({ text: `Use !traininghost ${session.id} to start hosting this training` });

        return message.reply({ embeds: [embed] });
    }

    // ── !traininghost <training-id> ───────────────────────────────────────────
    if (command === 'traininghost') {
        const trainId = args[0];
        if (!trainId) return message.reply('❌ Usage: `!traininghost <TRAIN-XXXX>`');

        const db    = getTrainDb();
        const train = db[gid]?.sessions?.find(t => t.id === trainId.toUpperCase());
        if (!train) return message.reply(`❌ Training \`${trainId}\` not found.`);

        train.status     = 'in_progress';
        train.instructor = message.author.id;
        train.startedAt  = Date.now();
        saveTrainDb(db);

        const embed = new EmbedBuilder().setColor(0xf1c40f)
            .setTitle(`🎓 Training In Progress — ${train.id}`)
            .setDescription(`**${train.name}** is now in progress!\n\n${train.description}`)
            .addFields(
                { name: '🎙️ Instructor', value: `<@${message.author.id}>`,               inline: true },
                { name: '⏰ Started',    value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: `Attendees will be logged with !trainingcomplete ${train.id} pass/fail @users` });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`train_join_${trainId}`).setLabel('✋ Join Training').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`train_end_${trainId}`).setLabel('🔒 End Training').setStyle(ButtonStyle.Secondary)
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    // ── !trainingcomplete <training-id> <pass|fail> @user1 @user2... ──────────
    if (command === 'trainingcomplete') {
        const trainId = args[0];
        const result  = args[1]?.toLowerCase();
        if (!trainId || !['pass', 'fail'].includes(result)) {
            return message.reply('❌ Usage: `!trainingcomplete <TRAIN-XXXX> <pass|fail> @user1 @user2...`');
        }

        const db    = getTrainDb();
        const train = db[gid]?.sessions?.find(t => t.id === trainId.toUpperCase());
        if (!train) return message.reply(`❌ Training \`${trainId}\` not found.`);

        const members = [...message.mentions.members.values()];
        if (!members.length) return message.reply('❌ Mention at least one user.');

        train.status = 'completed';
        train.endedAt = Date.now();

        const staffDb = load('staffData', {});
        if (!staffDb[gid]) staffDb[gid] = {};

        for (const m of members) {
            const uid = m.id;
            if (result === 'pass') {
                train.passed.push(uid);
                if (!staffDb[gid][uid]) staffDb[gid][uid] = { trainings: [] };
                staffDb[gid][uid].trainings = staffDb[gid][uid].trainings || [];
                staffDb[gid][uid].trainings.push({ name: train.name, id: train.id, result: 'PASS', instructor: message.author.tag, timestamp: Date.now() });
            } else {
                train.failed.push(uid);
            }
        }

        save('staffData', staffDb);
        saveTrainDb(db);

        const cfg2 = getCfg(gid);
        const logCh = message.guild.channels.cache.get(cfg2.logs?.training);
        const embed = new EmbedBuilder()
            .setColor(result === 'pass' ? 0x57f287 : 0xed4245)
            .setTitle(`🎓 Training ${result === 'pass' ? 'Passed ✅' : 'Failed ❌'} — ${train.id}`)
            .addFields(
                { name: '📚 Training',    value: train.name,                                              inline: true  },
                { name: '🎙️ Instructor', value: `<@${message.author.id}>`,                              inline: true  },
                { name: '👥 Attendees',   value: members.map(m => `<@${m.id}>`).join(', ') || 'None',   inline: false },
                { name: '📅 Completed',   value: `<t:${Math.floor(Date.now() / 1000)}:F>`,              inline: true  },
                { name: '📊 Result',      value: result === 'pass' ? '✅ PASSED' : '❌ FAILED',           inline: true  }
            );

        if (logCh) logCh.send({ embeds: [embed] });
        return message.reply({ embeds: [embed] });
    }

    // ── !traininglist ─────────────────────────────────────────────────────────
    if (command === 'traininglist') {
        const db   = getTrainDb();
        const list = db[gid]?.sessions || [];
        if (!list.length) return message.reply('📋 No training sessions found.');

        const recent = list.slice(-10).reverse();
        const embed  = new EmbedBuilder().setColor(0x3498db).setTitle('📋 Training Sessions')
            .setDescription(recent.map(t =>
                `\`${t.id}\` **${t.name}** — ${t.status.toUpperCase()} — <t:${Math.floor(t.created / 1000)}:d>`
            ).join('\n'))
            .setFooter({ text: `${list.length} total sessions` });

        return message.reply({ embeds: [embed] });
    }
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    const gid = interaction.guild.id;

    if (interaction.customId.startsWith('train_join_')) {
        const trainId = interaction.customId.slice('train_join_'.length);
        const db      = getTrainDb();
        const train   = db[gid]?.sessions?.find(t => t.id === trainId.toUpperCase());
        if (!train) return interaction.reply({ content: '❌ Training not found.', ephemeral: true });
        if (train.attendees.includes(interaction.user.id)) {
            return interaction.reply({ content: '✅ You are already logged as attending this training.', ephemeral: true });
        }
        train.attendees.push(interaction.user.id);
        saveTrainDb(db);
        return interaction.reply({ content: `✅ You have joined **${train.name}**. Good luck!`, ephemeral: true });
    }

    if (interaction.customId.startsWith('train_end_')) {
        const trainId = interaction.customId.slice('train_end_'.length);
        const db      = getTrainDb();
        const train   = db[gid]?.sessions?.find(t => t.id === trainId.toUpperCase());
        if (!train) return interaction.reply({ content: '❌ Training not found.', ephemeral: true });
        if (train.instructor !== interaction.user.id && !interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Only the instructor can end this training.', ephemeral: true });
        }
        train.status  = 'ended';
        train.endedAt = Date.now();
        saveTrainDb(db);
        await interaction.update({ components: [] });
        await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0x95a5a6)
            .setTitle('🔒 Training Ended')
            .setDescription(`Use \`!trainingcomplete ${train.id} pass/fail @users\` to log results.`)
        ] });
    }
}

module.exports = { handleCommand, handleInteraction };
