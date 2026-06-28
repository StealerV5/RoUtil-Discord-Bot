/**
 * PromotionSystem.js
 * Automated promotion/demotion with role hierarchy validation and logging
 */
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const ConfigManager = require('./ConfigManager');
const ErrorHandler = require('./ErrorHandler');

class PromotionSystem {
    /**
     * Trigger automatic promotion/demotion based on configured rules
     * @param {Guild} guild - Discord guild
     * @param {GuildMember} member - Guild member
     * @param {Object} metrics - Member metrics (messageCount, xp, timeInServer, etc)
     * @param {Client} client - Discord client
     */
    static async checkAndExecuteAutomaticPromotionDemotion(guild, member, metrics, client) {
        try {
            const config = ConfigManager.getPromotionConfig(guild.id);

            if (!config.enabled) return;

            // Check demotion rules first
            for (const demotionRule of (config.demotionRules || [])) {
                if (this.checkDemotionCondition(metrics, demotionRule)) {
                    await this.executeDemotion(guild, member, demotionRule, client);
                }
            }

            // Check promotion rules
            for (const promotionRule of (config.autoPromotionRoles || [])) {
                if (this.checkPromotionCondition(metrics, promotionRule)) {
                    await this.executePromotion(guild, member, promotionRule, client);
                }
            }
        } catch (err) {
            console.error('[PromotionSystem] Error checking automatic promotions:', err.message);
        }
    }

