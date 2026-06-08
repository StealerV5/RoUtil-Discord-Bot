// systems/departments.js — Department dashboards and member management
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { load, save } = require('../db');

const DEFAULT_DEPTS = ['Administration', 'Moderation', 'Human Resources', 'Internal Affairs', 'Development', 'Security'];

function getCfg(gid)  { return load('modConfig', {})[gid] || {}; }
function getDeptDb()  { return load('departments', {}); }
function saveDeptDb(d){ save('departments', d); }

function ensureGuild(db, gid) {
    if (!db[gid]) {
        db[gid] = {};
        for (const d of DEFAULT_DEPTS) {
            db[gid][d] = { members: [], performance: 0, notes: '' };
        }
    }
    return db[gid];
}

// ── Command handler ───────────────────────────────────────────────────────────

async function handleCommand(message, command, args) {
    const gid = message.guild.id;
    const cfg = getCfg(gid);
    const db  = getDeptDb();
    const gd  = ensureGuild(db, gid);

    const isAdmin = message.member.permissions.has('Administrator') ||
                    [...(cfg.hrRoles || []), ...(cfg.mgmtRoles || [])].some(r => message.member.roles.cache.has(r));

    // ── !departments ──────────────────────────────────────────────────────────
    if (command === 'departments') {
        const embed = new EmbedBuilder().setColor(0x9b59b6)
            .setTitle('🏢 Department Overview')
            .setDescription('Here is a summary of all active departments:')
            .addFields(
                Object.entries(gd).map(([name, data]) => ({
                    name: `🏢 ${name}`,
                    value: `👥 Members: **${data.members.length}** | ⭐ Performance: **${data.performance}**`,
                    inline: true
                }))
            )
            .setFooter({ text: `${Object.keys(gd).length} departments • Use !department <name> for details` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('dept_view').setPlaceholder('View a department...')
                .addOptions(Object.keys(gd).map(d => ({ label: d, value: d })))
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    // ── !department <name> ────────────────────────────────────────────────────
    if (command === 'department') {
        const name = args.join(' ').trim();
        const dept = Object.keys(gd).find(d => d.toLowerCase() === name.toLowerCase());
        if (!dept) return message.reply(`❌ Department \`${name}\` not found. Use \`!departments\` to see all.`);

        const data = gd[dept];
        await sendDeptEmbed(message.channel, dept, data);
        return;
    }

    // ── !deptadd <department> @user ───────────────────────────────────────────
    if (command === 'deptadd') {
        if (!isAdmin) return message.reply('❌ HR or Admin required.');
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Usage: `!deptadd <Department Name> @user`');

        const deptName = args.slice(0, -1).join(' ').trim();
        const dept     = Object.keys(gd).find(d => d.toLowerCase() === deptName.toLowerCase());
        if (!dept) return message.reply(`❌ Department \`${deptName}\` not found.`);

        if (!gd[dept].members.includes(target.id)) {
            gd[dept].members.push(target.id);
            saveDeptDb(db);
        }

        return message.reply(`✅ <@${target.id}> added to **${dept}**.`);
    }

    // ── !deptremove <department> @user ────────────────────────────────────────
    if (command === 'deptremove') {
        if (!isAdmin) return message.reply('❌ HR or Admin required.');
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Usage: `!deptremove <Department Name> @user`');

        const deptName = args.slice(0, -1).join(' ').trim();
        const dept     = Object.keys(gd).find(d => d.toLowerCase() === deptName.toLowerCase());
        if (!dept) return message.reply(`❌ Department \`${deptName}\` not found.`);

        gd[dept].members = gd[dept].members.filter(id => id !== target.id);
        saveDeptDb(db);
        return message.reply(`✅ <@${target.id}> removed from **${dept}**.`);
    }

    // ── !deptperformance <department> <score> ─────────────────────────────────
    if (command === 'deptperformance') {
        if (!isAdmin) return message.reply('❌ HR or Admin required.');
        const deptName = args.slice(0, -1).join(' ').trim();
        const score    = parseInt(args[args.length - 1]);
        const dept     = Object.keys(gd).find(d => d.toLowerCase() === deptName.toLowerCase());
        if (!dept || isNaN(score)) return message.reply('❌ Usage: `!deptperformance <Department Name> <0-100>`');

        gd[dept].performance = Math.max(0, Math.min(100, score));
        saveDeptDb(db);
        return message.reply(`✅ **${dept}** performance score updated to **${gd[dept].performance}/100**.`);
    }
}

async function sendDeptEmbed(channel, name, data) {
    const perf    = data.performance;
    const perfBar = '█'.repeat(Math.round(perf / 10)) + '░'.repeat(10 - Math.round(perf / 10));
    const embed   = new EmbedBuilder().setColor(0x9b59b6)
        .setTitle(`🏢 ${name}`)
        .addFields(
            { name: '👥 Total Members',   value: `${data.members.length}`,                 inline: true },
            { name: '⭐ Performance',      value: `${perf}/100\n\`${perfBar}\``,            inline: true },
            { name: '📋 Notes',           value: data.notes || 'None',                      inline: false },
            { name: '👤 Members',         value: data.members.length
                ? data.members.map(id => `<@${id}>`).join(', ')
                : '_No members assigned_',  inline: false }
        )
        .setTimestamp();

    return channel.send({ embeds: [embed] });
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    const gid = interaction.guild.id;
    const db  = getDeptDb();
    const gd  = ensureGuild(db, gid);

    if (interaction.customId === 'dept_view') {
        const name = interaction.values[0];
        const data = gd[name];
        if (!data) return interaction.reply({ content: '❌ Department not found.', ephemeral: true });

        const perf    = data.performance;
        const perfBar = '█'.repeat(Math.round(perf / 10)) + '░'.repeat(10 - Math.round(perf / 10));
        const embed   = new EmbedBuilder().setColor(0x9b59b6)
            .setTitle(`🏢 ${name}`)
            .addFields(
                { name: '👥 Members',    value: `${data.members.length}`,                    inline: true },
                { name: '⭐ Performance',value: `${perf}/100 \`${perfBar}\``,                 inline: true },
                { name: '👤 Member List',value: data.members.length ? data.members.map(id => `<@${id}>`).join(', ') : '_None_', inline: false }
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

module.exports = { handleCommand, handleInteraction };
