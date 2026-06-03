---
name: RoUtil cmds list
description: Rule — always keep the COMMANDS array in index.js in sync with every command that exists in the bot.
---

Every time a new command is added to RoUtil's `index.js`, the `COMMANDS` array (defined near the top of the file, just below `verifySetupState`) must also be updated with a `{ name, desc }` entry for that command.

**Why:** `!cmds` is driven entirely by that array. If it's not updated, the new command won't appear in `!cmds`.

**How to apply:** After writing any new `if (command === '...')` block in the message listener, immediately add a corresponding line to `COMMANDS` before finishing the task.

**Current commands (as of last update):**
1. `!ping`
2. `!setprefix <new>`
3. `!find [user|item] <query>`
4. `!find item <query> by <creator>`
5. `!verifysetup`
6. `!cmds [page]`
