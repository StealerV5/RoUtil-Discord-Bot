/**
 * CommandParser.js
 * Handles command parsing with dynamic prefix support
 */
const ConfigManager = require('./ConfigManager');

class CommandParser {
    /**
     * Parse a message to extract command and arguments
     * @param {Message} message - Discord message object
     * @returns {Object|null} Parsed command object or null if not a command
     */
    static parseCommand(message) {
        if (message.author.bot) return null;
        if (!message.content) return null;

        const guildId = message.guildId;
        if (!guildId) return null;

        // Get the dynamic prefix for this guild
        const prefix = ConfigManager.getPrefix(guildId);
        
        if (!message.content.startsWith(prefix)) {
            return null;
        }

        // Remove prefix and trim
        const content = message.content.slice(prefix.length).trim();
        
        if (!content) return null;

        // Split content into command and arguments
        const parts = content.split(/\s+/);
        const commandName = parts[0].toLowerCase();
        const args = parts.slice(1);

        return {
            prefix,
            commandName,
            args,
            fullContent: content,
            rawArgs: message.content.slice(prefix.length + commandName.length).trim()
        };
    }

    /**
     * Check if a message is a command
     * @param {Message} message - Discord message object
     * @returns {boolean} True if message is a command
     */
    static isCommand(message) {
        if (message.author.bot) return false;
        if (!message.content) return false;

        const guildId = message.guildId;
        if (!guildId) return false;

        const prefix = ConfigManager.getPrefix(guildId);
        return message.content.startsWith(prefix);
    }

    /**
     * Get prefix for a guild
     * @param {string} guildId - Guild ID
     * @returns {string} Prefix
     */
    static getPrefix(guildId) {
        return ConfigManager.getPrefix(guildId);
    }
}

module.exports = CommandParser;
