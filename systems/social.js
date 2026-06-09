// systems/social.js — Social, profile, AFK, tags, polls, suggestions, reminders, birthdays
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { load, save } = require('../db');

// ── DB helpers ─────────────────────────────────────────────────────────────────
const getProfiles  = (gid) => { const d = load('profiles', {}); return d[gid] || {}; };
const saveProfiles = (gid, v) => { const d = load('profiles', {}); d[gid] = v; save('profiles', d); };
const getAfk       = () => load('afk', {});
const saveAfk      = (d) => save('afk', d);
const getTags      = (gid) => { const d = load('tags', {}); return d[gid] || {}; };
const saveTags     = (gid, v) => { const d = load('tags', {}); d[gid] = v; save('tags', d); };
const getSug       = (gid) => { const d = load('suggestions', {}); if (!d[gid]) d[gid] = { list: [], next: 1 }; return d; };
const saveSug      = (d) => save('suggestions', d);
const getRems      = () => load('reminders', {});
const saveRems     = (d) => save('reminders', d);
const getPolls     = (gid) => { const d = load('polls', {}); if (!d[gid]) d[gid] = { list: [], next: 1 }; return d; };
const savePolls    = (d) => save('polls', d);
const getKudos     = (gid) => { const d = load('kudos', {}); if (!d[gid]) d[gid] = {}; return d; };
const saveKudos    = (d) => save('kudos', d);
const getRep       = (gid) => { const d = load('rep', {}); if (!d[gid]) d[gid] = {}; return d; };
const saveRep      = (d) => save('rep', d);

function parseDuration(str) {
    const m = str.match(/^(\d+)(s|m|h|d|w)$/i);
    if (!m) return null;
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2].toLowerCase()];
    return parseInt(m[1]) * mult;
}

const POLL_EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];

