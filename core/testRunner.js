// core/testRunner.js - Automated Internal Command Simulation Engine
// This engine programmatically simulates every command registered in the bot
// with various edge cases and parameter combinations. It catches failures,
// logs results to JSON, and provides actionable fix recommendations.

const fs = require('fs').promises;
const path = require('path');
const { Collection, ChannelType, PermissionFlagsBits } = require('discord.js');

class TestRunner {
  constructor(client) {
    this.client = client;
    this.results = [];
    this.startTime = null;
    this.debugChannel = null;
    this.guildId = null;
  }

  /**
   * Create or reuse isolated debug channel for test output
   */
  async setupDebugChannel(guild) {
    try {
      // Check if channel already exists
      let channel = guild.channels.cache.find(
        (c) => c.name === '⚠️-routil-internal-debugging' && c.type === ChannelType.GuildText
      );

      if (!channel) {
        channel = await guild.channels.create({
          name: '⚠️-routil-internal-debugging',
          type: ChannelType.GuildText,
          permissionOverwrites: [
            {
              id: guild.id,
              deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
            },
            {
              id: guild.ownerId,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            },
            {
              id: this.client.user.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
            },
          ],
        });
      }

      this.debugChannel = channel;
      return channel;
    } catch (err) {
      throw new Error(`Failed to setup debug channel: ${err.message}`);
    }
  }

  /**
   * Create mock Message object for testing
   */
  createMockMessage(options = {}) {
    const {
      content = '!test',
      author = { id: '123456789', username: 'testuser', bot: false, tag: 'testuser#0000' },
      member = null,
      guild = null,
      channel = null,
    } = options;

    const mockMessage = {
      id: Math.random().toString(36).substring(7),
      content,
      author,
      member: member || {
        id: author.id,
        roles: new Collection(),
        permissions: new Collection(),
        user: author,
        displayName: author.username,
      },
      guild: guild || {
        id: this.guildId || '999999999',
        name: 'TestGuild',
        ownerId: '111111111',
      },
      channel: channel || {
        id: Math.random().toString(36).substring(7),
        name: 'test-channel',
        type: ChannelType.GuildText,
        isText: () => true,
      },
      createdTimestamp: Date.now(),
      reply: async (content) => ({
        content,
        channelId: channel?.id || 'test-channel',
        id: Math.random().toString(36).substring(7),
      }),
      edit: async (content) => ({
        content,
        id: mockMessage.id,
      }),
    };

    return mockMessage;
  }

  /**
   * Create mock Interaction object for testing
   */
  createMockInteraction(options = {}) {
    const {
      customId = 'test_interaction',
      user = { id: '123456789', username: 'testuser', tag: 'testuser#0000' },
      member = null,
      guild = null,
    } = options;

    const mockInteraction = {
      id: Math.random().toString(36).substring(7),
      customId,
      type: 3,
      user,
      member: member || {
        id: user.id,
        roles: new Collection(),
        permissions: new Collection(),
        user,
        displayName: user.username,
      },
      guild: guild || {
        id: this.guildId || '999999999',
        name: 'TestGuild',
        ownerId: '111111111',
        channels: { cache: new Collection() },
      },
      replied: false,
      deferred: false,
      deferReply: async () => ({ deferred: true }),
      reply: async (content) => ({ replied: true, ...content }),
      editReply: async (content) => ({ edited: true, ...content }),
      update: async (content) => ({ updated: true, ...content }),
      showModal: async () => ({ modal: true }),
      fields: {
        getTextInputValue: (fieldId) => `test_value_${fieldId}`,
      },
    };

    return mockInteraction;
  }

  /**
   * Generate various test cases for a single command
   */
  generateTestCases(command) {
    const testCases = [];

    // Test Case 1: Valid execution (if applicable)
    testCases.push({
      name: 'Valid Execution',
      type: 'valid',
      message: this.createMockMessage({
        content: `!${command.name} arg1 arg2`,
        guild: { id: this.guildId },
      }),
    });

    // Test Case 2: No arguments
    testCases.push({
      name: 'No Arguments',
      type: 'edge_case',
      message: this.createMockMessage({
        content: `!${command.name}`,
        guild: { id: this.guildId },
      }),
    });

    // Test Case 3: Excessive arguments
    testCases.push({
      name: 'Excessive Arguments',
      type: 'edge_case',
      message: this.createMockMessage({
        content: `!${command.name} ${Array(50).fill('arg').join(' ')}`,
        guild: { id: this.guildId },
      }),
    });

    // Test Case 4: Toxic/malicious strings
    testCases.push({
      name: 'Toxic String Input',
      type: 'security',
      message: this.createMockMessage({
        content: `!${command.name} <script>alert('xss')</script> ${String.fromCharCode(0, 255)}`,
        guild: { id: this.guildId },
      }),
    });

    // Test Case 5: Very long argument
    testCases.push({
      name: 'Long Argument',
      type: 'edge_case',
      message: this.createMockMessage({
        content: `!${command.name} ${Array(1000).fill('a').join('')}`,
        guild: { id: this.guildId },
      }),
    });

    // Test Case 6: Special Discord mentions/IDs
    testCases.push({
      name: 'Discord Mentions',
      type: 'valid',
      message: this.createMockMessage({
        content: `!${command.name} <@123456789> <#987654321>`,
        guild: { id: this.guildId },
      }),
    });

    return testCases;
  }

