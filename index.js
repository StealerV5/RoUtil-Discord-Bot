const {
    Client, GatewayIntentBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder, ChannelType,
    PermissionFlagsBits, AttachmentBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const express = require('express');
const fs = require('fs');

// ── Staff management systems ──────────────────────────────────────────────────
const modSystem    = require('./systems/moderation');
const cfgSystem    = require('./systems/config');
const profileSys   = require('./systems/staffProfile');
const loaSys       = require('./systems/loa');
const promoSys     = require('./systems/promotions');
const trainSys     = require('./systems/training');
const feedbackSys  = require('./systems/feedback');
const activitySys  = require('./systems/activity');
const deptSys      = require('./systems/departments');
const analyticsSys = require('./systems/analytics');

// 1. Web server for 24/7 uptime
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is online!");
});

app.listen(3000, () => {
  console.log("Web server running");
});

// 2. Initialize Bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const DEFAULT_PREFIX = '!';
let prefixes = {};
if (fs.existsSync('./prefixes.json')) {
    prefixes = JSON.parse(fs.readFileSync('./prefixes.json', 'utf8'));
}

// ── Verification config ───────────────────────────────────────────────────────

let verifyConfig = {};
if (fs.existsSync('./verifyConfig.json')) {
    verifyConfig = JSON.parse(fs.readFileSync('./verifyConfig.json', 'utf8'));
}
function saveVerifyConfig() {
    fs.writeFileSync('./verifyConfig.json', JSON.stringify(verifyConfig, null, 4));
}

// ── Report config ─────────────────────────────────────────────────────────────

let reportConfig = {};
if (fs.existsSync('./reportConfig.json')) {
    reportConfig = JSON.parse(fs.readFileSync('./reportConfig.json', 'utf8'));
}
function saveReportConfig() {
    fs.writeFileSync('./reportConfig.json', JSON.stringify(reportConfig, null, 4));
}

// ── Appeal config ─────────────────────────────────────────────────────────────

let appealConfig = {};
if (fs.existsSync('./appealConfig.json')) {
    appealConfig = JSON.parse(fs.readFileSync('./appealConfig.json', 'utf8'));
}
function saveAppealConfig() {
    fs.writeFileSync('./appealConfig.json', JSON.stringify(appealConfig, null, 4));
}

// ── Tickets database ──────────────────────────────────────────────────────────

let tickets = { channels: {}, activeReports: {}, activeAppeals: {}, nextReportId: 1, nextAppealId: 1 };
if (fs.existsSync('./tickets.json')) {
    tickets = { ...tickets, ...JSON.parse(fs.readFileSync('./tickets.json', 'utf8')) };
}
function saveTickets() {
    fs.writeFileSync('./tickets.json', JSON.stringify(tickets, null, 4));
}

// Tracks in-progress setup sessions: guildId → state object
const verifySetupState  = new Map();
const reportSetupState  = new Map();
const appealSetupState  = new Map();

// ── Commands list (update this array every time a new command is added) ───────
const COMMANDS = [
    { name: '!ping',                           desc: 'Check if the bot is online.' },
    { name: '!setprefix <new>',                desc: 'Change the command prefix for this server. Requires **Manage Server**.' },
    { name: '!find [user|item] <query>',       desc: 'Search Roblox for users or marketplace items.' },
    { name: '!find item <query> by <creator>', desc: 'Search marketplace items filtered by a specific creator.' },
    { name: '!reportsetup',                    desc: 'Set up the player report ticket system. Requires **Manage Server**.' },
    { name: '!appealsetup',                    desc: 'Set up the ban appeal ticket system. Requires **Manage Server**.' },
    { name: '!verifysetup',                    desc: 'Run the 5-step Roblox verification setup wizard. Requires **Manage Server**.' },
    { name: '!verify',                         desc: 'Link your Roblox account to this server via bio code or gamepass check.' },
    { name: '!whois @user',                    desc: 'Look up the Roblox account linked to a Discord user.' },
    { name: '!verified',                       desc: 'Show how many members have verified their Roblox account.' },
    { name: '!serverstats',                    desc: 'Show member, channel, and role counts for this server.' },
    { name: '!userinfo [@user]',               desc: 'Show Discord info about a member (or yourself).' },
    { name: '!avatar [@user]',                 desc: 'Show a user\'s full-size Discord avatar.' },
    { name: '!cmds [page]',                    desc: 'Show this commands list. 10 commands per page.' },
    // ── Staff Management System ───────────────────────────────────────────────
    { name: '!setupmod',                       desc: 'Configure moderator, HR, and management roles + Roblox Group ID. Admin only.' },
    { name: '!setuplogs',                      desc: 'Configure log channels for moderation, promotions, appeals, training, feedback, and LOA. Admin only.' },
    { name: '!setupranks',                     desc: 'Map Roblox rank IDs to Discord roles. Admin only.' },
    { name: '!setupdepartments',               desc: 'Configure department role assignments. Admin only.' },
    { name: '!setuproles',                     desc: 'Configure HR and management roles. Admin only.' },
    { name: '!warn @user <reason>',            desc: 'Issue a formal warning to a staff member. Creates a case with case number.' },
    { name: '!strike @user <reason>',          desc: 'Issue a strike. Auto-escalates at 2 (suspension), 3 (demotion), 5 (termination review).' },
    { name: '!removestrike @user <reason>',    desc: 'Remove one active strike from a staff member.' },
    { name: '!suspend @user <duration> <reason>', desc: 'Suspend a staff member. Durations: 1d, 3d, 7d, 14d, perm. Auto-expires.' },
    { name: '!demote @user <reason>',          desc: 'Demote a staff member. Logged to case system and promotion log channel.' },
    { name: '!terminate @user <reason>',       desc: 'Terminate a staff member. HR role required.' },
    { name: '!ban @user <reason>',             desc: 'Ban a staff member from the server. HR role required.' },
    { name: '!unban <userID> <reason>',        desc: 'Unban a user by ID. HR role required.' },
    { name: '!note @user <text>',              desc: 'Add a staff note to a member\'s record. Visible in their profile.' },
    { name: '!staffprofile [@user]',           desc: 'Display a full staff profile: cases, strikes, LOA, trainings, activity score.' },
    { name: '!loasetup',                       desc: 'Post the Leave of Absence panel. HR or Admin only.' },
    { name: '!loaend',                         desc: 'Manually end your own active LOA.' },
    { name: '!promotionsetup',                 desc: 'Post the promotion request panel. Admin only.' },
    { name: '!demotionsetup',                  desc: 'Post the demotion recommendation panel. Admin only.' },
    { name: '!promote @user <reason>',         desc: 'Manually log a promotion. HR role required.' },
    { name: '!checkpromotion [@user]',         desc: 'Check if a staff member meets promotion eligibility.' },
    { name: '!trainingcreate <name>|<desc>',   desc: 'Create a new training session with a name and description.' },
    { name: '!traininghost <TRAIN-XXXX>',      desc: 'Start hosting a training session. Posts a join button.' },
    { name: '!trainingcomplete <id> <pass|fail> @users', desc: 'Log training results and update staff training records.' },
    { name: '!traininglist',                   desc: 'List all training sessions and their status.' },
    { name: '!feedbacksetup',                  desc: 'Post the staff feedback panel (positive, concern, general). Admin only.' },
    { name: '!activity [@user]',               desc: 'View a staff member\'s activity statistics and score.' },
    { name: '!leaderboard',                    desc: 'Show the top 15 most active staff members by score.' },
    { name: '!addscore @user <points>',        desc: 'Manually add activity score points to a member. Admin only.' },
    { name: '!resetactivity @user',            desc: 'Reset a member\'s activity tracking data. Admin only.' },
    { name: '!departments',                    desc: 'Show an overview of all departments with member count and performance.' },
    { name: '!department <name>',              desc: 'Show the dashboard for a specific department.' },
    { name: '!deptadd <dept> @user',           desc: 'Add a staff member to a department. HR or Admin.' },
    { name: '!deptremove <dept> @user',        desc: 'Remove a staff member from a department. HR or Admin.' },
    { name: '!deptperformance <dept> <0-100>', desc: 'Set a department\'s performance score. HR or Admin.' },
    { name: '!dashboard',                      desc: 'Show a real-time overview dashboard of all staff management stats.' },
    { name: '!stats',                          desc: 'Show detailed moderation statistics: cases by type, top mods, monthly trends.' },
];

// ── Ready ─────────────────────────────────────────────────────────────────────

