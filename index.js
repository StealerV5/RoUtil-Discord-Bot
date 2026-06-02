const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
        GatewayIntentBits.MessageContent
    ]
});

const DEFAULT_PREFIX = '!';
let prefixes = {};
if (fs.existsSync('./prefixes.json')) {
    prefixes = JSON.parse(fs.readFileSync('./prefixes.json', 'utf8'));
}

client.once('clientReady', () => {
    console.log(`Success! Logged in as ${client.user.tag}`);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// Levenshtein distance — used for "did you mean?" corrections
function levenshtein(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
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

// Returns "Did you mean X?" string if the top result name differs from query
function didYouMean(query, topName) {
    const dist = levenshtein(query, topName);
    const threshold = Math.max(2, Math.floor(query.length / 3));
    if (dist > 0 && dist <= threshold) {
        return `💡 Did you mean **${topName}**?`;
    }
    return null;
}

async function robloxGet(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// Roblox POST endpoints need an XSRF token.
// We get it automatically from the 403 response header on the first attempt.
let xsrfToken = null;

async function robloxPost(url, body) {
    const attempt = (token) => fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-csrf-token': token } : {})
        },
        body: JSON.stringify(body)
    });

    let res = await attempt(xsrfToken);

    if (res.status === 403) {
        const newToken = res.headers.get('x-csrf-token');
        if (newToken) {
            xsrfToken = newToken;
            res = await attempt(xsrfToken);
        }
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ── Roblox API calls ──────────────────────────────────────────────────────────

async function searchUsers(query) {
    const data = await robloxGet(
        `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(query)}&limit=10`
    );
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
    const data = await robloxGet(
        `https://games.roblox.com/v2/users/${userId}/games?limit=5&sortOrder=Desc`
    );
    return data.data || [];
}

async function searchCatalog(query) {
    const data = await robloxGet(
        `https://catalog.roblox.com/v1/search/items?keyword=${encodeURIComponent(query)}&limit=10&category=All`
    );
    return data.data || [];
}

async function getCatalogDetails(items) {
    if (!items.length) return [];
    const data = await robloxPost('https://catalog.roblox.com/v1/catalog/items/details', { items });
    return data.data || [];
}

// Fetch economy details (price, RAP) for a single asset via GET — no XSRF needed
async function getAssetEconDetails(assetId) {
    const data = await robloxGet(`https://economy.roblox.com/v2/assets/${assetId}/details`);
    return data;
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

    // Follower / following counts
    try {
        const stats = await getUserStats(user.id);
        embed.addFields(
            { name: '👥 Followers', value: stats.followers.toLocaleString(), inline: true },
            { name: '➡️ Following', value: stats.following.toLocaleString(), inline: true }
        );
    } catch { /* skip if rate-limited */ }

    // Top games this user owns
    try {
        const games = await getUserGames(user.id);
        if (games.length > 0) {
            const gameList = games.slice(0, 5)
                .map(g => `• [${g.name}](https://www.roblox.com/games/${g.rootPlace?.id ?? g.id})`)
                .join('\n');
            embed.addFields({ name: '🎮 Their Games', value: gameList });
        }
    } catch { /* skip */ }

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
            { name: '💰 Price',         value: price,      inline: true },
            { name: '📈 RAP',           value: rap,        inline: true },
            { name: '📉 Lowest Price',  value: lowestPrice, inline: true },
            { name: '🏷️ Type',          value: item.itemType ?? 'Asset',    inline: true },
            { name: '👤 Creator',       value: item.creatorName ?? 'Unknown', inline: true }
        )
        .setFooter({ text: `Result ${index + 1} of ${total}  •  Catalog  •  Roblox` });

    const correction = didYouMean(query, item.name);
    if (correction) embed.setDescription(`${correction}\n\n${embed.data.description}`);

    if (item.id) {
        embed.setThumbnail(`https://www.roblox.com/asset-thumbnail/image?assetId=${item.id}&width=420&height=420&format=png`);
    }

    return embed;
}

async function buildEmbed(result, index, total, query) {
    if (result.type === 'user')    return buildUserEmbed(result.data, index, total, query);
    if (result.type === 'catalog') return buildCatalogEmbed(result.data, index, total, query);
}

function buildButtons(page, total) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('find_prev')
            .setLabel('◀ Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId('find_info')
            .setLabel(`${page + 1} / ${total}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('find_next')
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === total - 1)
    );
}

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
                `> **Usage:** \`${prefix}find [user|item] <name>\`\n` +
                `> **Examples:**\n` +
                `> \`${prefix}find user Builderman\`\n` +
                `> \`${prefix}find item Bloxy Cola\`\n` +
                `> \`${prefix}find Builderman\` *(searches users + marketplace)*`
            );
        }

        // Check if first arg is a type filter
        const firstArg = args[0].toLowerCase();
        let searchType = TYPE_ALIASES[firstArg] || 'all';
        const query = searchType !== 'all' ? args.slice(1).join(' ') : args.join(' ');

        if (searchType !== 'all' && !query) {
            return message.reply(`❌ Please provide a name to search. Example: \`${prefix}find ${firstArg} Builderman\``);
        }

        const typeLabel = searchType === 'all' ? 'users & marketplace' : searchType === 'catalog' ? 'marketplace items' : 'users';
        const loading = await message.reply(`🔍 Searching Roblox ${typeLabel} for **"${query}"**…`);

        try {
            let users = [], rawCatalog = [];

            if (searchType === 'all' || searchType === 'user') {
                users = await searchUsers(query).catch(() => []);
            }
            if (searchType === 'all' || searchType === 'catalog') {
                rawCatalog = await searchCatalog(query).catch(() => []);
            }

            // Fetch full catalog details with XSRF token (includes price + RAP)
            let catalogItems = [];
            if (rawCatalog.length > 0) {
                const payload = rawCatalog.map(i => ({
                    itemType: i.itemType === 'Bundle' ? 'Bundle' : 'Asset',
                    id: i.id
                }));
                catalogItems = await getCatalogDetails(payload).catch(() => []);
            }

            // Build combined results list: Users first, then catalog items
            const results = [
                ...users.map(d => ({ type: 'user', data: d })),
                ...catalogItems.map(d => ({ type: 'catalog', data: d }))
            ];

            if (results.length === 0) {
                return loading.edit({
                    content: `❌ No results found for **"${query}"**.\n> Check your spelling and try again.`,
                    embeds: [],
                    components: []
                });
            }

            let page = 0;
            const embed = await buildEmbed(results[page], page, results.length, query);
            await loading.edit({
                content: null,
                embeds: [embed],
                components: [buildButtons(page, results.length)]
            });

            // Button collector — only the original user can page through results
            const collector = loading.createMessageComponentCollector({
                filter: i => i.user.id === message.author.id,
                time: 120_000
            });

            collector.on('collect', async (interaction) => {
                if (interaction.customId === 'find_prev' && page > 0) page--;
                if (interaction.customId === 'find_next' && page < results.length - 1) page++;

                const newEmbed = await buildEmbed(results[page], page, results.length, query);
                await interaction.update({
                    embeds: [newEmbed],
                    components: [buildButtons(page, results.length)]
                });
            });

            // Disable buttons after 2 minutes of inactivity
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
            loading.edit({
                content: '❌ Something went wrong while searching Roblox. Please try again.',
                embeds: [],
                components: []
            }).catch(() => {});
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
