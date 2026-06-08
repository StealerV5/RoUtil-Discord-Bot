// systems/analytics.js — Dashboard and statistics commands
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { load } = require('../db');

function getCfg(gid) { return load('modConfig', {})[gid] || {}; }

async function handleCommand(message, command) {
    const gid = message.guild.id;
    const cfg = getCfg(gid);

    // ── !dashboard ────────────────────────────────────────────────────────────
    if (command === 'dashboard') {
        const casesDb = load('cases',     {})[gid] || { list: [], next: 1 };
        const staffDb = load('staffData', {})[gid] || {};
        const loaDb   = load('loa',       {})[gid] || {};
        const trainDb = load('trainings', {})[gid] || { sessions: [] };
        const actDb   = load('activity',  {})[gid] || {};

        const allStaff   = Object.entries(staffDb);
        const active     = allStaff.filter(([, r]) => !r.isSuspended && !r.isTerminated && !r.isBanned).length;
        const suspended  = allStaff.filter(([, r]) => r.isSuspended).length;
        const terminated = allStaff.filter(([, r]) => r.isTerminated).length;
        const onLOA      = allStaff.filter(([, r]) => r.isLOA).length;

        const cases    = casesDb.list || [];
        const warnings = cases.filter(c => c.type === 'warn').length;
        const strikes  = cases.filter(c => c.type === 'strike').length;
        const bans     = cases.filter(c => c.type === 'ban').length;

        // This month's cases
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
        const monthCases = cases.filter(c => c.timestamp >= monthStart.getTime()).length;

        const trainSessions = (trainDb.sessions || []);
        const trainCompleted = trainSessions.filter(t => t.status === 'completed').length;

        // Total activity score
        const totalScore = Object.values(actDb).reduce((s, r) => s + (r.score || 0), 0);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('📊 Staff Management Dashboard')
            .setDescription(`**${message.guild.name}** — Real-time overview`)
            .addFields(
                { name: '👥 Staff Overview',      value:
                    `✅ Active: **${active}**\n🔴 Suspended: **${suspended}**\n🚫 Terminated: **${terminated}**\n🌴 On LOA: **${onLOA}**`,
                    inline: true },
                { name: '⚖️ Moderation',          value:
                    `📋 Total Cases: **${cases.length}**\n⚠️ Warnings: **${warnings}**\n❗ Strikes: **${strikes}**\n🔨 Bans: **${bans}**`,
                    inline: true },
                { name: '📅 This Month',           value:
                    `📋 Cases: **${monthCases}**\n🎓 Trainings Completed: **${trainCompleted}**`,
                    inline: true },
                { name: '📈 Activity',             value:
                    `⭐ Total Score: **${totalScore}**\n👤 Tracked Members: **${Object.keys(actDb).length}**`,
                    inline: true },
                { name: '⚙️ Configuration',       value:
                    `🛡️ Mod Roles: **${(cfg.modRoles || []).length}**\n⚖️ HR Roles: **${(cfg.hrRoles || []).length}**\n🎮 Group ID: **${cfg.robloxGroupId || 'Not set'}**`,
                    inline: true }
            )
            .setFooter({ text: 'Use !stats for detailed statistics' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dash_refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('dash_modlog').setLabel('📋 Recent Cases').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('dash_activity').setLabel('📊 Activity').setStyle(ButtonStyle.Secondary)
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    // ── !stats ────────────────────────────────────────────────────────────────
    if (command === 'stats') {
        const casesDb = load('cases',     {})[gid] || { list: [], next: 1 };
        const cases   = casesDb.list || [];

        const byType  = {};
        for (const c of cases) byType[c.type] = (byType[c.type] || 0) + 1;

        // Top moderators
        const modCounts = {};
        for (const c of cases) modCounts[c.moderatorId] = (modCounts[c.moderatorId] || 0) + 1;
        const topMods = Object.entries(modCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

        // Cases by month (last 3 months)
        const now = Date.now();
        const months = [0, 1, 2].map(i => {
            const d = new Date(now);
            d.setMonth(d.getMonth() - i);
            const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
            const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).getTime();
            return {
                name: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
                count: cases.filter(c => c.timestamp >= start && c.timestamp <= end).length
            };
        });

        const embed = new EmbedBuilder().setColor(0x3498db)
            .setTitle('📈 Detailed Statistics')
            .addFields(
                { name: '📋 Cases by Type', value:
                    Object.entries(byType).map(([t, n]) => `**${t}:** ${n}`).join('\n') || 'No cases',
                    inline: true },
                { name: '🛡️ Top Moderators (by cases)', value:
                    topMods.length ? topMods.map(([id, n]) => `<@${id}>: **${n}** cases`).join('\n') : 'None',
                    inline: true },
                { name: '📅 Cases by Month', value:
                    months.map(m => `**${m.name}:** ${m.count} cases`).join('\n'),
                    inline: false },
                { name: '📊 Totals', value:
                    `Total Cases: **${cases.length}**\nAvg/Month: **${Math.round(cases.length / Math.max(1, months.length))}**`,
                    inline: true }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    const gid = interaction.guild.id;

    if (interaction.customId === 'dash_refresh') {
        const casesDb = load('cases', {})[gid] || { list: [] };
        const staffDb = load('staffData', {})[gid] || {};
        const allStaff = Object.entries(staffDb);
        const embed = new EmbedBuilder().setColor(0x5865f2)
            .setTitle('📊 Dashboard (Refreshed)')
            .addFields(
                { name: '👥 Staff', value: `Active: **${allStaff.filter(([,r]) => !r.isSuspended && !r.isTerminated).length}** | Suspended: **${allStaff.filter(([,r]) => r.isSuspended).length}**`, inline: true },
                { name: '📋 Cases', value: `Total: **${(casesDb.list || []).length}**`, inline: true }
            )
            .setTimestamp();
        return interaction.update({ embeds: [embed] });
    }

    if (interaction.customId === 'dash_modlog') {
        const casesDb = load('cases', {})[gid] || { list: [] };
        const recent  = (casesDb.list || []).slice(-10).reverse();
        const embed   = new EmbedBuilder().setColor(0x5865f2)
            .setTitle('📋 Recent Cases (Last 10)')
            .setDescription(recent.length
                ? recent.map(c => `\`${c.id}\` **${c.type.toUpperCase()}** — <@${c.userId}> — ${c.reason.slice(0, 40)}…`).join('\n')
                : 'No cases found.'
            );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.customId === 'dash_activity') {
        const actDb  = load('activity', {})[gid] || {};
        const sorted = Object.entries(actDb).sort((a, b) => b[1].score - a[1].score).slice(0, 5);
        const embed  = new EmbedBuilder().setColor(0x3498db)
            .setTitle('📊 Top 5 Activity')
            .setDescription(sorted.length ? sorted.map(([id, r], i) => `**${i+1}.** <@${id}> — ⭐ ${r.score}`).join('\n') : 'No data.');
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

module.exports = { handleCommand, handleInteraction };
