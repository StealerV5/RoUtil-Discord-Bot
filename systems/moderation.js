// systems/moderation.js — Core moderation commands + case system
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');
const { load, save } = require('../db');

// ── DB helpers ────────────────────────────────────────────────────────────────

function getCfg(gid) {
    return load('modConfig', {})[gid] || {};
}

function hasPerm(member, cfg, level = 'mod') {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const roles =
        level === 'hr'   ? (cfg.hrRoles   || []) :
        level === 'mgmt' ? (cfg.mgmtRoles || []) :
                           (cfg.modRoles  || []);
    return roles.some(r => member.roles.cache.has(r));
}

// Returns staff record, creating it if missing
function getRecord(gid, uid) {
    const db = load('staffData', {});
    if (!db[gid]) db[gid] = {};
    if (!db[gid][uid]) {
        db[gid][uid] = {
            warnings: [], strikes: [], activeStrikes: 0,
            suspensions: [], promotions: [], demotions: [],
            trainings: [], feedbackReceived: [], notes: [],
            isLOA: false, isSuspended: false, suspendedUntil: null,
            isTerminated: false, isBanned: false, activityScore: 0
        };
    }
    return { db, record: db[gid][uid] };
}

function saveStaff(db) { save('staffData', db); }

// Create a new moderation case and return it
function newCase(gid, type, modId, userId, reason, evidence = 'None provided', dept = 'General') {
    const db = load('cases', {});
    if (!db[gid]) db[gid] = { list: [], next: 1 };
    const id  = `CASE-${String(db[gid].next++).padStart(4, '0')}`;
    const obj = { id, type, moderatorId: modId, userId, reason, evidence, department: dept,
                  date: new Date().toISOString(), timestamp: Date.now(), status: 'active', appealId: null };
    db[gid].list.push(obj);
    save('cases', db);
    return obj;
}

// ── Embed builders ────────────────────────────────────────────────────────────

const TYPE_COLOR = { warn: 0xfee75c, strike: 0xff8c00, suspend: 0xe74c3c, demote: 0xff6b6b,
                     terminate: 0x2c2f33, ban: 0x2c2f33, unban: 0x57f287, note: 0x5865f2 };
const TYPE_LABEL = { warn: '⚠️ Warning', strike: '❗ Strike', suspend: '🔴 Suspension',
                     demote: '📉 Demotion', terminate: '🚫 Termination', ban: '🔨 Ban',
                     unban: '✅ Unban', note: '📝 Staff Note' };

function buildCaseEmbed(c, modTag, targetTag) {
    return new EmbedBuilder()
        .setColor(TYPE_COLOR[c.type] || 0x5865f2)
        .setTitle(`${TYPE_LABEL[c.type] || c.type} — ${c.id}`)
        .addFields(
            { name: '👤 User',       value: `<@${c.userId}> (${targetTag || c.userId})`,   inline: true },
            { name: '🛡️ Moderator', value: `<@${c.moderatorId}> (${modTag})`,             inline: true },
            { name: '⚡ Action',     value: TYPE_LABEL[c.type] || c.type,                  inline: true },
            { name: '📋 Reason',     value: c.reason,                                      inline: false },
            { name: '🏢 Department', value: c.department,                                  inline: true },
            { name: '📅 Date',       value: `<t:${Math.floor(c.timestamp / 1000)}:F>`,    inline: true },
            { name: '📎 Evidence',   value: c.evidence,                                    inline: false }
        )
        .setFooter({ text: `Case ID: ${c.id}` });
}

function actionRow(userId, caseId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`mod_history_${userId}`).setLabel('📋 View History').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`mod_appeal_${caseId}`).setLabel('⚖️ Appeal Action').setStyle(ButtonStyle.Primary)
    );
}

async function postLog(guild, cfg, embed, row = null) {
    const ch = guild.channels.cache.get(cfg.logs?.moderation);
    if (ch) await ch.send({ embeds: [embed], components: row ? [row] : [] }).catch(() => {});
}

// ── Suspension expiry daemon ───────────────────────────────────────────────────

