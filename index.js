const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. Create a mini web server so hosting sites know your bot is active
const app = express();
app.get('/', (req, res) => {
    res.send('Your Discord Bot is fully operational!');
});
app.listen(process.env.PORT || 3000, () => {
    console.log('Web server loaded successfully.');
});

// 2. Setup your Discord Bot connection
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Let you know it worked
client.once('clientReady', () => {
    console.log(`Success! Logged in as ${client.user.tag}`);
});

// 3. Simple message command
client.on('messageCreate', (message) => {
    if (message.author.bot) return; // Ignore other bots

    if (message.content.toLowerCase() === '!ping') {
        message.reply('Pong! 🏓 The bot is online & ready for commands!');
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