  /**
   * Execute a single test case and capture results
   */
  async executeTest(command, testCase) {
    const testResult = {
      commandName: command.name,
      testName: testCase.name,
      testType: testCase.type,
      passed: false,
      error: null,
      errorStack: null,
      errorLine: null,
      output: null,
      executionTime: 0,
      timestamp: new Date().toISOString(),
    };

    const startTime = Date.now();

    try {
      // Extract args from message content
      const prefix = testCase.message.content[0];
      const args = testCase.message.content.slice(prefix.length).trim().split(/ +/).slice(1);

      // Wrap execution in strict error handling
      let commandOutput;
      const executionContext = {
        client: this.client,
        message: testCase.message,
        args,
        prefix,
      };

      // Execute command and verify it doesn't return undefined silently
      commandOutput = await Promise.resolve(command.execute(executionContext));

      if (commandOutput === undefined) {
        testResult.error = 'Silent Return - Command returned undefined without response';
        testResult.passed = false;
      } else {
        testResult.passed = true;
        testResult.output = 'Command executed successfully';
      }
    } catch (err) {
      testResult.passed = false;
      testResult.error = err.message;
      testResult.errorStack = err.stack;

      // Extract line number from stack trace
      const stackLines = err.stack.split('\n');
      if (stackLines.length > 1) {
        const match = stackLines[1].match(/:(\d+):/);
        if (match) {
          testResult.errorLine = parseInt(match[1], 10);
        }
      }
    } finally {
      testResult.executionTime = Date.now() - startTime;
    }

    return testResult;
  }

  /**
   * Analyze test results and generate fix recommendations
   */
  analyzeFails(results) {
    const failedTests = results.filter((r) => !r.passed);
    const analysis = {
      totalTests: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: failedTests.length,
      failureRate: `${((failedTests.length / results.length) * 100).toFixed(2)}%`,
      byType: {},
      recommendations: [],
    };

    // Group failures by type
    failedTests.forEach((test) => {
      if (!analysis.byType[test.testType]) {
        analysis.byType[test.testType] = [];
      }
      analysis.byType[test.testType].push(test);
    });

    // Generate recommendations
    failedTests.forEach((test) => {
      if (test.error.includes('Silent Return')) {
        analysis.recommendations.push({
          commandName: test.commandName,
          issue: 'Silent Return - Command did not send a response',
          severity: 'HIGH',
          fix: `Ensure the command always sends a message or reply. Add: 
          if (!response) { await message.reply('Command executed.'); }
          at the end of the command's execute() function.`,
          suggestedCode: `
          // Add to end of execute function:
          if (!response) {
            await message.channel.send('✅ Command completed successfully.');
          }`,
        });
      }

      if (test.error.includes('Permission')) {
        analysis.recommendations.push({
          commandName: test.commandName,
          issue: 'Missing Permissions Check',
          severity: 'MEDIUM',
          fix: `Add explicit permission validation before executing core logic.`,
          suggestedCode: `
          if (!message.member.permissions.has('AdministerGuild')) {
            return message.reply('❌ Administrator permission required.');
          }`,
        });
      }

      if (test.error.includes('Role') || test.error.includes('Hierarchy')) {
        analysis.recommendations.push({
          commandName: test.commandName,
          issue: 'Role Hierarchy Issue',
          severity: 'HIGH',
          fix: `Validate role hierarchy before modifying roles.`,
          suggestedCode: `
          if (targetRole.position >= interaction.member.roles.highest.position) {
            return message.reply('❌ Cannot modify roles at or above your hierarchy level.');
          }`,
        });
      }

      if (test.error.includes('Cannot') || test.error.includes('null')) {
        analysis.recommendations.push({
          commandName: test.commandName,
          issue: `Runtime Error: ${test.error}`,
          severity: 'CRITICAL',
          fix: `Add null/existence checks before accessing properties.`,
          suggestedCode: `
          if (!target || !target.id) {
            return message.reply('❌ Target member not found.');
          }`,
        });
      }
    });

    return analysis;
  }

