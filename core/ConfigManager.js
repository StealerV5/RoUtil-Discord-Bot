/**
 * ConfigManager.js
 * Centralized configuration management for per-server settings
 */
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'configs');

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

class ConfigManager {
    constructor() {
        this.cache = new Map();
        this.defaults = {
            prefix: '!',
            promotionConfig: {
                enabled: false,
                triggers: [],
                logChannelId: null,
                autoPromotionRoles: [],
                demotionRules: []
            },
            silentErrorChannelId: null
        };
    }

    /**
     * Get configuration for a guild
     * @param {string} guildId - Guild ID
     * @returns {Object} Configuration object
     */
    getGuildConfig(guildId) {
        if (this.cache.has(guildId)) {
            return this.cache.get(guildId);
        }

        const configPath = path.join(CONFIG_DIR, `${guildId}.json`);
        let config = { ...this.defaults };

        if (fs.existsSync(configPath)) {
            try {
                const fileData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                config = { ...config, ...fileData };
            } catch (err) {
                console.error(`[ConfigManager] Error reading config for ${guildId}:`, err.message);
            }
        }

        this.cache.set(guildId, config);
        return config;
    }

    /**
     * Save configuration for a guild
     * @param {string} guildId - Guild ID
     * @param {Object} config - Configuration object
     */
    saveGuildConfig(guildId, config) {
        const configPath = path.join(CONFIG_DIR, `${guildId}.json`);
        
        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
            this.cache.set(guildId, config);
            return true;
        } catch (err) {
            console.error(`[ConfigManager] Error saving config for ${guildId}:`, err.message);
            return false;
        }
    }

    /**
     * Get guild prefix
     * @param {string} guildId - Guild ID
     * @returns {string} Prefix
     */
    getPrefix(guildId) {
        const config = this.getGuildConfig(guildId);
        return config.prefix || this.defaults.prefix;
    }

    /**
     * Set guild prefix
     * @param {string} guildId - Guild ID
     * @param {string} prefix - New prefix
     * @returns {boolean} Success
     */
    setPrefix(guildId, prefix) {
        if (!prefix || prefix.length > 10) {
            return false;
        }
        const config = this.getGuildConfig(guildId);
        config.prefix = prefix;
        return this.saveGuildConfig(guildId, config);
    }

    /**
     * Get promotion configuration
     * @param {string} guildId - Guild ID
     * @returns {Object} Promotion config
     */
    getPromotionConfig(guildId) {
        const config = this.getGuildConfig(guildId);
        return config.promotionConfig || this.defaults.promotionConfig;
    }

    /**
     * Update promotion configuration
     * @param {string} guildId - Guild ID
     * @param {Object} promotionConfig - New promotion config
     * @returns {boolean} Success
     */
    setPromotionConfig(guildId, promotionConfig) {
        const config = this.getGuildConfig(guildId);
        config.promotionConfig = { ...config.promotionConfig, ...promotionConfig };
        return this.saveGuildConfig(guildId, config);
    }

    /**
     * Clear cache (useful for testing)
     */
    clearCache() {
        this.cache.clear();
    }
}

module.exports = new ConfigManager();
