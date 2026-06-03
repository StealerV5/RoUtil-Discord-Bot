const {
    Client, GatewayIntentBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, RoleSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const express = require('express');
const fs = require('fs');

// 1. Web server for 24/7 uptime
const app = express();
app.get('/', (req, res) => { res.send('RoUtil is operational!'); });
app.listen(process.env.PORT || 3000, () => { console.log('Web server loaded.'); });

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

// Tracks in-progress setup sessions: guildId → state object
const verifySetupState = new Map();

// ── Commands list (update this array every time a new command is added) ───────
const COMMANDS = [
    { name: '!ping',                           desc: 'Check if the bot is online.' },
    { name: '!setprefix <new>',                desc: 'Change the command prefix for this server. Requires **Manage Server**.' },
    { name: '!find [user|item] <query>',       desc: 'Search Roblox for users or marketplace items.' },
    { name: '!find item <query> by <creator>', desc: 'Search marketplace items filtered by a specific creator.' },
    { name: '!verifysetup',                    desc: 'Run the 3-step Roblox verification setup wizard. Requires **Manage Server**.' },
    { name: '!cmds [page]',                    desc: 'Show this commands list. 10 commands per page.' },
];

// ── Ready ─────────────────────────────────────────────────────────────────────

client.once('clientReady', () => {
    console.log(`Success! Logged in as ${client.user.tag}`);
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
    if (!interaction.guild) return;
    const gid = interaction.guild.id;

    // Only handle interactions that belong to a live setup session
    const isSetupInteraction =
        (interaction.isStringSelectMenu() && (interaction.customId === `vs_q1_${gid}` || interaction.customId === `vs_q3_${gid}`)) ||
        (interaction.isRoleSelectMenu()   && (interaction.customId === `vs_q4a_${gid}` || interaction.customId === `vs_q4b_${gid}`)) ||
        (interaction.isButton()           &&  interaction.customId === `vs_next_${gid}`) ||
        (interaction.isModalSubmit()      && (interaction.customId === `vs_gpmodal_${gid}` || interaction.customId === `vs_q2modal_${gid}`));

    if (!isSetupInteraction) return;

    const state = verifySetupState.get(gid);
    if (!state) return;

    if (interaction.user.id !== state.authorId) {
        return interaction.reply({ content: '❌ Only the person who started setup can interact with this.', ephemeral: true });
    }

    try {
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

    } catch (err) {
        console.error('Verify setup interaction error:', err);
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

// ── Message listener ──────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = prefixes[message.guild.id] || DEFAULT_PREFIX;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

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