async function tickSuspensions(client) {
    const db   = load('staffData', {});
    const now  = Date.now();
    let changed = false;

    for (const [gid, guild_] of Object.entries(db)) {
        for (const [uid, rec] of Object.entries(guild_)) {
            if (!rec.isSuspended || !rec.suspendedUntil || rec.suspendedUntil > now) continue;
            rec.isSuspended    = false;
            rec.suspendedUntil = null;
            changed = true;

            const g   = client.guilds.cache.get(gid);
            const cfg = getCfg(gid);
            if (g) {
                const logCh = g.channels.cache.get(cfg.logs?.moderation);
                if (logCh) logCh.send({ embeds: [new EmbedBuilder().setColor(0x57f287)
                    .setTitle('✅ Suspension Expired').setDescription(`<@${uid}>'s suspension has automatically expired.`)] }).catch(() => {});
                const m = g.members.cache.get(uid) || await g.members.fetch(uid).catch(() => null);
                if (m) m.send('✅ Your suspension has expired. Welcome back.').catch(() => {});
            }
        }
    }
    if (changed) save('staffData', db);
}

// ── Command handler ───────────────────────────────────────────────────────────

async function handleCommand(message, command, args) {
    const gid = message.guild.id;
    const cfg = getCfg(gid);

    if (!hasPerm(message.member, cfg)) {
        return message.reply({ embeds: [new EmbedBuilder().setColor(0xed4245)
            .setTitle('❌ Permission Denied').setDescription('You need a moderator role to use this command.')] });
    }

    // ── !warn ────────────────────────────────────────────────────────────────
    if (command === 'warn') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Mention a user: `!warn @user <reason>`');
        const reason = args.slice(1).join(' ') || 'No reason provided.';
        const c = newCase(gid, 'warn', message.author.id, target.id, reason);
        const { db, record } = getRecord(gid, target.id);
        record.warnings.push(c.id);
        saveStaff(db);

        const embed = buildCaseEmbed(c, message.author.tag, target.user.tag);
        const row   = actionRow(target.id, c.id);
        await message.reply({ embeds: [embed], components: [row] });
        await postLog(message.guild, cfg, embed, row);
        target.send({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle('⚠️ You received a Warning')
            .addFields({ name: 'Reason', value: reason }, { name: 'Case ID', value: c.id })] }).catch(() => {});
    }

    // ── !strike ───────────────────────────────────────────────────────────────
    if (command === 'strike') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Mention a user: `!strike @user <reason>`');
        const reason = args.slice(1).join(' ') || 'No reason provided.';
        const c = newCase(gid, 'strike', message.author.id, target.id, reason);
        const { db, record } = getRecord(gid, target.id);
        record.strikes.push(c.id);
        record.activeStrikes = (record.activeStrikes || 0) + 1;
        saveStaff(db);

        const embed = buildCaseEmbed(c, message.author.tag, target.user.tag);
        const row   = actionRow(target.id, c.id);
        await message.reply({ embeds: [embed], components: [row] });
        await postLog(message.guild, cfg, embed, row);

        // Auto-escalation notices
        const s = record.activeStrikes;
        const notices = { 2: '🟡 2 strikes — **Suspension** recommended.', 3: '🟠 3 strikes — **Demotion** recommended.',
                          5: '🔴 5 strikes — **Termination Review** recommended.' };
        if (notices[s]) message.channel.send(`⚠️ **Strike Escalation:** <@${target.id}> now has **${s} active strikes**.\n${notices[s]}`);

        target.send({ embeds: [new EmbedBuilder().setColor(0xff8c00).setTitle('❗ You received a Strike')
            .addFields({ name: 'Reason', value: reason }, { name: 'Active Strikes', value: `${record.activeStrikes}` }, { name: 'Case ID', value: c.id })] }).catch(() => {});
    }

    // ── !removestrike ─────────────────────────────────────────────────────────
    if (command === 'removestrike') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Mention a user: `!removestrike @user <reason>`');
        const { db, record } = getRecord(gid, target.id);
        if (!record.activeStrikes) return message.reply('❌ This user has no active strikes.');
        record.activeStrikes = Math.max(0, record.activeStrikes - 1);
        const reason = args.slice(1).join(' ') || 'Strike removed.';
        newCase(gid, 'note', message.author.id, target.id, `Strike removed — ${reason}`);
        saveStaff(db);

        const embed = new EmbedBuilder().setColor(0x57f287).setTitle('✅ Strike Removed')
            .addFields({ name: 'User', value: `<@${target.id}>`, inline: true },
                       { name: 'Remaining Strikes', value: `${record.activeStrikes}`, inline: true },
                       { name: 'Reason', value: reason });
        await message.reply({ embeds: [embed] });
        await postLog(message.guild, cfg, embed);
    }

    // ── !suspend ──────────────────────────────────────────────────────────────
    if (command === 'suspend') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Usage: `!suspend @user <1d|3d|7d|14d|perm> <reason>`');

        const durStr = args[1] || '1d';
        const durMap = { '1d': 86400000, '3d': 259200000, '7d': 604800000, '14d': 1209600000, 'perm': null };
        const ms     = Object.prototype.hasOwnProperty.call(durMap, durStr) ? durMap[durStr] : 86400000;
        const until  = ms ? Date.now() + ms : null;
        const reason = args.slice(2).join(' ') || 'No reason provided.';
        const c      = newCase(gid, 'suspend', message.author.id, target.id, reason);

        const { db, record } = getRecord(gid, target.id);
        record.isSuspended    = true;
        record.suspendedUntil = until;
        record.suspensions.push({ caseId: c.id, until, reason, duration: durStr });
        saveStaff(db);

        const embed = buildCaseEmbed(c, message.author.tag, target.user.tag);
        embed.addFields({ name: '⏰ Duration', value: durStr === 'perm' ? '🔴 Permanent' : `Expires <t:${Math.floor(until / 1000)}:F>`, inline: true });
        const row = actionRow(target.id, c.id);
        await message.reply({ embeds: [embed], components: [row] });
        await postLog(message.guild, cfg, embed, row);
        target.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🔴 You have been Suspended')
            .addFields({ name: 'Reason', value: reason }, { name: 'Duration', value: durStr }, { name: 'Case ID', value: c.id })] }).catch(() => {});
    }

    // ── !demote ───────────────────────────────────────────────────────────────
    if (command === 'demote') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Usage: `!demote @user <reason>`');
        const reason = args.slice(1).join(' ') || 'No reason provided.';
        const c = newCase(gid, 'demote', message.author.id, target.id, reason);
        const { db, record } = getRecord(gid, target.id);
        record.demotions.push(c.id);
        saveStaff(db);

        const embed = buildCaseEmbed(c, message.author.tag, target.user.tag);
        const row   = actionRow(target.id, c.id);
        await message.reply({ embeds: [embed], components: [row] });
        await postLog(message.guild, cfg, embed, row);
        target.send({ embeds: [new EmbedBuilder().setColor(0xff6b6b).setTitle('📉 You have been Demoted')
            .addFields({ name: 'Reason', value: reason }, { name: 'Case ID', value: c.id })] }).catch(() => {});
    }

    // ── !terminate ────────────────────────────────────────────────────────────
    if (command === 'terminate') {
        if (!hasPerm(message.member, cfg, 'hr')) {
            return message.reply('❌ HR role required to issue terminations.');
        }
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Usage: `!terminate @user <reason>`');
        const reason = args.slice(1).join(' ') || 'No reason provided.';
        const c = newCase(gid, 'terminate', message.author.id, target.id, reason);
        const { db, record } = getRecord(gid, target.id);
        record.isTerminated = true;
        saveStaff(db);

        const embed = buildCaseEmbed(c, message.author.tag, target.user.tag);
        const row   = actionRow(target.id, c.id);
        await message.reply({ embeds: [embed], components: [row] });
        await postLog(message.guild, cfg, embed, row);
        target.send({ embeds: [new EmbedBuilder().setColor(0x2c2f33).setTitle('🚫 You have been Terminated')
            .addFields({ name: 'Reason', value: reason }, { name: 'Case ID', value: c.id })] }).catch(() => {});
    }

    // ── !ban ──────────────────────────────────────────────────────────────────
    if (command === 'ban') {
        if (!hasPerm(message.member, cfg, 'hr')) return message.reply('❌ HR role required to issue bans.');
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Usage: `!ban @user <reason>`');
        const reason = args.slice(1).join(' ') || 'No reason provided.';
        const c = newCase(gid, 'ban', message.author.id, target.id, reason);
        const { db, record } = getRecord(gid, target.id);
        record.isBanned = true;
        saveStaff(db);

        const embed = buildCaseEmbed(c, message.author.tag, target.user.tag);
        await message.reply({ embeds: [embed] });
        await postLog(message.guild, cfg, embed);
        target.send({ embeds: [new EmbedBuilder().setColor(0x2c2f33).setTitle('🔨 You have been Banned')
            .addFields({ name: 'Reason', value: reason })] }).catch(() => {});
        message.guild.members.ban(target.id, { reason }).catch(() => {});
    }

    // ── !unban ────────────────────────────────────────────────────────────────
    if (command === 'unban') {
        if (!hasPerm(message.member, cfg, 'hr')) return message.reply('❌ HR role required to unban.');
        const uid = args[0]?.replace(/\D/g, '');
        if (!uid) return message.reply('❌ Usage: `!unban <userID> <reason>`');
        const reason = args.slice(1).join(' ') || 'No reason provided.';
        const c = newCase(gid, 'unban', message.author.id, uid, reason);
        const { db, record } = getRecord(gid, uid);
        record.isBanned = false;
        saveStaff(db);

        message.guild.members.unban(uid, reason).catch(() => {});
        const embed = buildCaseEmbed(c, message.author.tag, uid);
        await message.reply({ embeds: [embed] });
        await postLog(message.guild, cfg, embed);
    }

    // ── !note ─────────────────────────────────────────────────────────────────
    if (command === 'note') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Usage: `!note @user <note text>`');
        const text = args.slice(1).join(' ') || 'No note text.';
        const c = newCase(gid, 'note', message.author.id, target.id, text);
        const { db, record } = getRecord(gid, target.id);
        record.notes.push(c.id);
        saveStaff(db);

        const embed = buildCaseEmbed(c, message.author.tag, target.user.tag);
        await message.reply({ embeds: [embed] });
        await postLog(message.guild, cfg, embed);
    }
}