// ── Main handler ───────────────────────────────────────────────────────────────
async function handleCommand(message, command, args, client) {
    const gid = message.guild.id;
    const uid = message.author.id;
    const r   = (c) => message.reply(c);

    // ── AFK ───────────────────────────────────────────────────────────────────
    if (command === 'afk') {
        const reason = args.join(' ') || 'AFK';
        const db = getAfk(); db[uid] = { reason, since: Date.now() }; saveAfk(db);
        return r({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle('💤 AFK Set').setDescription(`You are now AFK: **${reason}**`)] });
    }
    if (command === 'unafk') {
        const db = getAfk();
        if (!db[uid]) return r('❌ You are not AFK.');
        delete db[uid]; saveAfk(db);
        return r({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('👋 Welcome Back!').setDescription('Your AFK status has been removed.')] });
    }
    if (command === 'afklist') {
        const db = getAfk();
        const list = Object.entries(db);
        if (!list.length) return r('Nobody is currently AFK.');
        const lines = list.slice(0, 20).map(([id, d]) => `<@${id}> — ${d.reason} *(since <t:${Math.floor(d.since / 1000)}:R>)*`);
        return r({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(`💤 AFK Members (${list.length})`).setDescription(lines.join('\n'))] });
    }

    // ── Social emotes ─────────────────────────────────────────────────────────
    const EMOTES = {
        greet:    { emoji: '👋', verb: 'greeted',       color: 0x57f287 },
        congrats: { emoji: '🎉', verb: 'congratulated', color: 0xffd700 },
        thank:    { emoji: '🙏', verb: 'thanked',       color: 0x5865f2 },
        welcome:  { emoji: '🎊', verb: 'welcomed',      color: 0x57f287 },
    };
    if (EMOTES[command]) {
        const { emoji, verb, color } = EMOTES[command];
        const target = message.mentions.users.first();
        if (!target) return r(`❌ Mention a member. Example: \`!${command} @someone\``);
        if (target.id === uid) return r('❌ You cannot do that to yourself!');
        return r({ embeds: [new EmbedBuilder().setColor(color)
            .setDescription(`${emoji} **${message.author.displayName}** has ${verb} **${target.displayName}**!`)] });
    }

    // ── Kudos ─────────────────────────────────────────────────────────────────
    if (command === 'kudos') {
        const target = message.mentions.users.first();
        if (!target) return r('❌ Usage: `!kudos @user <reason>`');
        if (target.id === uid) return r('❌ You cannot give kudos to yourself!');
        if (target.bot) return r('❌ Bots cannot receive kudos.');
        const reason = args.slice(1).join(' ') || 'for being awesome!';
        const db = getKudos(gid);
        if (!db[gid][target.id]) db[gid][target.id] = { count: 0, recent: [] };
        db[gid][target.id].count++;
        db[gid][target.id].recent.unshift({ from: uid, reason, date: Date.now() });
        if (db[gid][target.id].recent.length > 10) db[gid][target.id].recent.pop();
        saveKudos(db);
        return r({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('⭐ Kudos Given!')
            .setDescription(`**${message.author.displayName}** gave kudos to **${target.displayName}**!\n**Reason:** ${reason}`)
            .setFooter({ text: `${target.displayName} now has ${db[gid][target.id].count} total kudos` })] });
    }
    if (command === 'mykudos') {
        const db = getKudos(gid);
        const data = db[gid][uid];
        if (!data?.count) return r('❌ You have not received any kudos yet!');
        const recent = data.recent.slice(0, 5).map(k => `• <@${k.from}>: ${k.reason}`).join('\n');
        return r({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('⭐ Your Kudos')
            .addFields({ name: 'Total Kudos', value: data.count.toString(), inline: true }, { name: 'Recent', value: recent })] });
    }
    if (command === 'topkudos') {
        const db = getKudos(gid);
        const entries = Object.entries(db[gid] || {}).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
        if (!entries.length) return r('No kudos given yet!');
        return r({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('⭐ Top Kudos')
            .setDescription(entries.map(([id, d], i) => `**${i + 1}.** <@${id}> — ${d.count} kudos`).join('\n'))] });
    }

    // ── Reputation ────────────────────────────────────────────────────────────
    if (command === 'rep') {
        const target = message.mentions.users.first();
        if (!target) return r('❌ Usage: `!rep @user`');
        if (target.id === uid) return r('❌ You cannot give rep to yourself!');
        if (target.bot) return r('❌ Bots cannot receive rep.');
        const db = getRep(gid);
        if (!db[gid]._cd) db[gid]._cd = {};
        const key = `${uid}_${target.id}`;
        const last = db[gid]._cd[key] || 0;
        const COOL = 12 * 3600000;
        if (Date.now() - last < COOL) {
            return r(`❌ You can rep **${target.displayName}** again <t:${Math.floor((last + COOL) / 1000)}:R>.`);
        }
        if (!db[gid][target.id]) db[gid][target.id] = 0;
        db[gid][target.id]++;
        db[gid]._cd[key] = Date.now();
        saveRep(db);
        return r({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('👍 +1 Rep!')
            .setDescription(`**${message.author.displayName}** gave +1 rep to **${target.displayName}**!\nThey now have **${db[gid][target.id]}** rep.`)] });
    }
    if (command === 'myrep') {
        const db = getRep(gid);
        const rep = (db[gid] || {})[uid] || 0;
        return r({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('👍 Your Rep').setDescription(`You have **${rep}** reputation points.`)] });
    }
    if (command === 'toprep') {
        const db = getRep(gid);
        const entries = Object.entries(db[gid] || {}).filter(([k]) => k !== '_cd').sort((a, b) => b[1] - a[1]).slice(0, 10);
        if (!entries.length) return r('No reputation given yet!');
        return r({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('👍 Top Reputation')
            .setDescription(entries.map(([id, v], i) => `**${i + 1}.** <@${id}> — ${v} rep`).join('\n'))] });
    }

    // ── Profile ───────────────────────────────────────────────────────────────
    if (command === 'setbio') {
        const bio = args.join(' ');
        if (!bio) return r('❌ Usage: `!setbio <text>` (max 200 chars)');
        if (bio.length > 200) return r('❌ Bio must be 200 characters or fewer.');
        const p = getProfiles(gid); if (!p[uid]) p[uid] = {}; p[uid].bio = bio; saveProfiles(gid, p);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('✅ Bio Updated').setDescription(bio)] });
    }
    if (command === 'mybio') {
        const p = getProfiles(gid);
        const bio = p[uid]?.bio;
        if (!bio) return r('❌ No bio set yet. Use `!setbio <text>`.');
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📝 Your Bio').setDescription(bio)] });
    }
    if (command === 'settimezone') {
        const tz = args[0];
        if (!tz) return r('❌ Usage: `!settimezone <timezone>`. Example: `!settimezone America/New_York`');
        try { new Date().toLocaleString('en-US', { timeZone: tz }); }
        catch { return r('❌ Invalid timezone. Use an IANA timezone like `America/New_York` or `Europe/London`.'); }
        const p = getProfiles(gid); if (!p[uid]) p[uid] = {}; p[uid].timezone = tz; saveProfiles(gid, p);
        const current = new Date().toLocaleString('en-US', { timeZone: tz, timeStyle: 'short', dateStyle: 'medium' });
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🌍 Timezone Set')
            .addFields({ name: 'Timezone', value: tz, inline: true }, { name: 'Current Time There', value: current, inline: true })] });
    }
    if (command === 'timezone') {
        const target = message.mentions.users.first() || message.author;
        const p = getProfiles(gid);
        const tz = p[target.id]?.timezone;
        if (!tz) return r(target.id === uid ? '❌ No timezone set. Use `!settimezone <tz>`.' : `❌ **${target.displayName}** has no timezone set.`);
        const current = new Date().toLocaleString('en-US', { timeZone: tz, timeStyle: 'short', dateStyle: 'medium' });
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🌍 ${target.displayName}'s Timezone`)
            .addFields({ name: 'Timezone', value: tz, inline: true }, { name: 'Current Time', value: current, inline: true })] });
    }
    if (command === 'profile') {
        const target = message.mentions.users.first() || message.author;
        const member = await message.guild.members.fetch(target.id).catch(() => null);
        if (!member) return r('❌ Member not found.');
        const p  = getProfiles(gid);
        const pd = p[target.id] || {};
        const repDb    = getRep(gid);
        const kudosDb  = getKudos(gid);
        const rep      = (repDb[gid] || {})[target.id] || 0;
        const kudos    = ((kudosDb[gid] || {})[target.id] || {}).count || 0;
        return r({ embeds: [new EmbedBuilder()
            .setColor(member.displayColor || 0x5865f2)
            .setTitle(`👤 ${member.displayName}'s Profile`)
            .setThumbnail(target.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: '📝 Bio',            value: pd.bio || '*No bio set.*',                   inline: false },
                { name: '🌍 Timezone',        value: pd.timezone || '*Not set*',                   inline: true  },
                { name: '👍 Rep',             value: rep.toString(),                               inline: true  },
                { name: '⭐ Kudos',           value: kudos.toString(),                             inline: true  },
                { name: '📅 Joined Server',   value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true },
                { name: '📅 Account Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`, inline: true }
            )] });
    }

    // ── Birthdays ─────────────────────────────────────────────────────────────
    if (command === 'setbirthday') {
        const m = (args[0] || '').match(/^(\d{1,2})[\/\-](\d{1,2})$/);
        if (!m) return r('❌ Usage: `!setbirthday <mm/dd>`. Example: `!setbirthday 06/15`');
        const month = parseInt(m[1]), day = parseInt(m[2]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return r('❌ Invalid date.');
        const p = getProfiles(gid); if (!p[uid]) p[uid] = {}; p[uid].birthday = { month, day }; saveProfiles(gid, p);
        return r({ embeds: [new EmbedBuilder().setColor(0xff69b4).setTitle('🎂 Birthday Set!').setDescription(`Your birthday is set to **${month}/${day}**!`)] });
    }
    if (command === 'birthday') {
        const target = message.mentions.users.first() || message.author;
        const p = getProfiles(gid);
        const bd = p[target.id]?.birthday;
        if (!bd) return r(target.id === uid ? '❌ No birthday set. Use `!setbirthday <mm/dd>`.' : `❌ **${target.displayName}** hasn't set a birthday.`);
        return r({ embeds: [new EmbedBuilder().setColor(0xff69b4).setTitle(`🎂 ${target.displayName}'s Birthday`).setDescription(`**${bd.month}/${bd.day}**`)] });
    }
    if (command === 'birthdaylist' || command === 'birthdaytoday') {
        const p = getProfiles(gid);
        const now = new Date();
        const todayOnly = command === 'birthdaytoday';
        const entries = Object.entries(p)
            .filter(([, v]) => v.birthday && (!todayOnly || (v.birthday.month === now.getMonth() + 1 && v.birthday.day === now.getDate())))
            .map(([id, v]) => ({ id, ...v.birthday }))
            .sort((a, b) => a.month !== b.month ? a.month - b.month : a.day - b.day);
        if (!entries.length) return r(todayOnly ? '🎂 No birthdays today!' : '📅 No birthdays set yet.');
        const lines = entries.slice(0, 20).map(e => `<@${e.id}> — **${e.month}/${e.day}**`);
        return r({ embeds: [new EmbedBuilder().setColor(0xff69b4).setTitle(todayOnly ? '🎂 Birthdays Today!' : '🎂 Birthday List').setDescription(lines.join('\n'))] });
    }
    if (command === 'clearbirthday') {
        const p = getProfiles(gid);
        if (!p[uid]?.birthday) return r('❌ No birthday set.');
        delete p[uid].birthday; saveProfiles(gid, p);
        return r('✅ Your birthday has been removed.');
    }

    // ── Suggestions ───────────────────────────────────────────────────────────
    if (command === 'suggest') {
        const text = args.join(' ');
        if (text.length < 10) return r('❌ Suggestion must be at least 10 characters. Usage: `!suggest <text>`');
        const db = getSug(gid);
        const id = `SUG-${String(db[gid].next++).padStart(4, '0')}`;
        db[gid].list.push({ id, text, authorId: uid, date: Date.now(), upvotes: 0, downvotes: 0, status: 'open' });
        saveSug(db);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('💡 Suggestion Submitted')
            .addFields({ name: 'ID', value: id, inline: true }, { name: 'Suggestion', value: text })
            .setFooter({ text: 'View all suggestions with !suggestions' })] });
    }
    if (command === 'suggestions' || command === 'topsuggestions') {
        const db = getSug(gid);
        let list = db[gid].list.filter(s => s.status === 'open');
        if (command === 'topsuggestions') list = [...list].sort((a, b) => b.upvotes - a.upvotes);
        if (!list.length) return r('No open suggestions. Use `!suggest <text>` to submit one.');
        const lines = list.slice(0, 10).map(s => `**[${s.id}]** ${s.text.slice(0, 80)}${s.text.length > 80 ? '…' : ''}\n*(👍 ${s.upvotes}  👎 ${s.downvotes})*`);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('💡 Suggestions').setDescription(lines.join('\n\n'))] });
    }
    if (command === 'mysuggestions') {
        const db = getSug(gid);
        const mine = db[gid].list.filter(s => s.authorId === uid);
        if (!mine.length) return r('❌ You have no suggestions yet. Use `!suggest <text>`.');
        const lines = mine.slice(0, 10).map(s => `**[${s.id}]** [${s.status}] ${s.text.slice(0, 80)}`);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('💡 Your Suggestions').setDescription(lines.join('\n\n'))] });
    }

    // ── Reminders ─────────────────────────────────────────────────────────────
    if (command === 'remind' || command === 'remindme') {
        if (args.length < 2) return r('❌ Usage: `!remind <time> <message>`. Example: `!remind 30m Check the oven`');
        const ms = parseDuration(args[0]);
        if (!ms) return r('❌ Invalid time. Use: `30s` `10m` `2h` `1d` `1w`');
        if (ms > 30 * 86400000) return r('❌ Maximum reminder time is 30 days.');
        const text = args.slice(1).join(' ');
        const db = getRems();
        if (!db[uid]) db[uid] = [];
        const id = Date.now().toString(36);
        const fireAt = Date.now() + ms;
        db[uid].push({ id, text, fireAt, channelId: message.channel.id });
        saveRems(db);
        setTimeout(async () => {
            try {
                const ch = await client.channels.fetch(message.channel.id);
                await ch.send({ content: `⏰ <@${uid}> Reminder: **${text}**` });
            } catch { }
            const d2 = getRems(); if (d2[uid]) { d2[uid] = d2[uid].filter(r => r.id !== id); saveRems(d2); }
        }, ms);
        const unix = Math.floor(fireAt / 1000);
        return r({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('⏰ Reminder Set')
            .addFields(
                { name: 'Reminder', value: text },
                { name: 'Fires', value: `<t:${unix}:R>`, inline: true },
                { name: 'ID', value: `\`${id}\``, inline: true }
            )] });
    }
    if (command === 'reminders') {
        const db = getRems();
        const mine = (db[uid] || []).filter(r => r.fireAt > Date.now());
        if (!mine.length) return r('❌ No active reminders. Use `!remind <time> <message>`.');
        const lines = mine.map(r => `\`${r.id}\` — **${r.text}** (fires <t:${Math.floor(r.fireAt / 1000)}:R>)`);
        return r({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('⏰ Your Reminders').setDescription(lines.join('\n'))] });
    }
    if (command === 'clearremind') {
        const id = args[0];
        if (!id) return r('❌ Usage: `!clearremind <id>`. Get IDs with `!reminders`.');
        const db = getRems();
        if (!db[uid]?.length) return r('❌ No active reminders.');
        const before = db[uid].length;
        db[uid] = db[uid].filter(r => r.id !== id);
        if (db[uid].length === before) return r('❌ Reminder ID not found.');
        saveRems(db);
        return r('✅ Reminder cancelled.');
    }

    // ── Tags ──────────────────────────────────────────────────────────────────
    if (command === 'tag') {
        const name = args[0]?.toLowerCase();
        if (!name) return r('❌ Usage: `!tag <name>`. See all tags with `!tags`.');
        const tags = getTags(gid);
        const t = tags[name];
        if (!t) return r(`❌ Tag \`${name}\` not found. Use \`!tags\` to see all tags.`);
        t.uses = (t.uses || 0) + 1; saveTags(gid, tags);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🏷️ ${name}`).setDescription(t.content)] });
    }
    if (command === 'tags') {
        const tags = getTags(gid);
        const list = Object.keys(tags);
        if (!list.length) return r('No tags yet. Staff can create tags with `!tagcreate <name> <content>`.');
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🏷️ Tags (${list.length})`).setDescription(list.sort().map(k => `\`${k}\``).join(', '))] });
    }
    if (command === 'taginfo') {
        const name = args[0]?.toLowerCase();
        if (!name) return r('❌ Usage: `!taginfo <name>`');
        const t = getTags(gid)[name];
        if (!t) return r(`❌ Tag \`${name}\` not found.`);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🏷️ Tag: ${name}`)
            .addFields(
                { name: 'Created By', value: `<@${t.authorId}>`, inline: true },
                { name: 'Uses', value: (t.uses || 0).toString(), inline: true },
                { name: 'Created', value: `<t:${Math.floor(t.createdAt / 1000)}:D>`, inline: true },
                { name: 'Content', value: t.content.slice(0, 500) }
            )] });
    }
    if (command === 'tagsearch') {
        const query = args.join(' ').toLowerCase();
        if (!query) return r('❌ Usage: `!tagsearch <query>`');
        const matches = Object.entries(getTags(gid)).filter(([k, t]) => k.includes(query) || t.content.toLowerCase().includes(query));
        if (!matches.length) return r(`❌ No tags found matching \`${query}\`.`);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🔍 Tag Search: "${query}"`).setDescription(matches.slice(0, 15).map(([k]) => `\`${k}\``).join(', '))] });
    }
    if (command === 'tagrecent') {
        const sorted = Object.entries(getTags(gid)).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)).slice(0, 10);
        if (!sorted.length) return r('No tags created yet.');
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🏷️ Recent Tags').setDescription(sorted.map(([k, t]) => `\`${k}\` — <t:${Math.floor((t.createdAt || 0) / 1000)}:R>`).join('\n'))] });
    }
    if (command === 'tagpopular') {
        const sorted = Object.entries(getTags(gid)).sort((a, b) => (b[1].uses || 0) - (a[1].uses || 0)).slice(0, 10);
        if (!sorted.length) return r('No tags created yet.');
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🏷️ Popular Tags').setDescription(sorted.map(([k, t]) => `\`${k}\` — ${t.uses || 0} uses`).join('\n'))] });
    }
    if (command === 'tagcreate') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return r('❌ You need **Manage Messages** to create tags.');
        const name = args[0]?.toLowerCase(), content = args.slice(1).join(' ');
        if (!name || !content) return r('❌ Usage: `!tagcreate <name> <content>`');
        if (name.length > 32) return r('❌ Tag name max 32 characters.');
        const tags = getTags(gid);
        if (tags[name]) return r(`❌ Tag \`${name}\` already exists. Use \`!tagedit\` to modify it.`);
        tags[name] = { content, authorId: uid, createdAt: Date.now(), uses: 0 }; saveTags(gid, tags);
        return r(`✅ Tag \`${name}\` created.`);
    }
    if (command === 'tagdelete') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return r('❌ You need **Manage Messages** to delete tags.');
        const name = args[0]?.toLowerCase();
        if (!name) return r('❌ Usage: `!tagdelete <name>`');
        const tags = getTags(gid);
        if (!tags[name]) return r(`❌ Tag \`${name}\` not found.`);
        delete tags[name]; saveTags(gid, tags);
        return r(`✅ Tag \`${name}\` deleted.`);
    }
    if (command === 'tagedit') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return r('❌ You need **Manage Messages** to edit tags.');
        const name = args[0]?.toLowerCase(), content = args.slice(1).join(' ');
        if (!name || !content) return r('❌ Usage: `!tagedit <name> <new content>`');
        const tags = getTags(gid);
        if (!tags[name]) return r(`❌ Tag \`${name}\` not found.`);
        tags[name].content = content; tags[name].editedAt = Date.now(); saveTags(gid, tags);
        return r(`✅ Tag \`${name}\` updated.`);
    }

    // ── Polls ─────────────────────────────────────────────────────────────────
    if (command === 'poll') {
        const parts = args.join(' ').split('|').map(p => p.trim()).filter(Boolean);
        if (parts.length < 3) return r('❌ Usage: `!poll <question>|<option1>|<option2>`');
        if (parts.length > 10) return r('❌ Maximum 9 options per poll.');
        const [question, ...options] = parts;
        const db = getPolls(gid);
        const id = `POLL-${String(db[gid].next++).padStart(4, '0')}`;
        const opts = options.map((o, i) => ({ emoji: POLL_EMOJIS[i], label: o, votes: [] }));
        db[gid].list.push({ id, question, options: opts, authorId: uid, date: Date.now(), open: true });
        savePolls(db);
        const desc = opts.map(o => `${o.emoji} **${o.label}** — 0 votes`).join('\n');
        const buttons = new ActionRowBuilder().addComponents(
            ...opts.map((o, i) => new ButtonBuilder().setCustomId(`poll_${id}_${i}`).setEmoji(o.emoji).setLabel(o.label.slice(0, 80)).setStyle(ButtonStyle.Secondary))
        );
        const embed = new EmbedBuilder().setColor(0x5865f2)
            .setTitle(`📊 ${question}`)
            .setDescription(desc)
            .setFooter({ text: `Poll ID: ${id}  •  by ${message.author.displayName}  •  Click to vote` });
        await message.channel.send({ embeds: [embed], components: [buttons] });
        if (message.deletable) message.delete().catch(() => {});
        return;
    }
    if (command === 'polls') {
        const db = getPolls(gid);
        const open = db[gid].list.filter(p => p.open);
        if (!open.length) return r('No active polls. Create one with `!poll <question>|<opt1>|<opt2>`');
        const lines = open.slice(0, 10).map(p => `**[${p.id}]** ${p.question} — ${p.options.reduce((a, o) => a + o.votes.length, 0)} votes`);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📊 Active Polls').setDescription(lines.join('\n'))] });
    }
    if (command === 'pollresults') {
        const id = args[0]?.toUpperCase();
        if (!id) return r('❌ Usage: `!pollresults <POLL-XXXX>`');
        const db = getPolls(gid);
        const poll = db[gid].list.find(p => p.id === id);
        if (!poll) return r(`❌ Poll \`${id}\` not found.`);
        const total = poll.options.reduce((a, o) => a + o.votes.length, 0);
        const lines = poll.options.map(o => {
            const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
            const bar = '█'.repeat(Math.ceil(pct / 10)) + '░'.repeat(10 - Math.ceil(pct / 10));
            return `${o.emoji} **${o.label}** — ${o.votes.length} votes (${pct}%)\n\`${bar}\``;
        });
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📊 Results: ${poll.question}`)
            .setDescription(lines.join('\n\n'))
            .setFooter({ text: `${total} total votes  •  ${poll.open ? 'Open' : 'Closed'}` })] });
    }
    if (command === 'endpoll') {
        const id = args[0]?.toUpperCase();
        if (!id) return r('❌ Usage: `!endpoll <POLL-XXXX>`');
        const db = getPolls(gid);
        const poll = db[gid].list.find(p => p.id === id);
        if (!poll) return r(`❌ Poll \`${id}\` not found.`);
        if (poll.authorId !== uid && !message.member.permissions.has(PermissionFlagsBits.ManageMessages))
            return r('❌ Only the poll creator or a moderator can end this poll.');
        poll.open = false; savePolls(db);
        return r(`✅ Poll \`${id}\` closed. Use \`!pollresults ${id}\` to see results.`);
    }
}