    /**
     * Manually promote a member
     * @param {GuildMember} targetMember - Member to promote
     * @param {Role} targetRole - Role to add
     * @param {GuildMember} executor - Member executing the promotion
     * @param {Client} client - Discord client
     * @returns {Object} Result object
     */
    static async promoteUser(targetMember, targetRole, executor, client) {
        try {
            const guild = targetMember.guild;

            // Validate bot permissions
            const botMember = await guild.members.fetchMe();
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return {
                    success: false,
                    error: 'Bot lacks MANAGE_ROLES permission',
                    code: 'BOT_PERMISSION_ERROR'
                };
            }

            // Check role hierarchy (bot's highest role must be above target role)
            if (botMember.roles.highest.position <= targetRole.position) {
                return {
                    success: false,
                    error: `Cannot assign role above bot's hierarchy. Bot's highest role: ${botMember.roles.highest.name} (position ${botMember.roles.highest.position}), Target role: ${targetRole.name} (position ${targetRole.position})`,
                    code: 'ROLE_HIERARCHY_ERROR'
                };
            }

            // Check if user already has the role
            if (targetMember.roles.cache.has(targetRole.id)) {
                return {
                    success: false,
                    error: `User already has the role: ${targetRole.name}`,
                    code: 'ALREADY_HAS_ROLE'
                };
            }

            // Add role
            await targetMember.roles.add(targetRole);

            // Log promotion
            await this.logPromotion(guild, targetMember, targetRole, executor, 'MANUAL');

            return {
                success: true,
                message: `Successfully promoted ${targetMember.user.tag} to ${targetRole.name}`
            };
        } catch (err) {
            console.error('[PromotionSystem] Error promoting user:', err.message);
            return {
                success: false,
                error: err.message,
                code: 'PROMOTION_ERROR'
            };
        }
    }

    /**
     * Manually demote a member
     * @param {GuildMember} targetMember - Member to demote
     * @param {Role} targetRole - Role to remove
     * @param {GuildMember} executor - Member executing the demotion
     * @param {Client} client - Discord client
     * @returns {Object} Result object
     */
    static async demoteUser(targetMember, targetRole, executor, client) {
        try {
            const guild = targetMember.guild;

            // Validate bot permissions
            const botMember = await guild.members.fetchMe();
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return {
                    success: false,
                    error: 'Bot lacks MANAGE_ROLES permission',
                    code: 'BOT_PERMISSION_ERROR'
                };
            }

            // Check role hierarchy
            if (botMember.roles.highest.position <= targetRole.position) {
                return {
                    success: false,
                    error: `Cannot remove role above bot's hierarchy`,
                    code: 'ROLE_HIERARCHY_ERROR'
                };
            }

            // Check if user has the role
            if (!targetMember.roles.cache.has(targetRole.id)) {
                return {
                    success: false,
                    error: `User does not have the role: ${targetRole.name}`,
                    code: 'NO_SUCH_ROLE'
                };
            }

            // Remove role
            await targetMember.roles.remove(targetRole);

            // Log demotion
            await this.logPromotion(guild, targetMember, targetRole, executor, 'MANUAL_DEMOTION');

            return {
                success: true,
                message: `Successfully demoted ${targetMember.user.tag} from ${targetRole.name}`
            };
        } catch (err) {
            console.error('[PromotionSystem] Error demoting user:', err.message);
            return {
                success: false,
                error: err.message,
                code: 'DEMOTION_ERROR'
            };
        }
    }

    /**
     * Check if promotion condition is met
     * @private
     */
    static checkPromotionCondition(metrics, promotionRule) {
        if (!promotionRule.triggers) return false;

        for (const trigger of promotionRule.triggers) {
            switch (trigger.type) {
                case 'message_count':
                    if ((metrics.messageCount || 0) >= trigger.value) return true;
                    break;
                case 'server_xp':
                    if ((metrics.serverXP || 0) >= trigger.value) return true;
                    break;
                case 'time_in_server':
                    // value in milliseconds
                    const timeInServer = Date.now() - (metrics.joinedAt || 0);
                    if (timeInServer >= trigger.value) return true;
                    break;
            }
        }
        return false;
    }

    /**
     * Check if demotion condition is met
     * @private
     */
    static checkDemotionCondition(metrics, demotionRule) {
        if (!demotionRule.triggers) return false;

        for (const trigger of demotionRule.triggers) {
            switch (trigger.type) {
                case 'strikes':
                    if ((metrics.activeStrikes || 0) >= trigger.value) return true;
                    break;
                case 'inactivity':
                    // value in milliseconds
                    const lastActive = metrics.lastActivityAt || 0;
                    const inactivityPeriod = Date.now() - lastActive;
                    if (inactivityPeriod >= trigger.value) return true;
                    break;
                case 'warnings':
                    if ((metrics.warnings || 0) >= trigger.value) return true;
                    break;
            }
        }
        return false;
    }

    /**
     * Execute automatic promotion
     * @private
     */
    static async executePromotion(guild, member, promotionRule, client) {
        try {
            const role = guild.roles.cache.get(promotionRule.roleId);
            if (!role) return;

            // Skip if already has role
            if (member.roles.cache.has(role.id)) return;

            const botMember = await guild.members.fetchMe();
            if (botMember.roles.highest.position <= role.position) {
                console.warn(`[PromotionSystem] Cannot auto-promote: role hierarchy issue in guild ${guild.id}`);
                return;
            }

            await member.roles.add(role);
            await this.logPromotion(guild, member, role, null, 'AUTOMATIC');
        } catch (err) {
            console.error('[PromotionSystem] Error executing automatic promotion:', err.message);
        }
    }

    /**
     * Execute automatic demotion
     * @private
     */
    static async executeDemotion(guild, member, demotionRule, client) {
        try {
            const role = guild.roles.cache.get(demotionRule.roleId);
            if (!role) return;

            // Skip if doesn't have role
            if (!member.roles.cache.has(role.id)) return;

            const botMember = await guild.members.fetchMe();
            if (botMember.roles.highest.position <= role.position) {
                console.warn(`[PromotionSystem] Cannot auto-demote: role hierarchy issue in guild ${guild.id}`);
                return;
            }

            await member.roles.remove(role);
            await this.logPromotion(guild, member, role, null, 'AUTOMATIC_DEMOTION');
        } catch (err) {
            console.error('[PromotionSystem] Error executing automatic demotion:', err.message);
        }
    }

    /**
     * Log promotion/demotion to configured channel
     * @private
     */
    static async logPromotion(guild, member, role, executor, type) {
        try {
            const config = ConfigManager.getPromotionConfig(guild.id);
            const logChannelId = config.logChannelId;

            if (!logChannelId) return;

            const logChannel = await guild.channels.fetch(logChannelId);
            if (!logChannel || !logChannel.isTextBased()) return;

            const isPromotion = type.includes('AUTOMATIC') && !type.includes('DEMOTION');
            const typeLabel = type.replace(/_/g, ' ');

            const embed = new EmbedBuilder()
                .setColor(isPromotion ? '#00FF00' : '#FFA500')
                .setTitle(`${isPromotion ? '✅ Promotion' : '⬇️ Demotion'}: ${member.user.tag}`)
                .setDescription(`Role: **${role.name}**`)
                .addFields(
                    { name: 'Member', value: `${member.user.tag} (${member.id})`, inline: true },
                    { name: 'Type', value: typeLabel, inline: true },
                    { name: 'Executor', value: executor ? `${executor.user.tag}` : 'System', inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            await logChannel.send({ embeds: [embed] });
        } catch (err) {
            console.error('[PromotionSystem] Error logging promotion:', err.message);
        }
    }

    /**
     * Get a user's current promotions/roles
     * @param {GuildMember} member - Guild member
     * @returns {Object} Roles and promotion info
     */
    static getMemberPromotionStatus(member) {
        return {
            userId: member.id,
            userTag: member.user.tag,
            roles: member.roles.cache.map(r => ({ id: r.id, name: r.name })),
            highestRole: member.roles.highest ? { id: member.roles.highest.id, name: member.roles.highest.name } : null,
            roleCount: member.roles.cache.size - 1 // Exclude @everyone
        };
    }
}

module.exports = PromotionSystem;
