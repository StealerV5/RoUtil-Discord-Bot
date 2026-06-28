// commands/debugall.js
// Comprehensive automated debugging and testing command
// Triggers the test runner engine to simulate all commands and detect failures
// MEMORY NOTE: If adding new commands, update ownercmds.js, staffcmds.js, or cmds.js

const { EmbedBuilder } = require('discord.js');

const OWNER_ID = '1273260996793995355';

module.exports = {
  name: 'debugall',
  aliases: ['debug', 'fulltest', 'testall'],
  description: 'Comprehensive bot debugging and command testing suite. Owner only.',
  async execute({ client, message, args }) {
    // Ownership check
    if (message.author.id !== OWNER_ID) {
      return message.reply('❌ This command is restricted to the bot owner only.');
    }

    // Verify we're in a guild
    if (!message.guild) {
      return message.reply('❌ This command must be used in a server.');
    }

    try {
      // Initial status message
      const statusMsg = await message.reply('⏳ Initializing debug suite...');

      // Step 1: Setup debug channel
      await statusMsg.edit('📋 Setting up isolated debug channel...');
      const TestRunner = require('../core/testRunner');
      const runner = new TestRunner(client);
      runner.guildId = message.guild.id;

      let debugChannel;
      try {
        debugChannel = await runner.setupDebugChannel(message.guild);
      } catch (err) {
        return message.reply(`❌ Failed to setup debug channel: ${err.message}`);
      }

      // Step 2: Send test suite header
      const testHeader = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🧪 RoUtil Automated Debug Suite')
        .setDescription('Comprehensive command testing and validation system')
        .addFields(
          { name: '⏱️ Started At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
          { name: '👤 Initiated By', value: `${message.author.tag}`, inline: true },
          { name: '🏢 Guild', value: message.guild.name, inline: true }
        )
        .setFooter({ text: 'This test suite will comprehensively audit all bot commands' });

      await debugChannel.send({ embeds: [testHeader] });

      // Step 3: Run all tests
      await statusMsg.edit('🚀 Running command simulation tests (this may take 1-2 minutes)...');

      let results;
      try {
        results = await runner.runAllTests();
      } catch (err) {
        await debugChannel.send(`❌ **Test execution failed**: ${err.message}`);
        return statusMsg.edit(`❌ Test execution failed: ${err.message}`);
      }

      // Step 4: Generate bug report
      await statusMsg.edit('📊 Analyzing test results...');
      let bugReport;
      try {
        bugReport = await runner.generateBugReport(results);
      } catch (err) {
        await debugChannel.send(`❌ **Report generation failed**: ${err.message}`);
        return statusMsg.edit(`❌ Report generation failed: ${err.message}`);
      }

      // Step 5: Save bug report
      await statusMsg.edit('💾 Saving comprehensive bug report...');
      let reportPath;
      try {
        reportPath = await runner.saveBugReport(bugReport);
      } catch (err) {
        await debugChannel.send(`❌ **Report save failed**: ${err.message}`);
        return statusMsg.edit(`❌ Report save failed: ${err.message}`);
      }

      // Step 6: Send detailed summary
      await statusMsg.edit('📤 Generating summary report...');
      try {
        await runner.sendSummary(bugReport);
      } catch (err) {
        await debugChannel.send(`❌ **Summary generation failed**: ${err.message}`);
      }

      // Step 7: Send detailed analysis
      const analysisEmbed = new EmbedBuilder()
        .setColor(bugReport.metadata.failedTests === 0 ? 0x00ff00 : 0xff0000)
        .setTitle('📈 Test Analysis Results')
        .addFields(
          {
            name: '✅ Passed Tests',
            value: `${bugReport.metadata.passedTests} / ${bugReport.metadata.totalTests}`,
            inline: true,
          },
          {
            name: '❌ Failed Tests',
            value: `${bugReport.metadata.failedTests} / ${bugReport.metadata.totalTests}`,
            inline: true,
          },
          {
            name: '📊 Success Rate',
            value: `${(100 - parseFloat(bugReport.metadata.failureRate)).toFixed(2)}%`,
            inline: true,
          },
          {
            name: '⏱️ Execution Time',
            value: `${(bugReport.metadata.executionTimeMs / 1000).toFixed(2)}s`,
            inline: true,
          }
        );

      // Add failure breakdown
      if (Object.keys(bugReport.analysis.byType).length > 0) {
        const typeBreakdown = Object.entries(bugReport.analysis.byType)
          .map(([type, tests]) => `**${type}**: ${tests.length} failed`)
          .join('\n');
        analysisEmbed.addFields({
          name: '🔴 Failures by Type',
          value: typeBreakdown || 'None',
          inline: false,
        });
      }

      // Add critical issues
      if (bugReport.criticalIssues && bugReport.criticalIssues.length > 0) {
        const criticalList = bugReport.criticalIssues
          .slice(0, 5)
          .map((issue) => `• **${issue.command}**: ${issue.issue}`)
          .join('\n');
        analysisEmbed.addFields({
          name: `🔥 Critical Issues (${bugReport.criticalIssues.length} total)`,
          value:
            criticalList +
            (bugReport.criticalIssues.length > 5 ? `\n... and ${bugReport.criticalIssues.length - 5} more` : ''),
          inline: false,
        });
      }

      analysisEmbed.setFooter({ text: `Report saved to: ${reportPath}` });

      await debugChannel.send({ embeds: [analysisEmbed] });

      // Step 8: Send recommendations
      if (bugReport.analysis.recommendations && bugReport.analysis.recommendations.length > 0) {
        const recEmbed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle('💡 Fix Recommendations')
          .setDescription('Suggested fixes for detected issues');

        bugReport.analysis.recommendations.slice(0, 10).forEach((rec, idx) => {
          recEmbed.addFields({
            name: `${idx + 1}. ${rec.commandName} - ${rec.issue}`,
            value: `**Severity**: ${rec.severity}\n**Fix**: ${rec.fix}`,
            inline: false,
          });
        });

        if (bugReport.analysis.recommendations.length > 10) {
          recEmbed.setDescription(
            `Suggested fixes for detected issues (showing 10 of ${bugReport.analysis.recommendations.length})`
          );
        }

        await debugChannel.send({ embeds: [recEmbed] });
      }

      // Step 9: Final summary in main channel
      await statusMsg.edit({
        content: `✅ **Debug Suite Complete**\n\n📊 Results: ${bugReport.metadata.passedTests}/${bugReport.metadata.totalTests} tests passed (${(100 - parseFloat(bugReport.metadata.failureRate)).toFixed(2)}% success rate)\n\n📄 Full report saved to: \`${reportPath}\`\n\n👉 Check the <#${debugChannel.id}> channel for detailed analysis.`,
      });

      // Send final completion message to debug channel
      const completeEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Debug Suite Complete')
        .setDescription('Automated testing and analysis finished successfully')
        .addFields(
          {
            name: '📊 Final Statistics',
            value: `**Total Tests**: ${bugReport.metadata.totalTests}\n**Passed**: ${bugReport.metadata.passedTests}\n**Failed**: ${bugReport.metadata.failedTests}`,
            inline: true,
          },
          {
            name: '⏱️ Performance',
            value: `**Execution Time**: ${(bugReport.metadata.executionTimeMs / 1000).toFixed(2)}s\n**Avg per test**: ${(bugReport.metadata.executionTimeMs / bugReport.metadata.totalTests).toFixed(0)}ms`,
            inline: true,
          }
        )
        .setTimestamp();

      await debugChannel.send({ embeds: [completeEmbed] });
    } catch (err) {
      console.error('debugall command error:', err);
      return message.reply(`❌ Debug suite encountered an error: ${err.message}`);
    }
  },
};