// ── Poll vote handler (called from interactionCreate in index.js) ──────────────
async function handlePollVote(interaction) {
    const gid = interaction.guild.id;
    const uid = interaction.user.id;
    // customId format: poll_POLL-0001_0
    const parts = interaction.customId.split('_');
    const optIndex = parseInt(parts.at(-1));
    const pollId   = parts.slice(1, -1).join('_'); // POLL-0001
    const db = getPolls(gid);
    const poll = db[gid]?.list.find(p => p.id === pollId);
    if (!poll) return interaction.reply({ content: '❌ Poll not found.', ephemeral: true });
    if (!poll.open) return interaction.reply({ content: '❌ This poll is closed.', ephemeral: true });
    // Remove any existing vote from this user, then add new one
    poll.options.forEach(o => { o.votes = o.votes.filter(v => v !== uid); });
    poll.options[optIndex].votes.push(uid);
    savePolls(db);
    const total = poll.options.reduce((a, o) => a + o.votes.length, 0);
    const desc = poll.options.map((o, i) => {
        const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
        return `${POLL_EMOJIS[i]} **${o.label}** — ${o.votes.length} vote${o.votes.length !== 1 ? 's' : ''} (${pct}%)`;
    }).join('\n');
    const buttons = new ActionRowBuilder().addComponents(
        ...poll.options.map((o, i) => new ButtonBuilder()
            .setCustomId(`poll_${pollId}_${i}`)
            .setEmoji(POLL_EMOJIS[i])
            .setLabel(o.label.slice(0, 80))
            .setStyle(i === optIndex ? ButtonStyle.Primary : ButtonStyle.Secondary))
    );
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0x5865f2)
        .setTitle(`📊 ${poll.question}`)
        .setDescription(desc)
        .setFooter({ text: `Poll ID: ${pollId}  •  ${total} votes` })], components: [buttons] });
}

const SOCIAL_CMDS = [
    'afk','unafk','afklist',
    'greet','congrats','thank','welcome',
    'kudos','mykudos','topkudos',
    'rep','myrep','toprep',
    'setbio','mybio','settimezone','timezone','profile',
    'setbirthday','birthday','birthdaylist','birthdaytoday','clearbirthday',
    'suggest','suggestions','mysuggestions','topsuggestions',
    'remind','remindme','reminders','clearremind',
    'tag','tags','taginfo','tagsearch','tagrecent','tagpopular','tagcreate','tagdelete','tagedit',
    'poll','polls','pollresults','endpoll'
];

module.exports = { handleCommand, handlePollVote, SOCIAL_CMDS };