client.once('clientReady', () => {
    console.log(`Success! Logged in as ${client.user.tag}`);
    // Run suspension expiry check every hour
    modSystem.tickSuspensions(client);
    setInterval(() => modSystem.tickSuspensions(client), 3_600_000);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function levenshtein(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    const m = [];
    for (let i = 0; i <= b.length; i++) m[i] = [i];
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            m[i][j] = b[i - 1] === a[j - 1]
                ? m[i - 1][j - 1]
                : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
        }
    }
    return m[b.length][a.length];
}

function didYouMean(query, topName) {
    const dist = levenshtein(query, topName);
    const threshold = Math.max(2, Math.floor(query.length / 3));
    if (dist > 0 && dist <= threshold) return `💡 Did you mean **${topName}**?`;
    return null;
}

async function robloxGet(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

let xsrfToken = null;
async function robloxPost(url, body) {
    const attempt = (token) => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
        body: JSON.stringify(body)
    });
    let res = await attempt(xsrfToken);
    if (res.status === 403) {
        const newToken = res.headers.get('x-csrf-token');
        if (newToken) { xsrfToken = newToken; res = await attempt(xsrfToken); }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ── Roblox API ────────────────────────────────────────────────────────────────

async function searchUsers(query) {
    const data = await robloxGet(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(query)}&limit=10`);
    return data.data || [];
}
async function getUserStats(userId) {
    const [fl, fw] = await Promise.all([
        robloxGet(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
        robloxGet(`https://friends.roblox.com/v1/users/${userId}/followings/count`)
    ]);
    return { followers: fl.count ?? 0, following: fw.count ?? 0 };
}
async function getUserGames(userId) {
    const data = await robloxGet(`https://games.roblox.com/v2/users/${userId}/games?limit=5&sortOrder=Desc`);
    return data.data || [];
}
async function searchCatalog(query, creatorName = null) {
    let url = `https://catalog.roblox.com/v1/search/items?keyword=${encodeURIComponent(query)}&limit=10&category=All`;
    if (creatorName) url += `&creatorName=${encodeURIComponent(creatorName)}`;
    const data = await robloxGet(url);
    return data.data || [];
}
async function getCatalogDetails(items) {
    if (!items.length) return [];
    const data = await robloxPost('https://catalog.roblox.com/v1/catalog/items/details', { items });
    return data.data || [];
}

// ── Embed builders ────────────────────────────────────────────────────────────

async function buildUserEmbed(user, index, total, query) {
    const embed = new EmbedBuilder()
        .setColor(0x00b4d8)
        .setTitle(`👤 ${user.displayName} (@${user.name})`)
        .setURL(`https://www.roblox.com/users/${user.id}/profile`)
        .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${user.id}&width=420&height=420&format=png`)
        .setFooter({ text: `Result ${index + 1} of ${total}  •  User  •  Roblox` });

    const correction = didYouMean(query, user.name);
    const desc = user.blurb ? user.blurb.slice(0, 350) : '_No description set._';
    embed.setDescription((correction ? `${correction}\n\n` : '') + desc);

    try {
        const stats = await getUserStats(user.id);
        embed.addFields(
            { name: '👥 Followers', value: stats.followers.toLocaleString(), inline: true },
            { name: '➡️ Following', value: stats.following.toLocaleString(), inline: true }
        );
    } catch { }

    try {
        const games = await getUserGames(user.id);
        if (games.length > 0) {
            const gameList = games.slice(0, 5)
                .map(g => `• [${g.name}](https://www.roblox.com/games/${g.rootPlace?.id ?? g.id})`)
                .join('\n');
            embed.addFields({ name: '🎮 Their Games', value: gameList });
        }
    } catch { }

    return embed;
}

function buildCatalogEmbed(item, index, total, query) {
    const price = item.price != null ? `R$${item.price.toLocaleString()}` : '🔒 Offsale';
    const rap   = item.recentAveragePrice ? `R$${item.recentAveragePrice.toLocaleString()}` : 'N/A';
    const lowestPrice = item.lowestPrice != null ? `R$${item.lowestPrice.toLocaleString()}` : 'N/A';

    const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle(`🛒 ${item.name}`)
        .setURL(`https://www.roblox.com/catalog/${item.id}`)
        .setDescription((item.description || '_No description available._').slice(0, 400))
        .addFields(
            { name: '💰 Price',        value: price,                         inline: true },
            { name: '📈 RAP',          value: rap,                           inline: true },
            { name: '📉 Lowest Price', value: lowestPrice,                   inline: true },
            { name: '🏷️ Type',         value: item.itemType ?? 'Asset',      inline: true },
            { name: '👤 Creator',      value: item.creatorName ?? 'Unknown', inline: true }
        )
        .setFooter({ text: `Result ${index + 1} of ${total}  •  Catalog  •  Roblox` });

    const correction = didYouMean(query, item.name);
    if (correction) embed.setDescription(`${correction}\n\n${embed.data.description}`);
    if (item.id) embed.setThumbnail(`https://www.roblox.com/asset-thumbnail/image?assetId=${item.id}&width=420&height=420&format=png`);

    return embed;
}

async function buildEmbed(result, index, total, query) {
    if (result.type === 'user')    return buildUserEmbed(result.data, index, total, query);
    if (result.type === 'catalog') return buildCatalogEmbed(result.data, index, total, query);
}

function buildFindButtons(page, total) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('find_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('find_info').setLabel(`${page + 1} / ${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId('find_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === total - 1)
    );
}