// ── Interaction handler ───────────────────────────────────────────────────────

async function handleInteraction(interaction) {
    const gid = interaction.guild.id;

    // View history button
    if (interaction.customId.startsWith('mod_history_')) {
        const uid  = interaction.customId.slice('mod_history_'.length);
        const db   = load('cases', {});
        const list = (db[gid]?.list || []).filter(c => c.userId === uid);

        if (!list.length) return interaction.reply({ content: '📋 No cases found for this user.', ephemeral: true });

        const recent = list.slice(-15).reverse();
        const embed  = new EmbedBuilder().setColor(0x5865f2)
            .setTitle(`📋 Case History — <@${uid}>`)
            .setDescription(recent.map(c =>
                `\`${c.id}\` **${(TYPE_LABEL[c.type] || c.type).replace(/[^a-zA-Z ]/g, '').trim()}** — ${c.reason.slice(0, 60)}${c.reason.length > 60 ? '…' : ''} — <t:${Math.floor(c.timestamp / 1000)}:d>`
            ).join('\n'))
            .addFields(
                { name: 'Warnings', value: `${list.filter(c => c.type === 'warn').length}`,    inline: true },
                { name: 'Strikes',  value: `${list.filter(c => c.type === 'strike').length}`,  inline: true },
                { name: 'Suspensions', value: `${list.filter(c => c.type === 'suspend').length}`, inline: true }
            )
            .setFooter({ text: `${list.length} total cases • showing last 15` });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Appeal button
    if (interaction.customId.startsWith('mod_appeal_')) {
        const caseId = interaction.customId.slice('mod_appeal_'.length);
        return interaction.reply({
            content: `⚖️ To appeal **${caseId}**, please use your server's appeal channel or contact HR directly.`,
            ephemeral: true
        });
    }
}

module.exports = {
    handleCommand, handleInteraction, tickSuspensions,
    newCase, getRecord, saveStaff, hasPerm, getCfg,
    buildCaseEmbed, TYPE_LABEL, TYPE_COLOR
};
