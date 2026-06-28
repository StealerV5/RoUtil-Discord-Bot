# RoUtil Refactor Notes

This commit refactors RoUtil to:
- Centralized command handler using dynamic prefixes from data/prefixes.json (fallback to `!`).
- New prefix manager (utils/prefixManager.js) with get/set methods.
- Event-based handlers in events/ (messageCreate, voiceStateUpdate).
- Join-to-Create feature (events/voiceStateUpdate + utils/jtcManager.js + commands/jtc-setup.js).

Setup:
- Add DISCORD_TOKEN to environment (e.g., in a .env file) and run `node index.js`.
- Use `!setprefix <prefix>` (or configured prefix) to change per-guild prefix.
- Configure JTC with `!jtc-setup <lobbyVoiceChannelId> [userLimit] [namePattern] [roleIds]`.

Notes:
- This is a refactor blueprint. You may need to adapt to existing repo structure or CI.