// ── Verify Setup — interaction handler ───────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
    // ── Route to staff management systems ────────────────────────────────────
    const cid = interaction.customId || '';
    if (cid.startsWith('mod_'))  return modSystem.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('cfg_'))  return cfgSystem.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('sp_'))   return profileSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('loa_') || cid === 'loa_create' || cid === 'loa_modal')
                                 return loaSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('promo_') || cid === 'promo_request' || cid === 'promo_modal' ||
        cid === 'promo_demotion' || cid === 'promo_demotion_modal')
                                 return promoSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('train_'))return trainSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('fb_'))   return feedbackSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('act_'))  return activitySys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('dept_')) return deptSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('dash_')) return analyticsSys.handleInteraction(interaction).catch(console.error);
    if (!interaction.guild) return;
    const gid = interaction.guild.id;

    try {

        // ══════════════════════════════════════════════════════════════════════
        // SECTION A — VERIFY SETUP  (vs_* custom IDs)
        // ══════════════════════════════════════════════════════════════════════
        const isVerifyInteraction =
            (interaction.isStringSelectMenu() && (interaction.customId === `vs_q1_${gid}` || interaction.customId === `vs_q3_${gid}`)) ||
            (interaction.isRoleSelectMenu()   && (interaction.customId === `vs_q4a_${gid}` || interaction.customId === `vs_q4b_${gid}`)) ||
            (interaction.isButton()           &&  interaction.customId === `vs_next_${gid}`) ||
            (interaction.isModalSubmit()      && (interaction.customId === `vs_gpmodal_${gid}` || interaction.customId === `vs_q2modal_${gid}`));

        if (isVerifyInteraction) {
            const state = verifySetupState.get(gid);
            if (!state) return;
            if (interaction.user.id !== state.authorId) {
                return interaction.reply({ content: '❌ Only the person who started setup can interact with this.', ephemeral: true });
            }
        // ── Q1: Choose verification method ────────────────────────────────────
        if (interaction.isStringSelectMenu() && interaction.customId === `vs_q1_${gid}`) {
            state.method = interaction.values[0];

            if (state.method === 'gamepass') {
                await interaction.showModal(
                    new ModalBuilder()
                        .setCustomId(`vs_gpmodal_${gid}`)
                        .setTitle('Gamepass ID')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('gamepass_id')
                                    .setLabel('Enter your Roblox Gamepass ID')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('e.g. 123456789')
                                    .setMinLength(1).setMaxLength(20)
                                    .setRequired(true)
                            )
                        )
                );
            } else {
                // Bio — go straight to step 1 complete + Next button
                await interaction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x57f287)
                            .setTitle('✅ Step 1 Complete — Bio Verification')
                            .setDescription(
                                'Members will receive a **unique code** to paste into their Roblox profile bio.\n' +
                                'RoUtil will check the bio automatically when they run the verify command.\n\n' +
                                'Click **Next** to customise what the verification message looks like.'
                            )
                            .setFooter({ text: 'Step 1 of 5 complete' })
                    ],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`vs_next_${gid}`)
                                .setLabel('Next: Customise Message →')
                                .setStyle(ButtonStyle.Primary)
                        )
                    ]
                });
            }
        }

        // ── Gamepass modal submit ─────────────────────────────────────────────
        if (interaction.isModalSubmit() && interaction.customId === `vs_gpmodal_${gid}`) {
            state.gamepasId = interaction.fields.getTextInputValue('gamepass_id').trim();

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57f287)
                        .setTitle('✅ Step 1 Complete — Gamepass Verification')
                        .setDescription(
                            `Gamepass ID \`${state.gamepasId}\` saved.\n\n` +
                            'Members must own the **"RoUtil"** gamepass in your game to verify their account.\n\n' +
                            'Click **Next** to customise what the verification message looks like.'
                        )
                        .setFooter({ text: 'Step 1 of 5 complete' })
                ],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`vs_next_${gid}`)
                            .setLabel('Next: Customise Message →')
                            .setStyle(ButtonStyle.Primary)
                    )
                ]
            });
        }

        // ── Next button → open Q2 modal ───────────────────────────────────────
        if (interaction.isButton() && interaction.customId === `vs_next_${gid}`) {
            await interaction.showModal(
                new ModalBuilder()
                    .setCustomId(`vs_q2modal_${gid}`)
                    .setTitle('Step 2 — Verification Message')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('msg_title')
                                .setLabel('Title')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('e.g. Verify your Roblox Account')
                                .setMaxLength(256).setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('msg_description')
                                .setLabel('Description')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('Explain how members should verify...')
                                .setMaxLength(2000).setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('msg_thumbnail')
                                .setLabel('Thumbnail Image URL (optional)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('https://example.com/image.png')
                                .setRequired(false)
                        )
                    )
            );
        }

        // ── Q2 modal submit → show Q3 ─────────────────────────────────────────
        if (interaction.isModalSubmit() && interaction.customId === `vs_q2modal_${gid}`) {
            state.title       = interaction.fields.getTextInputValue('msg_title').trim();
            state.description = interaction.fields.getTextInputValue('msg_description').trim();
            state.thumbnail   = interaction.fields.getTextInputValue('msg_thumbnail').trim() || null;

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('📋 Step 3 of 3 — Message Style')
                        .setDescription(
                            'Should the verification message be sent as a **rich embed** or **plain text**?\n\n' +
                            '> 🎨 **Embed** — A colourful card showing your title, description, and thumbnail image.\n\n' +
                            '> 📝 **Simple Text** — A plain text message with no extra formatting.'
                        )
                        .addFields(
                            { name: '📌 Your Title',       value: state.title,                                                     inline: false },
                            { name: '📄 Your Description', value: state.description.slice(0, 200) + (state.description.length > 200 ? '…' : ''), inline: false },
                            ...(state.thumbnail ? [{ name: '🖼️ Thumbnail', value: state.thumbnail, inline: false }] : [])
                        )
                        .setFooter({ text: 'Step 3 of 5 • Halfway there!' })
                ],
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`vs_q3_${gid}`)
                            .setPlaceholder('Choose a message style...')
                            .addOptions(
                                { label: 'Embed', description: 'Rich card with title, description, and thumbnail', value: 'embed', emoji: '🎨' },
                                { label: 'Simple Text', description: 'Plain text message with no formatting', value: 'text', emoji: '📝' }
                            )
                    )
                ]
            });
        }

        // ── Q3: Style → show Q4a (join role) ─────────────────────────────────
        if (interaction.isStringSelectMenu() && interaction.customId === `vs_q3_${gid}`) {
            state.style = interaction.values[0];

            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('👋 Step 4 of 5 — Join Role')
                        .setDescription(
                            'Select the role to **automatically give every new member** when they join the server.\n\n' +
                            '> This is typically an "Unverified" or "Member" role that restricts channel access until they verify.'
                        )
                        .setFooter({ text: 'Step 4 of 5' })
                ],
                components: [
                    new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId(`vs_q4a_${gid}`)
                            .setPlaceholder('Select the join role...')
                    )
                ]
            });
        }

        // ── Q4a: Join role → show Q4b (verified role) ────────────────────────
        if (interaction.isRoleSelectMenu() && interaction.customId === `vs_q4a_${gid}`) {
            state.joinRoleId = interaction.values[0];

            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('✅ Step 5 of 5 — Verified Role')
                        .setDescription(
                            'Select the role to give members **once they successfully verify** their Roblox account.\n\n' +
                            '> This is typically a "Verified" role that grants access to the rest of the server.'
                        )
                        .addFields({ name: '👋 Join Role', value: `<@&${state.joinRoleId}>`, inline: true })
                        .setFooter({ text: 'Step 5 of 5 • Final step!' })
                ],
                components: [
                    new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId(`vs_q4b_${gid}`)
                            .setPlaceholder('Select the verified role...')
                    )
                ]
            });
        }

        // ── Q4b: Verified role → save config + summary ────────────────────────
        if (interaction.isRoleSelectMenu() && interaction.customId === `vs_q4b_${gid}`) {
            state.verifiedRoleId = interaction.values[0];

            verifyConfig[gid] = {
                method:        state.method,
                gamepasId:     state.method === 'gamepass' ? state.gamepasId : undefined,
                title:         state.title,
                description:   state.description,
                thumbnail:     state.thumbnail,
                style:         state.style,
                joinRoleId:    state.joinRoleId,
                verifiedRoleId: state.verifiedRoleId
            };
            saveVerifyConfig();
            verifySetupState.delete(gid);

            const methodText = state.method === 'bio'
                ? '🔖 Bio Verification'
                : `🎫 Gamepass Verification (ID: \`${state.gamepasId}\`)`;

            const summary = new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle('🎉 Verification Setup Complete!')
                .setDescription('Your verification system is fully configured. Here\'s a summary:')
                .addFields(
                    { name: '🔐 Verification Method', value: methodText,                                                                                       inline: false },
                    { name: '📝 Message Title',        value: state.title,                                                                                      inline: true  },
                    { name: '🎨 Message Style',        value: state.style === 'embed' ? '🎨 Embed' : '📝 Simple Text',                                          inline: true  },
                    { name: '👋 Join Role',            value: `<@&${state.joinRoleId}> — given to every new member on join`,                                    inline: false },
                    { name: '✅ Verified Role',        value: `<@&${state.verifiedRoleId}> — given when a member verifies`,                                     inline: false },
                    { name: '📄 Description Preview',  value: state.description.slice(0, 200) + (state.description.length > 200 ? '…' : ''),                   inline: false },
                    ...(state.thumbnail ? [{ name: '🖼️ Thumbnail', value: state.thumbnail, inline: false }] : [])
                )
                .setFooter({ text: 'Members can now run !verify to link their Roblox account' });

            if (state.thumbnail) summary.setThumbnail(state.thumbnail);

            await interaction.update({ embeds: [summary], components: [] });
        }

            return; // end of verify setup section
        }

        // ══════════════════════════════════════════════════════════════════════
        // SECTION B — REPORT SETUP  (rs_* custom IDs)
        // ══════════════════════════════════════════════════════════════════════
        const isReportSetup =
            (interaction.isChannelSelectMenu() && (interaction.customId === `rs_cat_${gid}` || interaction.customId === `rs_log_${gid}`)) ||
            (interaction.isRoleSelectMenu()    &&  interaction.customId === `rs_mod_${gid}`);

        if (isReportSetup) {
            const state = reportSetupState.get(gid);
            if (!state) return;
            if (interaction.user.id !== state.authorId) {
                return interaction.reply({ content: '❌ Only the person who started setup can interact with this.', ephemeral: true });
            }

            // Step 1 → category chosen, ask for log channel
            if (interaction.customId === `rs_cat_${gid}`) {
                state.categoryId = interaction.values[0];
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 Report Setup — Step 2 of 3')
                        .setDescription('Select the **text channel** where report summaries will be logged.')
                        .setFooter({ text: 'Step 2 of 3' })],
                    components: [new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder().setCustomId(`rs_log_${gid}`).setPlaceholder('Select log channel...').setChannelTypes(ChannelType.GuildText)
                    )]
                });
            }

            // Step 2 → log channel chosen, ask for mod role
            if (interaction.customId === `rs_log_${gid}`) {
                state.logChannelId = interaction.values[0];
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 Report Setup — Step 3 of 3')
                        .setDescription('Select the **Moderator Role** that can manage and action reports.')
                        .setFooter({ text: 'Step 3 of 3 • Final step!' })],
                    components: [new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder().setCustomId(`rs_mod_${gid}`).setPlaceholder('Select moderator role(s)...').setMinValues(1).setMaxValues(10)
                    )]
                });
            }

            // Step 3 → mod role(s) chosen, save config + send panel
            if (interaction.customId === `rs_mod_${gid}`) {
                state.modRoleIds = interaction.values;
                reportConfig[gid] = { categoryId: state.categoryId, logChannelId: state.logChannelId, modRoleIds: state.modRoleIds };
                saveReportConfig();
                reportSetupState.delete(gid);

                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Report Setup Complete!')
                        .setDescription('The report panel has been posted. Use `!reportsetup` to reconfigure.')
                        .addFields(
                            { name: '📁 Category',     value: `<#${state.categoryId}>`,                                       inline: true  },
                            { name: '📋 Log Channel',  value: `<#${state.logChannelId}>`,                                     inline: true  },
                            { name: '🛡️ Mod Roles',   value: state.modRoleIds.map(id => `<@&${id}>`).join('\n'), inline: false }
                        )],
                    components: []
                });

                // Post the persistent report panel
                await interaction.channel.send({
                    embeds: [new EmbedBuilder().setColor(0xe74c3c)
                        .setTitle('🚨 Player Report System')
                        .setDescription('Use the button below to report exploiters, hackers, teamers, bypassers, or rule breakers. Please provide valid evidence.')],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('report_create').setLabel('📝 Create Report').setStyle(ButtonStyle.Danger)
                    )]
                });
            }

            return;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SECTION C — APPEAL SETUP  (as_* custom IDs)
        // ══════════════════════════════════════════════════════════════════════
        const isAppealSetup =
            (interaction.isChannelSelectMenu() && (interaction.customId === `as_cat_${gid}` || interaction.customId === `as_log_${gid}`)) ||
            (interaction.isRoleSelectMenu()    &&  interaction.customId === `as_mod_${gid}`);

        if (isAppealSetup) {
            const state = appealSetupState.get(gid);
            if (!state) return;
            if (interaction.user.id !== state.authorId) {
                return interaction.reply({ content: '❌ Only the person who started setup can interact with this.', ephemeral: true });
            }

            if (interaction.customId === `as_cat_${gid}`) {
                state.categoryId = interaction.values[0];
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('📩 Appeal Setup — Step 2 of 3')
                        .setDescription('Select the **text channel** where appeal summaries will be logged.')
                        .setFooter({ text: 'Step 2 of 3' })],
                    components: [new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder().setCustomId(`as_log_${gid}`).setPlaceholder('Select log channel...').setChannelTypes(ChannelType.GuildText)
                    )]
                });
            }

            if (interaction.customId === `as_log_${gid}`) {
                state.logChannelId = interaction.values[0];
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('📩 Appeal Setup — Step 3 of 3')
                        .setDescription('Select the **Moderator Role** that can manage and action appeals.')
                        .setFooter({ text: 'Step 3 of 3 • Final step!' })],
                    components: [new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder().setCustomId(`as_mod_${gid}`).setPlaceholder('Select moderator role(s)...').setMinValues(1).setMaxValues(10)
                    )]
                });
            }

            if (interaction.customId === `as_mod_${gid}`) {
                state.modRoleIds = interaction.values;
                appealConfig[gid] = { categoryId: state.categoryId, logChannelId: state.logChannelId, modRoleIds: state.modRoleIds };
                saveAppealConfig();
                appealSetupState.delete(gid);

                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Appeal Setup Complete!')
                        .setDescription('The appeal panel has been posted. Use `!appealsetup` to reconfigure.')
                        .addFields(
                            { name: '📁 Category',    value: `<#${state.categoryId}>`,                                        inline: true  },
                            { name: '📋 Log Channel', value: `<#${state.logChannelId}>`,                                      inline: true  },
                            { name: '🛡️ Mod Roles',  value: state.modRoleIds.map(id => `<@&${id}>`).join('\n'), inline: false }
                        )],
                    components: []
                });

                await interaction.channel.send({
                    embeds: [new EmbedBuilder().setColor(0x3498db)
                        .setTitle('📩 Ban Appeal System')
                        .setDescription('If you believe your punishment was unfair, submit an appeal using the button below.')],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('appeal_create').setLabel('📨 Create Appeal').setStyle(ButtonStyle.Primary)
                    )]
                });
            }

            return;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SECTION D — TICKET BUTTONS
        // ══════════════════════════════════════════════════════════════════════
        if (!interaction.isButton()) return;

        // ── Helper: run Q&A in a ticket channel ───────────────────────────────
        async function collectAnswers(channel, userId, questions) {
            const answers = [];
            for (const q of questions) {
                await channel.send(q);
                const res = await channel.awaitMessages({
                    filter: m => m.author.id === userId,
                    max: 1,
                    time: 300_000
                }).catch(() => null);
                if (!res || res.size === 0) return null;
                answers.push(res.first().content);
            }
            return answers;
        }

        // ── Create Report Ticket ───────────────────────────────────────────────
        if (interaction.customId === 'report_create') {
            const cfg = reportConfig[gid];
            if (!cfg) return interaction.reply({ content: '❌ Reports are not set up. Ask an admin to run `!reportsetup`.', ephemeral: true });

            const key = `${gid}_${interaction.user.id}`;
            if (tickets.activeReports[key]) {
                const existing = interaction.guild.channels.cache.get(tickets.activeReports[key]);
                if (existing) return interaction.reply({ content: `❌ You already have an open report: ${existing}`, ephemeral: true });
                delete tickets.activeReports[key];
                saveTickets();
            }

            await interaction.deferReply({ ephemeral: true });

            // Create private ticket channel
            const channel = await interaction.guild.channels.create({
                name: `report-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
                type: ChannelType.GuildText,
                parent: cfg.categoryId,
                permissionOverwrites: [
                    { id: interaction.guild.id,       deny:  [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
                    ...(cfg.modRoleIds ?? (cfg.modRoleId ? [cfg.modRoleId] : [])).map(id => ({
                        id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    }))
                ]
            });

            const ticketId = `R-${String(tickets.nextReportId++).padStart(4, '0')}`;
            tickets.activeReports[key] = channel.id;
            saveTickets();

            await interaction.editReply({ content: `✅ Report ticket created: ${channel}` });

            // Send intro embed
            await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 Report Submission')
                    .setDescription(
                        `**Ticket ID:** \`${ticketId}\`\n\n` +
                        'Answer the questions below one at a time. You have **5 minutes** per answer.\n\n' +
                        '**1.** Roblox Username of Suspect\n' +
                        '**2.** What happened?\n' +
                        '**3.** Video Evidence Link\n' +
                        '**4.** Additional Evidence (or type `none`)'
                    )]
            });

            // Collect answers
            const answers = await collectAnswers(channel, interaction.user.id, [
                '**[1/4]** What is the **Roblox username** of the suspect?',
                '**[2/4]** What **happened**? Describe the incident in detail.',
                '**[3/4]** Provide a **video evidence link** (YouTube, Gyazo, Streamable, etc.).',
                '**[4/4]** Any **additional evidence or info**? (type `none` if not applicable)'
            ]);

            if (!answers) {
                await channel.send('⏱️ Timed out. This channel will be deleted in 10 seconds.');
                delete tickets.activeReports[key];
                saveTickets();
                setTimeout(() => channel.delete().catch(() => {}), 10_000);
                return;
            }

            // Post to log channel
            const logCh = interaction.guild.channels.cache.get(cfg.logChannelId);
            if (!logCh) return;

            const logEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle(`🚨 Report — ${ticketId}`)
                .addFields(
                    { name: '🆔 Report ID',       value: ticketId,                                                   inline: true  },
                    { name: '👤 Reporter',         value: `${interaction.user.tag} (<@${interaction.user.id}>)`,      inline: true  },
                    { name: '🎮 Suspect Username', value: answers[0],                                                 inline: true  },
                    { name: '📝 What Happened',    value: answers[1].slice(0, 1024),                                  inline: false },
                    { name: '🎥 Video Evidence',   value: answers[2],                                                 inline: false },
                    { name: '📎 Additional Info',  value: answers[3],                                                 inline: false },
                    { name: '📅 Date',             value: `<t:${Math.floor(Date.now() / 1000)}:F>`,                   inline: true  },
                    { name: '🔄 Status',           value: '🟡 Pending Review',                                        inline: true  }
                );

            const logRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket_accept_${channel.id}`).setLabel('✅ Accept Report').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ticket_reject_${channel.id}`).setLabel('❌ Reject Report').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`ticket_close_${channel.id}`).setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Secondary)
            );

            const logMsg = await logCh.send({ embeds: [logEmbed], components: [logRow] });

            // Persist
            tickets.channels[channel.id] = {
                type: 'report', guildId: gid, userId: interaction.user.id,
                ticketId, logMessageId: logMsg.id, logChannelId: cfg.logChannelId,
                status: 'pending', answers
            };
            saveTickets();

            await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Report Submitted')
                .setDescription('Your report has been submitted to the moderation team. Please stand by.')
                .addFields({ name: '🆔 Ticket ID', value: ticketId, inline: true })] });
        }

        // ── Create Appeal Ticket ───────────────────────────────────────────────
        if (interaction.customId === 'appeal_create') {
            const cfg = appealConfig[gid];
            if (!cfg) return interaction.reply({ content: '❌ Appeals are not set up. Ask an admin to run `!appealsetup`.', ephemeral: true });

            const key = `${gid}_${interaction.user.id}`;
            if (tickets.activeAppeals[key]) {
                const existing = interaction.guild.channels.cache.get(tickets.activeAppeals[key]);
                if (existing) return interaction.reply({ content: `❌ You already have an open appeal: ${existing}`, ephemeral: true });
                delete tickets.activeAppeals[key];
                saveTickets();
            }

            await interaction.deferReply({ ephemeral: true });

            const channel = await interaction.guild.channels.create({
                name: `appeal-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
                type: ChannelType.GuildText,
                parent: cfg.categoryId,
                permissionOverwrites: [
                    { id: interaction.guild.id,       deny:  [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
                    ...(cfg.modRoleIds ?? (cfg.modRoleId ? [cfg.modRoleId] : [])).map(id => ({
                        id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    }))
                ]
            });

            const ticketId = `A-${String(tickets.nextAppealId++).padStart(4, '0')}`;
            tickets.activeAppeals[key] = channel.id;
            saveTickets();

            await interaction.editReply({ content: `✅ Appeal ticket created: ${channel}` });

            await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('📩 Appeal Submission')
                    .setDescription(
                        `**Ticket ID:** \`${ticketId}\`\n\n` +
                        'Answer the questions below one at a time. You have **5 minutes** per answer.\n\n' +
                        '**1.** Your Roblox Username\n' +
                        '**2.** Punishment Type\n' +
                        '**3.** Punishment Reason\n' +
                        '**4.** Why should it be removed?\n' +
                        '**5.** Additional Information (or type `none`)'
                    )]
            });

            const answers = await collectAnswers(channel, interaction.user.id, [
                '**[1/5]** What is your **Roblox username**?',
                '**[2/5]** What type of **punishment** did you receive? (e.g. Ban, Mute, Kick)',
                '**[3/5]** What was the stated **reason** for your punishment?',
                '**[4/5]** Why do you believe this punishment should be **removed or reduced**?',
                '**[5/5]** Any **additional information**? (type `none` if not applicable)'
            ]);

            if (!answers) {
                await channel.send('⏱️ Timed out. This channel will be deleted in 10 seconds.');
                delete tickets.activeAppeals[key];
                saveTickets();
                setTimeout(() => channel.delete().catch(() => {}), 10_000);
                return;
            }

            const logCh = interaction.guild.channels.cache.get(cfg.logChannelId);
            if (!logCh) return;

            const logEmbed = new EmbedBuilder().setColor(0x3498db).setTitle(`📩 Appeal — ${ticketId}`)
                .addFields(
                    { name: '🆔 Appeal ID',         value: ticketId,                                                  inline: true  },
                    { name: '💬 Discord User',       value: `${interaction.user.tag} (<@${interaction.user.id}>)`,    inline: true  },
                    { name: '🎮 Roblox Username',    value: answers[0],                                               inline: true  },
                    { name: '⚖️ Punishment Type',    value: answers[1],                                               inline: true  },
                    { name: '📋 Punishment Reason',  value: answers[2],                                               inline: false },
                    { name: '📝 Appeal Statement',   value: answers[3].slice(0, 1024),                                inline: false },
                    { name: '📎 Additional Info',    value: answers[4],                                               inline: false },
                    { name: '📅 Date Submitted',     value: `<t:${Math.floor(Date.now() / 1000)}:F>`,                 inline: true  },
                    { name: '🔄 Status',             value: '🟡 Pending',                                             inline: true  }
                );

            const logRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket_accept_${channel.id}`).setLabel('✅ Accept Appeal').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ticket_deny_${channel.id}`).setLabel('❌ Deny Appeal').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`ticket_close_${channel.id}`).setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Secondary)
            );

            const logMsg = await logCh.send({ embeds: [logEmbed], components: [logRow] });

            tickets.channels[channel.id] = {
                type: 'appeal', guildId: gid, userId: interaction.user.id,
                ticketId, logMessageId: logMsg.id, logChannelId: cfg.logChannelId,
                status: 'pending', answers
            };
            saveTickets();

            await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Appeal Submitted')
                .setDescription('Your appeal has been submitted to the moderation team. Please stand by.')
                .addFields({ name: '🆔 Ticket ID', value: ticketId, inline: true })] });
        }

        // ── Accept ─────────────────────────────────────────────────────────────
        if (interaction.customId.startsWith('ticket_accept_')) {
            const channelId = interaction.customId.slice('ticket_accept_'.length);
            const ticket = tickets.channels[channelId];
            if (!ticket) return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            const cfg = ticket.type === 'report' ? reportConfig[gid] : appealConfig[gid];
            const modIds1 = cfg?.modRoleIds ?? (cfg?.modRoleId ? [cfg.modRoleId] : []);
            if (!cfg || !modIds1.some(id => interaction.member.roles.cache.has(id)))
                return interaction.reply({ content: '❌ You need a moderator role to action tickets.', ephemeral: true });

            const newStatus = ticket.type === 'report' ? '🟡 Under Investigation' : '🟢 Accepted';
            ticket.status   = ticket.type === 'report' ? 'under_investigation' : 'accepted';
            saveTickets();

            // Update log embed
            const logCh = interaction.guild.channels.cache.get(ticket.logChannelId);
            if (logCh) {
                const logMsg = await logCh.messages.fetch(ticket.logMessageId).catch(() => null);
                if (logMsg) {
                    const idx = logMsg.embeds[0].fields.findIndex(f => f.name === '🔄 Status');
                    const updated = EmbedBuilder.from(logMsg.embeds[0]).spliceFields(idx, 1, { name: '🔄 Status', value: newStatus, inline: true })
                        .addFields({ name: '✅ Actioned By', value: interaction.user.tag, inline: true });
                    await logMsg.edit({ embeds: [updated] });
                }
            }

            // Notify in ticket channel
            const ticketCh = interaction.guild.channels.cache.get(channelId);
            if (ticketCh) await ticketCh.send({ embeds: [new EmbedBuilder()
                .setColor(ticket.type === 'report' ? 0xfee75c : 0x57f287)
                .setTitle(ticket.type === 'report' ? '🟡 Report Accepted — Under Investigation' : '🟢 Appeal Accepted')
                .setDescription(ticket.type === 'report'
                    ? `Your report (**${ticket.ticketId}**) has been accepted and is now under investigation.`
                    : `Your appeal (**${ticket.ticketId}**) has been **accepted**. Your punishment will be reviewed.`)
                .addFields({ name: '🛡️ Reviewed by', value: interaction.user.tag, inline: true })] });

            await interaction.reply({ content: `✅ ${ticket.type === 'report' ? 'Report accepted — Under Investigation.' : 'Appeal accepted.'}`, ephemeral: true });
        }

        // ── Reject / Deny ──────────────────────────────────────────────────────
        if (interaction.customId.startsWith('ticket_reject_') || interaction.customId.startsWith('ticket_deny_')) {
            const isReject  = interaction.customId.startsWith('ticket_reject_');
            const channelId = interaction.customId.slice(isReject ? 'ticket_reject_'.length : 'ticket_deny_'.length);
            const ticket    = tickets.channels[channelId];
            if (!ticket) return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            const cfg = ticket.type === 'report' ? reportConfig[gid] : appealConfig[gid];
            const modIds2 = cfg?.modRoleIds ?? (cfg?.modRoleId ? [cfg.modRoleId] : []);
            if (!cfg || !modIds2.some(id => interaction.member.roles.cache.has(id)))
                return interaction.reply({ content: '❌ You need a moderator role to action tickets.', ephemeral: true });

            ticket.status = 'rejected';
            saveTickets();

            const logCh = interaction.guild.channels.cache.get(ticket.logChannelId);
            if (logCh) {
                const logMsg = await logCh.messages.fetch(ticket.logMessageId).catch(() => null);
                if (logMsg) {
                    const idx = logMsg.embeds[0].fields.findIndex(f => f.name === '🔄 Status');
                    const updated = EmbedBuilder.from(logMsg.embeds[0]).spliceFields(idx, 1, { name: '🔄 Status', value: '🔴 Rejected', inline: true })
                        .addFields({ name: '❌ Rejected By', value: interaction.user.tag, inline: true });
                    await logMsg.edit({ embeds: [updated] });
                }
            }

            const ticketCh = interaction.guild.channels.cache.get(channelId);
            if (ticketCh) await ticketCh.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('🔴 Rejected')
                .setDescription(ticket.type === 'report'
                    ? `Your report (**${ticket.ticketId}**) has been **rejected** — it did not meet the requirements for action.`
                    : `Your appeal (**${ticket.ticketId}**) has been **denied** — the moderation team has decided to uphold the punishment.`)
                .addFields({ name: '🛡️ Reviewed by', value: interaction.user.tag, inline: true })] });

            await interaction.reply({ content: `✅ ${ticket.type} ${isReject ? 'rejected' : 'denied'}.`, ephemeral: true });
        }

        // ── Close Ticket ───────────────────────────────────────────────────────
        if (interaction.customId.startsWith('ticket_close_')) {
            const channelId = interaction.customId.slice('ticket_close_'.length);
            const ticket    = tickets.channels[channelId];
            if (!ticket) return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            const cfg = ticket.type === 'report' ? reportConfig[gid] : appealConfig[gid];
            const modIds3 = cfg?.modRoleIds ?? (cfg?.modRoleId ? [cfg.modRoleId] : []);
            if (!cfg || !modIds3.some(id => interaction.member.roles.cache.has(id)))
                return interaction.reply({ content: '❌ You need a moderator role to close tickets.', ephemeral: true });

            const ticketCh = interaction.guild.channels.cache.get(channelId);
            if (!ticketCh) return interaction.reply({ content: '❌ Channel not found.', ephemeral: true });

            // Build transcript
            const messages = await ticketCh.messages.fetch({ limit: 100 }).catch(() => null);
            let transcript = `=== TICKET TRANSCRIPT ===\nTicket ID: ${ticket.ticketId}\nType: ${ticket.type.toUpperCase()}\nClosed by: ${interaction.user.tag}\nDate: ${new Date().toUTCString()}\n========================\n\n`;
            if (messages) {
                for (const msg of [...messages.values()].reverse()) {
                    transcript += `[${new Date(msg.createdTimestamp).toUTCString()}] ${msg.author.tag}: ${msg.content}\n`;
                }
            }

            // Post transcript + close notice to log channel
            const logCh = interaction.guild.channels.cache.get(ticket.logChannelId);
            if (logCh) {
                await logCh.send({
                    embeds: [new EmbedBuilder().setColor(0x7289da).setTitle(`🔒 Ticket Closed — ${ticket.ticketId}`)
                        .addFields(
                            { name: '🆔 Ticket ID',  value: ticket.ticketId,          inline: true },
                            { name: '👤 User',        value: `<@${ticket.userId}>`,    inline: true },
                            { name: '🛡️ Closed By',  value: interaction.user.tag,     inline: true },
                            { name: '📅 Closed At',  value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                        )],
                    files: [new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `transcript-${ticket.ticketId}.txt` })]
                });

                // Disable the action buttons on the log entry
                const logMsg = await logCh.messages.fetch(ticket.logMessageId).catch(() => null);
                if (logMsg?.components[0]) {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        logMsg.components[0].components.map(b => ButtonBuilder.from(b).setDisabled(true))
                    );
                    await logMsg.edit({ components: [disabledRow] }).catch(() => {});
                }
            }

            // Clean up ticket records
            const key = `${gid}_${ticket.userId}`;
            if (ticket.type === 'report') delete tickets.activeReports[key];
            else                          delete tickets.activeAppeals[key];
            delete tickets.channels[channelId];
            saveTickets();

            await interaction.reply({ content: '🔒 Ticket closed. Deleting channel in 5 seconds...', ephemeral: true });
            setTimeout(() => ticketCh.delete().catch(() => {}), 5_000);
        }

    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: '❌ An error occurred. Please try again.', ephemeral: true }).catch(() => {});
        }
    }
});