  /**
   * Main test execution loop
   */
  async runAllTests() {
    this.startTime = Date.now();
    const allResults = [];

    try {
      // Get all registered commands
      const commands = Array.from(this.client.commands.values()).filter(
        (cmd, index, self) => self.findIndex((c) => c.name === cmd.name) === index
      );

      await this.debugChannel.send(
        `🚀 **Test Suite Started** | Total Commands: ${commands.length} | Time: <t:${Math.floor(Date.now() / 1000)}:F>`
      );

      for (const command of commands) {
        try {
          const testCases = this.generateTestCases(command);
          const commandResults = [];

          for (const testCase of testCases) {
            try {
              const result = await this.executeTest(command, testCase);
              commandResults.push(result);
            } catch (innerErr) {
              commandResults.push({
                commandName: command.name,
                testName: testCase.name,
                testType: testCase.type,
                passed: false,
                error: `Test execution crashed: ${innerErr.message}`,
                errorStack: innerErr.stack,
                executionTime: 0,
                timestamp: new Date().toISOString(),
              });
            }
          }

          allResults.push(...commandResults);

          // Send real-time update
          const passCount = commandResults.filter((r) => r.passed).length;
          const status = passCount === commandResults.length ? '✅' : '⚠️';
          await this.debugChannel.send(
            `${status} **${command.name}**: ${passCount}/${commandResults.length} tests passed`
          );
        } catch (cmdErr) {
          await this.debugChannel.send(
            `❌ **${command.name}**: Failed to execute tests - ${cmdErr.message}`
          );
          allResults.push({
            commandName: command.name,
            testName: 'COMMAND_LOAD',
            testType: 'critical',
            passed: false,
            error: cmdErr.message,
            errorStack: cmdErr.stack,
            executionTime: 0,
            timestamp: new Date().toISOString(),
          });
        }
      }

      return allResults;
    } catch (err) {
      await this.debugChannel.send(`❌ **Critical Test Suite Error**: ${err.message}`);
      throw err;
    }
  }

  /**
   * Save detailed bug report to JSON
   */
  async generateBugReport(results) {
    const analysis = this.analyzeFails(results);
    const executionTime = Date.now() - this.startTime;

    const bugReport = {
      metadata: {
        generatedAt: new Date().toISOString(),
        executionTimeMs: executionTime,
        totalTests: results.length,
        passedTests: results.filter((r) => r.passed).length,
        failedTests: results.filter((r) => !r.passed).length,
        failureRate: analysis.failureRate,
      },
      analysis: {
        byType: analysis.byType,
        recommendations: analysis.recommendations,
      },
      detailedResults: results.map((r) => ({
        commandName: r.commandName,
        testName: r.testName,
        testType: r.testType,
        status: r.passed ? 'PASSED' : 'FAILED',
        error: r.error,
        errorLine: r.errorLine,
        errorStack: r.errorStack,
        executionTime: `${r.executionTime}ms`,
        timestamp: r.timestamp,
      })),
      criticalIssues: results
        .filter((r) => !r.passed && (r.error.includes('Role') || r.error.includes('Permission') || r.error.includes('Hierarchy')))
        .map((r) => ({
          command: r.commandName,
          issue: r.error,
          line: r.errorLine,
          stack: r.errorStack.split('\n').slice(0, 3).join('\n'),
        })),
    };

    return bugReport;
  }

  /**
   * Save bug report to file system
   */
  async saveBugReport(bugReport) {
    try {
      const reportPath = path.join(__dirname, '..', 'bug_report.json');
      await fs.writeFile(reportPath, JSON.stringify(bugReport, null, 2));
      return reportPath;
    } catch (err) {
      throw new Error(`Failed to save bug report: ${err.message}`);
    }
  }

  /**
   * Format and send summary to debug channel
   */
  async sendSummary(bugReport) {
    const { metadata, analysis, criticalIssues } = bugReport;

    let summaryText = `
📊 **Test Suite Summary**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Passed: ${metadata.passedTests}/${metadata.totalTests}
❌ Failed: ${metadata.failedTests}/${metadata.totalTests}
📈 Success Rate: ${(100 - parseFloat(metadata.failureRate)).toFixed(2)}%
⏱️ Execution Time: ${(metadata.executionTimeMs / 1000).toFixed(2)}s

${
  Object.keys(analysis.byType).length > 0
    ? `**Issues by Type:**
${Object.entries(analysis.byType)
  .map(([type, tests]) => `  • ${type}: ${tests.length} failed`)
  .join('\n')}`
    : '✅ **No issues detected!**'
}

${
  criticalIssues.length > 0
    ? `**🔴 Critical Issues (${criticalIssues.length}):**
${criticalIssues
  .slice(0, 5)
  .map((issue) => `  • **${issue.command}**: ${issue.issue}`)
  .join('\n')}${criticalIssues.length > 5 ? `\n  ... and ${criticalIssues.length - 5} more` : ''}`
    : ''
}

📄 **Full Report**: Check \`bug_report.json\` in the repository root.
`;

    if (summaryText.length > 2000) {
      const chunks = summaryText.match(/[\s\S]{1,1990}/g) || [];
      for (const chunk of chunks) {
        await this.debugChannel.send(chunk);
      }
    } else {
      await this.debugChannel.send(summaryText);
    }
  }
}

module.exports = TestRunner;
