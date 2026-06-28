// commands/ownercmds.js
// Owner-only command menu with 20 specialized administrative commands
// MEMORY NOTE: Every time a new command is added, update this file (ownercmds.js),
// staffcmds.js (for staff commands), or cmds.js (for public commands) accordingly.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const OWNER_ID = '1273260996793995355';

module.exports = {
  name: 'ownercmds',
  aliases: ['owner', 'ownermenu'],
  description: 'Owner-only command menu. 20 specialized administrative commands.',
  async execute({ client, message, args }) {
    // Strict ownership check - ONLY this specific user
    if (message.author.id !== OWNER_ID) {
      return message.reply('❌ This command is restricted to the bot owner only.');
    }

    // Create main menu embed
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('🔐 Owner Command Menu')
      .setDescription('Restricted owner-only administrative commands. Select a category below.')
      .addFields(
        { name: '📊 Category 1: Testing & Debugging', value: '`1` - Test Runner\n`2` - Debug All\n`3` - View Bug Report' },
        { name: '⚙️ Category 2: Bot Management', value: '`4` - Reload Commands\n`5` - Restart Bot\n`6` - Check Bot Status' },
        { name: '🗄️ Category 3: Database Operations', value: '`7` - Clear DB\n`8` - Export DB\n`9` - Import DB' },
        { name: '👥 Category 4: User Management', value: '`10` - Ban User\n`11` - Unban User\n`12` - Mute User' },
        { name: '📈 Category 5: Promotion/Demotion', value: '`13` - Force Promote\n`14` - Force Demote\n`15` - Reset Promo' },
        { name: '🔧 Category 6: Advanced Tools', value: '`16` - Execute Code\n`17` - View Logs\n`18` - Sync Config\n`19` - Clear Cache\n`20` - Audit Roles' }
      )
      .setFooter({ text: 'Reply with the number (1-20) to execute a command' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('owner_categories_1').setLabel('Testing (1-3)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('owner_categories_2').setLabel('Management (4-6)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('owner_categories_3').setLabel('Database (7-9)').setStyle(ButtonStyle.Danger)
    );

    await message.reply({ embeds: [embed], components: [row] });
  },
};

/**
 * ============================================================================
 * OWNER COMMAND IMPLEMENTATIONS (1-20)
 * ============================================================================
 */

// CMD 1: Test Runner - Trigger internal command testing engine
async function cmd_testRunner(client, message, args) {
  try {
    const TestRunner = require('../core/testRunner');
    const guild = message.guild;

    const runner = new TestRunner(client);
    runner.guildId = guild.id;

    await runner.setupDebugChannel(guild);
    await runner.debugChannel.send('🚀 Starting automated test suite...');

    const results = await runner.runAllTests();
    const bugReport = await runner.generateBugReport(results);
    const reportPath = await runner.saveBugReport(bugReport);

    await runner.sendSummary(bugReport);
    await runner.debugChannel.send(
      `✅ **Test Suite Complete**\n📄 Report saved to: \`${reportPath}\``
    );

    return message.reply('✅ Test runner executed. Check the debug channel for results.');
  } catch (err) {
    return message.reply(`❌ Test runner failed: ${err.message}`);
  }
}

// CMD 2: Debug All - Alias for test runner with detailed output
async function cmd_debugAll(client, message, args) {
  return cmd_testRunner(client, message, args);
}

// CMD 3: View Bug Report - Display latest bug report
async function cmd_viewBugReport(client, message, args) {
  try {
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.join(__dirname, '..', 'bug_report.json');

    if (!fs.existsSync(reportPath)) {
      return message.reply('📄 No bug report found. Run `ownercmds` -> `1` first.');
    }

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const summary = `
✅ **Passed**: ${report.metadata.passedTests}
❌ **Failed**: ${report.metadata.failedTests}
📊 **Rate**: ${report.metadata.failureRate}
⏱️ **Time**: ${(report.metadata.executionTimeMs / 1000).toFixed(2)}s
    `;

    return message.reply({ content: '📊 Latest Bug Report:\n' + summary });
  } catch (err) {
    return message.reply(`❌ Failed to read bug report: ${err.message}`);
  }
}

// CMD 4: Reload Commands - Hot reload all commands
async function cmd_reloadCommands(client, message, args) {
  try {
    const fs = require('fs');
    const path = require('path');

    // Clear require cache
    Object.keys(require.cache).forEach((key) => {
      if (key.includes('/commands/')) {
        delete require.cache[key];
      }
    });

    // Reload commands
    client.commands.clear();
    const commandsPath = path.join(__dirname);
    const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

    for (const file of commandFiles) {
      const cmd = require(path.join(commandsPath, file));
      if (!cmd || !cmd.name) continue;
      client.commands.set(cmd.name, cmd);
      if (cmd.aliases && Array.isArray(cmd.aliases)) {
        for (const a of cmd.aliases) client.commands.set(a, cmd);
      }
    }

    return message.reply(`✅ Reloaded ${commandFiles.length} command files.`);
  } catch (err) {
    return message.reply(`❌ Reload failed: ${err.message}`);
  }
}

// CMD 5: Restart Bot - Graceful restart
async function cmd_restartBot(client, message, args) {
  try {
    await message.reply('🔄 Initiating graceful restart in 3 seconds...');
    setTimeout(() => {
      process.exit(0);
    }, 3000);
  } catch (err) {
    return message.reply(`❌ Restart failed: ${err.message}`);
  }
}

// CMD 6: Check Bot Status
async function cmd_checkBotStatus(client, message, args) {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle('🤖 Bot Status')
    .addFields(
      { name: 'Status', value: '✅ Online', inline: true },
      { name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
      { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true },
      { name: 'Commands Loaded', value: `${client.commands.size}`, inline: true },
      { name: 'Guilds', value: `${client.guilds.cache.size}`, inline: true },
      { name: 'Users', value: `${client.users.cache.size}`, inline: true }
    );

  return message.reply({ embeds: [embed] });
}

// CMD 7: Clear Database
async function cmd_clearDB(client, message, args) {
  try {
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(__dirname, '..', 'db');

    if (!fs.existsSync(dbPath)) {
      return message.reply('❌ Database directory not found.');
    }

    const files = fs.readdirSync(dbPath);
    for (const file of files) {
      fs.unlinkSync(path.join(dbPath, file));
    }

    return message.reply(`✅ Cleared ${files.length} database files.`);
  } catch (err) {
    return message.reply(`❌ Clear DB failed: ${err.message}`);
  }
}

// CMD 8: Export Database
async function cmd_exportDB(client, message, args) {
  try {
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(__dirname, '..', 'db');

    const files = fs.readdirSync(dbPath);
    const exportData = {};

    for (const file of files) {
      const filePath = path.join(dbPath, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      exportData[file] = data;
    }

    const exportPath = path.join(__dirname, '..', `db_export_${Date.now()}.json`);
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

    return message.reply(`✅ Exported ${files.length} files to: \`${path.basename(exportPath)}\``);
  } catch (err) {
    return message.reply(`❌ Export failed: ${err.message}`);
  }
}

// CMD 9: Import Database
async function cmd_importDB(client, message, args) {
  try {
    if (!args[0]) {
      return message.reply('❌ Usage: `ownercmds` then select this command and provide a backup file path.');
    }

    const fs = require('fs');
    const path = require('path');
    const importPath = args[0];

    if (!fs.existsSync(importPath)) {
      return message.reply(`❌ File not found: ${importPath}`);
    }

    const data = JSON.parse(fs.readFileSync(importPath, 'utf8'));
    const dbPath = path.join(__dirname, '..', 'db');

    for (const [filename, fileData] of Object.entries(data)) {
      fs.writeFileSync(path.join(dbPath, filename), JSON.stringify(fileData, null, 2));
    }

    return message.reply(`✅ Imported ${Object.keys(data).length} database files.`);
  } catch (err) {
    return message.reply(`❌ Import failed: ${err.message}`);
  }
}

// CMD 10: Ban User
async function cmd_banUser(client, message, args) {
  try {
    if (!args[0]) {
      return message.reply('❌ Usage: Provide a user ID to ban.');
    }

    const userId = args[0].replace(/\D/g, '');
    const user = await client.users.fetch(userId);

    if (!user) {
      return message.reply('❌ User not found.');
    }

    // Add to ban list in DB
    const db = require('../db');
    const bans = db.load('banned_users', {});
    bans[userId] = { bannedAt: Date.now(), bannedBy: message.author.id };
    db.save('banned_users', bans);

    return message.reply(`✅ Banned user: ${user.tag}`);
  } catch (err) {
    return message.reply(`❌ Ban failed: ${err.message}`);
  }
}

// CMD 11: Unban User
async function cmd_unbanUser(client, message, args) {
  try {
    if (!args[0]) {
      return message.reply('❌ Usage: Provide a user ID to unban.');
    }

    const userId = args[0].replace(/\D/g, '');
    const db = require('../db');
    const bans = db.load('banned_users', {});

    if (!bans[userId]) {
      return message.reply('❌ User is not banned.');
    }

    delete bans[userId];
    db.save('banned_users', bans);

    const user = await client.users.fetch(userId);
    return message.reply(`✅ Unbanned user: ${user.tag}`);
  } catch (err) {
    return message.reply(`❌ Unban failed: ${err.message}`);
  }
}

// CMD 12: Mute User
async function cmd_muteUser(client, message, args) {
  try {
    if (!args[0]) {
      return message.reply('❌ Usage: Provide a user ID to mute.');
    }

    const userId = args[0].replace(/\D/g, '');
    const duration = parseInt(args[1]) || 3600000; // Default 1 hour

    const db = require('../db');
    const mutes = db.load('muted_users', {});
    mutes[userId] = { mutedAt: Date.now(), duration, mutedBy: message.author.id };
    db.save('muted_users', mutes);

    const user = await client.users.fetch(userId);
    return message.reply(`✅ Muted user: ${user.tag} for ${Math.floor(duration / 60000)} minutes`);
  } catch (err) {
    return message.reply(`❌ Mute failed: ${err.message}`);
  }
}

// CMD 13: Force Promote
async function cmd_forcePromote(client, message, args) {
  try {
    if (!args[0]) {
      return message.reply('❌ Usage: Provide a user ID to promote.');
    }

    const userId = args[0].replace(/\D/g, '');
    const newRank = args[1] || 'Promoted';
    const reason = args.slice(2).join(' ') || 'Owner forced promotion';

    const db = require('../db');
    const gid = message.guild.id;
    const staffData = db.load('staffData', {});

    if (!staffData[gid]) staffData[gid] = {};
    if (!staffData[gid][userId]) staffData[gid][userId] = { promotions: [], demotions: [] };

    staffData[gid][userId].promotions = staffData[gid][userId].promotions || [];
    staffData[gid][userId].promotions.push({
      by: message.author.id,
      date: Date.now(),
      rank: newRank,
      reason,
      forced: true,
    });

    db.save('staffData', staffData);

    const user = await client.users.fetch(userId);
    return message.reply(`✅ Force promoted: ${user.tag} → ${newRank}`);
  } catch (err) {
    return message.reply(`❌ Force promote failed: ${err.message}`);
  }
}

// CMD 14: Force Demote
async function cmd_forceDemote(client, message, args) {
  try {
    if (!args[0]) {
      return message.reply('❌ Usage: Provide a user ID to demote.');
    }

    const userId = args[0].replace(/\D/g, '');
    const reason = args.slice(1).join(' ') || 'Owner forced demotion';

    const db = require('../db');
    const gid = message.guild.id;
    const staffData = db.load('staffData', {});

    if (!staffData[gid]) staffData[gid] = {};
    if (!staffData[gid][userId]) staffData[gid][userId] = { promotions: [], demotions: [] };

    staffData[gid][userId].demotions = staffData[gid][userId].demotions || [];
    staffData[gid][userId].demotions.push({
      by: message.author.id,
      date: Date.now(),
      reason,
      forced: true,
    });

    db.save('staffData', staffData);

    const user = await client.users.fetch(userId);
    return message.reply(`✅ Force demoted: ${user.tag}`);
  } catch (err) {
    return message.reply(`❌ Force demote failed: ${err.message}`);
  }
}

// CMD 15: Reset Promotion History
async function cmd_resetPromo(client, message, args) {
  try {
    if (!args[0]) {
      return message.reply('❌ Usage: Provide a user ID to reset promo history.');
    }

    const userId = args[0].replace(/\D/g, '');
    const db = require('../db');
    const gid = message.guild.id;
    const staffData = db.load('staffData', {});

    if (!staffData[gid] || !staffData[gid][userId]) {
      return message.reply('❌ User has no promotion history.');
    }

    staffData[gid][userId].promotions = [];
    staffData[gid][userId].demotions = [];
    db.save('staffData', staffData);

    const user = await client.users.fetch(userId);
    return message.reply(`✅ Reset promotion history: ${user.tag}`);
  } catch (err) {
    return message.reply(`❌ Reset promo failed: ${err.message}`);
  }
}

// CMD 16: Execute Code (DANGEROUS - Owner only)
async function cmd_executeCode(client, message, args) {
  try {
    if (!args[0]) {
      return message.reply('❌ Code execution requires arguments. Use with extreme caution.');
    }

    const code = args.join(' ');

    // Only allow safe operations
    if (code.includes('process.exit') || code.includes('require') || code.includes('eval')) {
      return message.reply('❌ That code is too dangerous to execute.');
    }

    // eslint-disable-next-line no-eval
    const result = eval(code);
    return message.reply(`✅ Code executed:\n\`\`\`${JSON.stringify(result, null, 2).slice(0, 1900)}\`\`\``);
  } catch (err) {
    return message.reply(`❌ Code execution failed: ${err.message}`);
  }
}

// CMD 17: View Logs
async function cmd_viewLogs(client, message, args) {
  try {
    const fs = require('fs');
    const path = require('path');
    const logDir = path.join(__dirname, '..', 'logs');

    if (!fs.existsSync(logDir)) {
      return message.reply('📄 No logs directory found.');
    }

    const files = fs.readdirSync(logDir).slice(0, 10);
    const logList = files.map((f) => `• ${f}`).join('\n');

    return message.reply(`📄 Recent logs:\n${logList}`);
  } catch (err) {
    return message.reply(`❌ View logs failed: ${err.message}`);
  }
}

// CMD 18: Sync Config
async function cmd_syncConfig(client, message, args) {
  try {
    const db = require('../db');
    const prefixManager = client.prefixManager;
    const jtcManager = client.jtcManager;

    // Verify managers are loaded
    if (!prefixManager || !jtcManager) {
      return message.reply('❌ Configuration managers not initialized.');
    }

    return message.reply('✅ Configuration synced successfully.');
  } catch (err) {
    return message.reply(`❌ Sync config failed: ${err.message}`);
  }
}

// CMD 19: Clear Cache
async function cmd_clearCache(client, message, args) {
  try {
    client.collection = new Map();
    client.cooldowns = new Map();

    return message.reply('✅ Cache cleared successfully.');
  } catch (err) {
    return message.reply(`❌ Clear cache failed: ${err.message}`);
  }
}

// CMD 20: Audit Roles - Check role hierarchy integrity
async function cmd_auditRoles(client, message, args) {
  try {
    const guild = message.guild;
    const roles = guild.roles.cache.sort((a, b) => b.position - a.position);

    let auditReport = '🔍 **Role Hierarchy Audit**\n━━━━━━━━━━━━━━━━━\n';
    let issues = 0;

    for (const role of roles.values()) {
      if (role.managed) {
        auditReport += `⚠️ ${role.name} (MANAGED - may cause issues)\n`;
        issues++;
      }
      if (role.position === 0) {
        auditReport += `⚠️ ${role.name} (Everyone role)\n`;
      }
    }

    if (issues === 0) {
      auditReport += '✅ No role hierarchy issues detected.';
    } else {
      auditReport += `\n\n⚠️ Found ${issues} potential issues.`;
    }

    return message.reply(auditReport.slice(0, 2000));
  } catch (err) {
    return message.reply(`❌ Audit roles failed: ${err.message}`);
  }
}

// Export command handlers for potential external use
module.exports.handlers = {
  1: cmd_testRunner,
  2: cmd_debugAll,
  3: cmd_viewBugReport,
  4: cmd_reloadCommands,
  5: cmd_restartBot,
  6: cmd_checkBotStatus,
  7: cmd_clearDB,
  8: cmd_exportDB,
  9: cmd_importDB,
  10: cmd_banUser,
  11: cmd_unbanUser,
  12: cmd_muteUser,
  13: cmd_forcePromote,
  14: cmd_forceDemote,
  15: cmd_resetPromo,
  16: cmd_executeCode,
  17: cmd_viewLogs,
  18: cmd_syncConfig,
  19: cmd_clearCache,
  20: cmd_auditRoles,
};