// ── Auto-assign join role on member join ──────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
    const config = verifyConfig[member.guild.id];
    if (!config?.joinRoleId) return;
    try {
        await member.roles.add(config.joinRoleId);
    } catch (err) {
        console.error(`Failed to assign join role to ${member.user.tag}:`, err.message);
    }
});

// ── Verify helper ─────────────────────────────────────────────────────────────

async function assignVerifiedRoles(member, config) {
    if (config.verifiedRoleId) {
        await member.roles.add(config.verifiedRoleId).catch(e => console.error('Add verified role:', e.message));
    }
    if (config.joinRoleId && member.roles.cache.has(config.joinRoleId)) {
        await member.roles.remove(config.joinRoleId).catch(e => console.error('Remove join role:', e.message));
    }
}

// ── Message listener ──────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // ── Activity tracking (fires on every message) ────────────────────────────
    activitySys.trackMessage(message.guild.id, message.author.id);

    const prefix = prefixes[message.guild.id] || DEFAULT_PREFIX;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ── Staff management system routing ───────────────────────────────────────
    const MOD_CMDS    = ['warn','strike','removestrike','suspend','demote','terminate','ban','unban','note'];
    const SETUP_CMDS  = ['setupmod','setuplogs','setupranks','setupdepartments','setuproles'];
    const PROMO_CMDS  = ['promotionsetup','demotionsetup','promote','checkpromotion'];
    const TRAIN_CMDS  = ['trainingcreate','traininghost','trainingcomplete','traininglist'];
    const DEPT_CMDS   = ['departments','department','deptadd','deptremove','deptperformance'];
    const ACT_CMDS    = ['activity','leaderboard','resetactivity','addscore'];
    const STATS_CMDS  = ['dashboard','stats'];

    if (MOD_CMDS.includes(command))   return modSystem.handleCommand(message, command, args).catch(console.error);
    if (SETUP_CMDS.includes(command)) return cfgSystem.handleCommand(message, command, args).catch(console.error);
    if (command === 'staffprofile')   return profileSys.handleCommand(message, args).catch(console.error);
    if (command === 'loasetup' || command === 'loaend')
                                      return loaSys.handleCommand(message, command, args).catch(console.error);
    if (PROMO_CMDS.includes(command)) return promoSys.handleCommand(message, command, args).catch(console.error);
    if (TRAIN_CMDS.includes(command)) return trainSys.handleCommand(message, command, args).catch(console.error);
    if (command === 'feedbacksetup')  return feedbackSys.handleCommand(message, args).catch(console.error);
    if (ACT_CMDS.includes(command))   return activitySys.handleCommand(message, command, args).catch(console.error);
    if (DEPT_CMDS.includes(command))  return deptSys.handleCommand(message, command, args).catch(console.error);
    if (STATS_CMDS.includes(command)) return analyticsSys.handleCommand(message, command, args).catch(console.error);

    // ── !ping ─────────────────────────────────────────────────────────────────
    if (command === 'ping') {
        return message.reply('Pong! 🏓');
    }

    // ── !setprefix ────────────────────────────────────────────────────────────
    if (command === 'setprefix') {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need the "Manage Server" permission to change my prefix.');
        }
        const newPrefix = args[0];
        if (!newPrefix) return message.reply(`❌ Please specify a new prefix. Example: \`${prefix}setprefix ?\``);
        if (newPrefix.length > 5) return message.reply('❌ The prefix must be 5 characters or less.');
        prefixes[message.guild.id] = newPrefix;
        fs.writeFileSync('./prefixes.json', JSON.stringify(prefixes, null, 4));
        return message.reply(`✅ Prefix changed to \`${newPrefix}\``);
    }

    // ── !reportsetup ──────────────────────────────────────────────────────────
    if (command === 'reportsetup') {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need the **Manage Server** permission to run report setup.');
        }

        reportSetupState.set(message.guild.id, { authorId: message.author.id });
        setTimeout(() => {
            const s = reportSetupState.get(message.guild.id);
            if (s && s.authorId === message.author.id) reportSetupState.delete(message.guild.id);
        }, 300_000);

        return message.reply({
            embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 Report Setup — Step 1 of 3')
                .setDescription(
                    'Welcome to the **Report System Setup Wizard!**\n\n' +
                    'Select the **category** where report ticket channels will be created.'
                )
                .addFields(
                    { name: '📋 What we\'ll configure', value: '**Step 1 —** Reports category\n**Step 2 —** Reports log channel\n**Step 3 —** Moderator role', inline: false }
                )
                .setFooter({ text: 'Only you can interact with this setup  •  Expires in 5 minutes' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(`rs_cat_${message.guild.id}`)
                    .setPlaceholder('Select the reports category...')
                    .setChannelTypes(ChannelType.GuildCategory)
            )]
        });
    }

    // ── !appealsetup ──────────────────────────────────────────────────────────
    if (command === 'appealsetup') {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need the **Manage Server** permission to run appeal setup.');
        }

        appealSetupState.set(message.guild.id, { authorId: message.author.id });
        setTimeout(() => {
            const s = appealSetupState.get(message.guild.id);
            if (s && s.authorId === message.author.id) appealSetupState.delete(message.guild.id);
        }, 300_000);

        return message.reply({
            embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('📩 Appeal Setup — Step 1 of 3')
                .setDescription(
                    'Welcome to the **Appeal System Setup Wizard!**\n\n' +
                    'Select the **category** where appeal ticket channels will be created.'
                )
                .addFields(
                    { name: '📋 What we\'ll configure', value: '**Step 1 —** Appeals category\n**Step 2 —** Appeals log channel\n**Step 3 —** Moderator role', inline: false }
                )
                .setFooter({ text: 'Only you can interact with this setup  •  Expires in 5 minutes' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(`as_cat_${message.guild.id}`)
                    .setPlaceholder('Select the appeals category...')
                    .setChannelTypes(ChannelType.GuildCategory)
            )]
        });
    }

    // ── !verifysetup ──────────────────────────────────────────────────────────
    if (command === 'verifysetup') {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need the **Manage Server** permission to run verification setup.');
        }

        // Cancel any existing setup session for this server
        verifySetupState.set(message.guild.id, { authorId: message.author.id });

        // Auto-expire after 5 minutes
        setTimeout(() => {
            const s = verifySetupState.get(message.guild.id);
            if (s && s.authorId === message.author.id) verifySetupState.delete(message.guild.id);
        }, 300_000);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔐 RoUtil Verification Setup')
            .setDescription(
                'Welcome to the **RoUtil Verification Setup Wizard!**\n' +
                'This will configure how members link their Roblox account to this server.\n\u200b'
            )
            .addFields(
                {
                    name: '📋 What we\'ll set up',
                    value:
                        '**Step 1 —** Choose how members verify their Roblox account\n' +
                        '**Step 2 —** Write the verification message (title, description, thumbnail)\n' +
                        '**Step 3 —** Choose whether the message is a rich embed or plain text\n' +
                        '**Step 4 —** Select the role given to every new member on join\n' +
                        '**Step 5 —** Select the role given when a member verifies',
                    inline: false
                },
                {
                    name: '🔖 Bio Verification',
                    value: 'RoUtil gives each member a unique code. They paste it into their **Roblox profile bio** to prove account ownership.',
                    inline: false
                },
                {
                    name: '🎫 Gamepass Verification',
                    value: 'Members must own a specific gamepass (named **"RoUtil"**) in your Roblox game. You supply the **Gamepass ID**.',
                    inline: false
                }
            )
            .setFooter({ text: 'Only you can interact with this setup  •  Expires in 5 minutes' });

        const menu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`vs_q1_${message.guild.id}`)
                .setPlaceholder('📋 Step 1 — How should members verify?')
                .addOptions(
                    { label: 'Bio Verification',      description: 'Member pastes a unique code into their Roblox bio',          value: 'bio',      emoji: '🔖' },
                    { label: 'Gamepass Verification', description: 'Member owns a "RoUtil" gamepass in your Roblox game',         value: 'gamepass', emoji: '🎫' }
                )
        );

        return message.reply({ embeds: [embed], components: [menu] });
    }

    // ── !verify ───────────────────────────────────────────────────────────────
    if (command === 'verify') {
        const config = verifyConfig[message.guild.id];
        if (!config) {
            return message.reply('❌ Verification has not been set up for this server yet. An admin can run `!verifysetup` to configure it.');
        }

        if (config.verifiedRoleId && message.member.roles.cache.has(config.verifiedRoleId)) {
            return message.reply('✅ You are already verified!');
        }

        const promptMsg = await message.reply('🔍 What is your **Roblox username**? Reply within 60 seconds.');

        const usernameCollector = message.channel.createMessageCollector({
            filter: m => m.author.id === message.author.id,
            max: 1,
            time: 60_000
        });

        usernameCollector.on('collect', async (usernameMsg) => {
            const username = usernameMsg.content.trim();

            let robloxUser;
            try {
                const res = await fetch('https://users.roblox.com/v1/usernames/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
                });
                const data = await res.json();
                robloxUser = data.data?.[0];
            } catch {
                return message.reply('❌ Failed to contact Roblox. Please try again later.');
            }

            if (!robloxUser) {
                return message.reply(`❌ No Roblox user found with the username **${username}**. Check the spelling and try again.`);
            }

            // ── Gamepass method ──────────────────────────────────────────────
            if (config.method === 'gamepass') {
                const checking = await message.reply(`🎫 Checking if **${robloxUser.name}** owns the gamepass...`);
                try {
                    const gpRes  = await fetch(`https://inventory.roblox.com/v1/users/${robloxUser.id}/items/GamePass/${config.gamepasId}`);
                    const gpData = await gpRes.json();

                    if (gpData.data?.length > 0) {
                        await assignVerifiedRoles(message.member, config);
                        verifyConfig.links = verifyConfig.links || {};
                        verifyConfig.links[message.author.id] = { robloxName: robloxUser.name, robloxId: robloxUser.id };
                        saveVerifyConfig();
                        await checking.edit(`✅ Verified! **${robloxUser.name}** owns the gamepass — you've been given the verified role.`);
                    } else {
                        await checking.edit(`❌ **${robloxUser.name}** does not own the required gamepass (ID: \`${config.gamepasId}\`).`);
                    }
                } catch {
                    await checking.edit('❌ Failed to check gamepass ownership. Please try again later.');
                }
                return;
            }

            // ── Bio method ───────────────────────────────────────────────────
            const code = `routil-${message.author.id.slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;

            const bioEmbed = () => new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('🔖 Bio Verification')
                .setDescription(
                    `Add the code below **exactly** to your [Roblox profile bio](https://www.roblox.com/my/account#!/info), then click **Verify**.\n\n` +
                    `\`\`\`${code}\`\`\``
                )
                .addFields({ name: '👤 Roblox Account', value: `**${robloxUser.name}** (ID: \`${robloxUser.id}\`)`, inline: false })
                .setFooter({ text: 'Expires in 5 minutes  •  You can try as many times as you need' });

            const bioRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_check').setLabel('✅ Verify').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('verify_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );

            const bioMsg = await message.reply({ embeds: [bioEmbed()], components: [bioRow] });

            const btnCollector = bioMsg.createMessageComponentCollector({
                filter: i => i.user.id === message.author.id,
                time: 300_000
            });

            btnCollector.on('collect', async (interaction) => {
                if (interaction.customId === 'verify_cancel') {
                    await interaction.update({
                        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Verification Cancelled').setDescription('Run `!verify` again whenever you\'re ready.')],
                        components: []
                    });
                    btnCollector.stop('cancelled');
                    return;
                }

                await interaction.deferUpdate();

                let profile;
                try {
                    const profileRes = await fetch(`https://users.roblox.com/v1/users/${robloxUser.id}`);
                    profile = await profileRes.json();
                } catch {
                    await bioMsg.edit({ content: '❌ Failed to reach Roblox. Please try again.', embeds: [bioEmbed()], components: [bioRow] });
                    return;
                }

                if (profile.description?.includes(code)) {
                    await assignVerifiedRoles(message.member, config);
                    verifyConfig.links = verifyConfig.links || {};
                    verifyConfig.links[message.author.id] = { robloxName: robloxUser.name, robloxId: robloxUser.id };
                    saveVerifyConfig();
                    await bioMsg.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0x57f287)
                                .setTitle('✅ Verification Successful!')
                                .setDescription(`Your Discord account is now linked to **${robloxUser.name}**! You've been given the verified role.`)
                                .addFields({ name: '🎮 Roblox Account', value: `**${robloxUser.name}** (ID: \`${robloxUser.id}\`)`, inline: false })
                        ],
                        components: []
                    });
                    btnCollector.stop('verified');
                } else {
                    await bioMsg.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0xfee75c)
                                .setTitle('🔖 Bio Verification — Code Not Found')
                                .setDescription(
                                    `The code wasn't found in **${robloxUser.name}**'s bio yet. Make sure it's copied exactly:\n\n` +
                                    `\`\`\`${code}\`\`\`\n` +
                                    `[Open your Roblox profile settings](https://www.roblox.com/my/account#!/info)`
                                )
                                .addFields({ name: '👤 Roblox Account', value: `**${robloxUser.name}** (ID: \`${robloxUser.id}\`)`, inline: false })
                                .setFooter({ text: 'Expires in 5 minutes  •  You can try as many times as you need' })
                        ],
                        components: [bioRow]
                    });
                }
            });

            btnCollector.on('end', (_, reason) => {
                if (reason !== 'verified' && reason !== 'cancelled') {
                    bioMsg.edit({ components: [] }).catch(() => {});
                }
            });
        });

        usernameCollector.on('end', (collected) => {
            if (collected.size === 0) {
                promptMsg.edit('⏱️ Verification timed out. Run `!verify` again when you\'re ready.').catch(() => {});
            }
        });

        return;
    }

    // ── !whois ────────────────────────────────────────────────────────────────
    if (command === 'whois') {
        const user = message.mentions.users.first();
        if (!user) return message.reply('❌ Mention a user. Example: `!whois @someone`');

        const data = verifyConfig.links?.[user.id];
        if (!data) return message.reply(`❌ **${user.tag}** has not verified their Roblox account in this server.`);

        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('🔍 Roblox Link')
                    .addFields(
                        { name: '💬 Discord',      value: user.tag,                     inline: true },
                        { name: '🎮 Roblox Name',  value: data.robloxName,              inline: true },
                        { name: '🆔 Roblox ID',    value: `\`${data.robloxId}\``,       inline: true }
                    )
                    .setThumbnail(user.displayAvatarURL())
            ]
        });
    }

    // ── !verified ─────────────────────────────────────────────────────────────
    if (command === 'verified') {
        const count = verifyConfig.links ? Object.keys(verifyConfig.links).length : 0;
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57f287)
                    .setTitle('✅ Verified Members')
                    .setDescription(`**${count}** member${count !== 1 ? 's have' : ' has'} verified their Roblox account in this server.`)
            ]
        });
    }

    // ── !serverstats ──────────────────────────────────────────────────────────
    if (command === 'serverstats') {
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x00ae86)
                    .setTitle('📊 Server Statistics')
                    .setThumbnail(message.guild.iconURL())
                    .addFields(
                        { name: '👥 Members',  value: `${message.guild.memberCount}`,              inline: true },
                        { name: '💬 Channels', value: `${message.guild.channels.cache.size}`,      inline: true },
                        { name: '🏷️ Roles',   value: `${message.guild.roles.cache.size}`,         inline: true }
                    )
                    .setFooter({ text: message.guild.name })
            ]
        });
    }

    // ── !userinfo ─────────────────────────────────────────────────────────────
    if (command === 'userinfo') {
        const member = message.mentions.members.first() || message.member;
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('👤 User Information')
                    .setThumbnail(member.user.displayAvatarURL())
                    .addFields(
                        { name: 'Username',      value: member.user.tag,                                                 inline: true  },
                        { name: 'User ID',       value: `\`${member.id}\``,                                              inline: true  },
                        { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,            inline: false },
                        { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,   inline: false }
                    )
            ]
        });
    }

    // ── !avatar ───────────────────────────────────────────────────────────────
    if (command === 'avatar') {
        const user = message.mentions.users.first() || message.author;
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle(`🖼️ ${user.username}'s Avatar`)
                    .setImage(user.displayAvatarURL({ size: 1024 }))
            ]
        });
    }

    // ── !cmds ─────────────────────────────────────────────────────────────────
    if (command === 'cmds') {
        const PAGE_SIZE  = 10;
        const totalPages = Math.ceil(COMMANDS.length / PAGE_SIZE);
        let page = Math.max(1, Math.min(parseInt(args[0]) || 1, totalPages));

        const buildCmdsEmbed = (p) => {
            const slice = COMMANDS.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
            return new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('📖 RoUtil — Commands')
                .setDescription(slice.map(c => `**${c.name}**\n${c.desc}`).join('\n\n'))
                .setFooter({ text: `Page ${p} of ${totalPages}  •  ${COMMANDS.length} commands total` });
        };

        const buildCmdsButtons = (p) => new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cmds_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(p === 1),
            new ButtonBuilder().setCustomId('cmds_page').setLabel(`${p} / ${totalPages}`).setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId('cmds_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(p === totalPages)
        );

        const cmdsMsg = await message.reply({
            embeds: [buildCmdsEmbed(page)],
            components: totalPages > 1 ? [buildCmdsButtons(page)] : []
        });

        if (totalPages <= 1) return;

        const collector = cmdsMsg.createMessageComponentCollector({
            filter: i => i.user.id === message.author.id,
            time: 120_000
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'cmds_prev' && page > 1) page--;
            if (interaction.customId === 'cmds_next' && page < totalPages) page++;
            await interaction.update({ embeds: [buildCmdsEmbed(page)], components: [buildCmdsButtons(page)] });
        });

        collector.on('end', () => {
            const disabled = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('cmds_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('cmds_page').setLabel(`${page} / ${totalPages}`).setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('cmds_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            cmdsMsg.edit({ components: [disabled] }).catch(() => {});
        });

        return;
    }

    // ── !find ─────────────────────────────────────────────────────────────────
    if (command === 'find') {
        const TYPE_ALIASES = {
            user: 'user', users: 'user', player: 'user',
            item: 'catalog', items: 'catalog', catalog: 'catalog',
            marketplace: 'catalog', limited: 'catalog'
        };

        if (!args.length) {
            return message.reply(
                `❌ Please provide a search query.\n` +
                `> **Usage:** \`${prefix}find [user|item] <name> [by <creator>]\`\n` +
                `> **Examples:**\n` +
                `> \`${prefix}find user Builderman\`\n` +
                `> \`${prefix}find item Bloxy Cola\`\n` +
                `> \`${prefix}find item Bloxy Cola by Roblox\`\n` +
                `> \`${prefix}find Builderman\` *(searches users + marketplace)*`
            );
        }

        const firstArg = args[0].toLowerCase();
        let searchType = TYPE_ALIASES[firstArg] || 'all';
        let remaining  = searchType !== 'all' ? args.slice(1) : args;

        let creatorFilter = null;
        if (searchType === 'catalog' || searchType === 'all') {
            const byIndex = remaining.findIndex(a => a.toLowerCase() === 'by');
            if (byIndex !== -1 && byIndex < remaining.length - 1) {
                creatorFilter = remaining.slice(byIndex + 1).join(' ');
                remaining     = remaining.slice(0, byIndex);
            }
        }

        const query = remaining.join(' ');
        if (!query) return message.reply(`❌ Please provide a name to search. Example: \`${prefix}find ${firstArg} Bloxy Cola\``);

        const creatorLabel = creatorFilter ? ` by **${creatorFilter}**` : '';
        const typeLabel    = searchType === 'all' ? 'users & marketplace' : searchType === 'catalog' ? 'marketplace items' : 'users';
        const loading      = await message.reply(`🔍 Searching Roblox ${typeLabel} for **"${query}"**${creatorLabel}…`);

        try {
            let users = [], rawCatalog = [];

            if (searchType === 'all' || searchType === 'user')    users      = await searchUsers(query).catch(() => []);
            if (searchType === 'all' || searchType === 'catalog') rawCatalog = await searchCatalog(query, creatorFilter).catch(() => []);

            let catalogItems = [];
            if (rawCatalog.length > 0) {
                const payload = rawCatalog.map(i => ({ itemType: i.itemType === 'Bundle' ? 'Bundle' : 'Asset', id: i.id }));
                catalogItems = await getCatalogDetails(payload).catch(() => []);
            }

            const results = [
                ...users.map(d => ({ type: 'user',    data: d })),
                ...catalogItems.map(d => ({ type: 'catalog', data: d }))
            ];

            if (results.length === 0) {
                return loading.edit({ content: `❌ No results found for **"${query}"**.\n> Check your spelling and try again.`, embeds: [], components: [] });
            }

            let page = 0;
            await loading.edit({ content: null, embeds: [await buildEmbed(results[0], 0, results.length, query)], components: [buildFindButtons(0, results.length)] });

            const collector = loading.createMessageComponentCollector({
                filter: i => i.user.id === message.author.id,
                time: 120_000
            });

            collector.on('collect', async (interaction) => {
                if (interaction.customId === 'find_prev' && page > 0) page--;
                if (interaction.customId === 'find_next' && page < results.length - 1) page++;
                await interaction.update({ embeds: [await buildEmbed(results[page], page, results.length, query)], components: [buildFindButtons(page, results.length)] });
            });

            collector.on('end', () => {
                const disabled = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('find_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('find_info').setLabel(`${page + 1} / ${results.length}`).setStyle(ButtonStyle.Primary).setDisabled(true),
                    new ButtonBuilder().setCustomId('find_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
                loading.edit({ components: [disabled] }).catch(() => {});
            });

        } catch (err) {
            console.error('Find command error:', err);
            loading.edit({ content: '❌ Something went wrong while searching Roblox. Please try again.', embeds: [], components: [] }).catch(() => {});
        }
    }
});

// Handle unhandled promise rejections to prevent crashes
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Log in
client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('Failed to log in:', error.message);
    console.error('Make sure DISCORD_TOKEN is set correctly.');
});
