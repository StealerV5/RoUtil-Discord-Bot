// index.js - entry point for RoUtil Discord Bot (refactored)
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const prefixManager = require('./utils/prefixManager');
const jtcManager = require('./utils/jtcManager');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    const cmd = require(path.join(commandsPath, file));
    if (!cmd || !cmd.name) continue;
    client.commands.set(cmd.name, cmd);
    if (cmd.aliases && Array.isArray(cmd.aliases)) {
      for (const a of cmd.aliases) client.commands.set(a, cmd);
    }
  }
}

// Load event handlers
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
  for (const file of eventFiles) {
    const ev = require(path.join(eventsPath, file));
    if (typeof ev === 'function') ev(client);
  }
}

client.prefixManager = prefixManager;
client.jtcManager = jtcManager;

client.once('ready', () => {
  console.log(`RoUtil ready as ${client.user.tag}`);
});

// Login
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN not set in environment. Exiting.');
  process.exit(1);
}
client.login(token);
