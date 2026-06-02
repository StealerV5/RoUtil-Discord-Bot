const { Client, GatewayIntentBits } = require('discord.js');
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

// Default prefix if a server hasn't set a custom one
const DEFAULT_PREFIX = '!';

// Load prefixes from file, or create an empty object if the file doesn't exist yet
let prefixes = {};
if (fs.existsSync('./prefixes.json')) {
    prefixes = JSON.parse(fs.readFileSync('./prefixes.json', 'utf8'));
}

client.once('clientReady', () => {
    console.log(`Success! Logged in as ${client.user.tag}`);
});

// 3. Message Listener
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = prefixes[message.guild.id] || DEFAULT_PREFIX;

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Ping Command
    if (command === 'ping') {
        return message.reply('Pong! 🏓');
    }

    // SetPrefix Command
    if (command === 'setprefix') {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need the "Manage Server" permission to change my prefix.');
        }

        const newPrefix = args[0];

        if (!newPrefix) {
            return message.reply(`❌ Please specify a new prefix. Example: \`${prefix}setprefix ?\``);
        }
        if (newPrefix.length > 5) {
            return message.reply('❌ The prefix must be 5 characters or less.');
        }

        prefixes[message.guild.id] = newPrefix;
        fs.writeFileSync('./prefixes.json', JSON.stringify(prefixes, null, 4));

        return message.reply(`✅ Success! The prefix for RoUtil has been changed to \`${newPrefix}\``);
    }
});

// Handle unhandled promise rejections to prevent crashes
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Log in using your hidden Secret token
client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('Failed to log in:', error.message);
    console.error('Make sure DISCORD_TOKEN is set correctly.');
});
