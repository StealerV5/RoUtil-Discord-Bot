/**
 * ErrorHandler.js
 * Centralized error handling and response system
 * Ensures no command exits silently - all errors are reported to the user
 */
const { EmbedBuilder } = require('discord.js');
const ConfigManager = require('./ConfigManager');

class ErrorHandler {
    /**
     * Handle a command error with user feedback
     * @param {Message} message - Discord message
     * @param {Error|string} error - Error object or message
     * @param {string} context - Context/command name
     * @param {Object} options - Additional options
     */
    static async handleCommandError(message, error, context = 'Command', options = {}) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode = options.code || this.generateErrorCode();

        console.error(`[${context}] Error ${errorCode}:`, errorMessage);

        try {
            // Create error embed
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Command Error')
                .setDescription(errorMessage || 'An unexpected error occurred.')
                .addFields(
                    { name: 'Context', value: context, inline: true },
                    { name: 'Error Code', value: errorCode, inline: true }
                )
                .setTimestamp();

            // Try to send as reply (visible to user only)
            if (message.reply) {
                await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            } else if (message.author) {
                // Fallback: send as regular message
                await message.channel.send({ embeds: [embed] });
            }
        } catch (replyErr) {
            console.error(`[ErrorHandler] Failed to send error reply:`, replyErr.message);
            // Last resort: acknowledge the message
            if (message.react) {
                try {
                    await message.react('❌');
                } catch (reactErr) {
                    console.error(`[ErrorHandler] Failed to react to message:`, reactErr.message);
                }
            }
        }

        // Log to dedicated error channel if configured
        await this.logToErrorChannel(message.guildId, context, errorMessage, errorCode, options);
    }

    /**
     * Handle missing arguments
     * @param {Message} message - Discord message
     * @param {string} commandName - Command name
     * @param {string} usage - Usage instructions
     */
    static async handleMissingArgs(message, commandName, usage) {
        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('⚠️ Missing Arguments')
            .setDescription(`Command **${commandName}** is missing required arguments.`)
            .addFields({
                name: 'Usage',
                value: `\`\`\`\n${usage}\n\`\`\``,
                inline: false
            })
            .setTimestamp();

        try {
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        } catch (err) {
            console.error(`[ErrorHandler] Failed to send missing args message:`, err.message);
        }
    }

    /**
     * Handle permission denied
     * @param {Message} message - Discord message
     * @param {string} permission - Required permission
     */
    static async handlePermissionDenied(message, permission) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Permission Denied')
            .setDescription(`You do not have permission to use this command.`)
            .addFields({
                name: 'Required Permission',
                value: permission || 'Unknown',
                inline: false
            })
            .setTimestamp();

        try {
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        } catch (err) {
            console.error(`[ErrorHandler] Failed to send permission denied message:`, err.message);
        }
    }

    /**
     * Handle insufficient bot permissions
     * @param {Message} message - Discord message
     * @param {string} permission - Required permission
     */
    static async handleBotPermissionError(message, permission) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Bot Permission Error')
            .setDescription(`I don't have permission to perform this action.`)
            .addFields({
                name: 'Required Permission',
                value: permission || 'Unknown',
                inline: false
            })
            .setTimestamp();

        try {
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        } catch (err) {
            console.error(`[ErrorHandler] Failed to send bot permission error:`, err.message);
        }
    }

    /**
     * Send success message
     * @param {Message} message - Discord message
     * @param {string} title - Title
     * @param {string} description - Description
     */
    static async sendSuccess(message, title, description) {
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ ' + title)
            .setDescription(description)
            .setTimestamp();

        try {
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        } catch (err) {
            console.error(`[ErrorHandler] Failed to send success message:`, err.message);
        }
    }

    /**
     * Log error to designated error channel
     * @private
     */
    static async logToErrorChannel(guildId, context, errorMessage, errorCode, options = {}) {
        try {
            const config = ConfigManager.getGuildConfig(guildId);
            const errorChannelId = config.silentErrorChannelId;

            if (!errorChannelId || !options.client) return;

            const errorChannel = await options.client.channels.fetch(errorChannelId);
            if (!errorChannel || !errorChannel.isTextBased()) return;

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`Error Log: ${context}`)
                .setDescription(errorMessage)
                .addFields(
                    { name: 'Error Code', value: errorCode, inline: true },
                    { name: 'Guild', value: guildId, inline: true }
                )
                .setTimestamp();

            await errorChannel.send({ embeds: [embed] });
        } catch (err) {
            console.error(`[ErrorHandler] Failed to log to error channel:`, err.message);
        }
    }

    /**
     * Generate unique error code
     * @private
     */
    static generateErrorCode() {
        return `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    }
}

module.exports = ErrorHandler;
