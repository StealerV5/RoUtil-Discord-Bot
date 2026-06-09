const {
    Client, GatewayIntentBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder, ChannelType,
    PermissionFlagsBits, AttachmentBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const express = require('express');
const fs   = require('fs');
const path = require('path');
const { load: dbLoad } = require('./db');

// ── Staff management systems ──────────────────────────────────────────────────
const modSystem    = require('./systems/moderation');
const cfgSystem    = require('./systems/config');
const profileSys   = require('./systems/staffProfile');
const loaSys       = require('./systems/loa');
const promoSys     = require('./systems/promotions');
const trainSys     = require('./systems/training');
const feedbackSys  = require('./systems/feedback');
const activitySys  = require('./systems/activity');
const deptSys      = require('./systems/departments');
const analyticsSys = require('./systems/analytics');

// ── Web server + Dashboard API ────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ── /api/status ───────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
    try {
        res.json({ online: client.isReady(), tag: client.user?.tag || '', guilds: client.guilds?.cache.size || 0 });
    } catch { res.json({ online: false }); }
});

// ── /api/guilds ───────────────────────────────────────────────────────────────
app.get('/api/guilds', (_req, res) => {
    try {
        const guilds = [...client.guilds.cache.values()].map(g => ({ id: g.id, name: g.name, icon: g.iconURL() }));
        res.json(guilds);
    } catch { res.json([]); }
});

// ── /api/overview ─────────────────────────────────────────────────────────────
app.get('/api/overview', (req, res) => {
    try {
        const gid     = req.query.guild;
        const cases   = dbLoad('cases',       {})[gid]?.list || [];
        const staffDb = dbLoad('staffData',   {})[gid]       || {};
        const actDb   = dbLoad('activity',    {})[gid]       || {};
        const deptDb  = dbLoad('departments', {})[gid]       || {};

        const allStaff = Object.entries(staffDb);
        const topAct   = Object.entries(actDb)
            .map(([uid, r]) => ({ uid, ...r }))
            .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);

        const DEPT_DEFAULTS = ['Administration','Moderation','Human Resources','Internal Affairs','Development','Security'];
        const deptResult = DEPT_DEFAULTS.map(name => {
            const d = deptDb[name] || {};
            return { name, members: (d.members || []).length, performance: d.performance || 0 };
        });

        res.json({
            totalCases:        cases.length,
            warnings:          cases.filter(c => c.type === 'warn').length,
            strikes:           cases.filter(c => c.type === 'strike').length,
            activeStrikes:     allStaff.reduce((s, [, r]) => s + (r.activeStrikes || 0), 0),
            suspensions:       cases.filter(c => c.type === 'suspend').length,
            activeSuspensions: allStaff.filter(([, r]) => r.isSuspended).length,
            activeStaff:       allStaff.filter(([, r]) => !r.isSuspended && !r.isTerminated && !r.isBanned).length,
            totalTracked:      allStaff.length,
            onLOA:             allStaff.filter(([, r]) => r.isLOA).length,
            recentCases:       cases.slice(-10).reverse(),
            topActivity:       topAct,
            departments:       deptResult,
        });
    } catch (e) {
        console.error('[API /overview]', e.message);
        res.status(500).json({ error: 'Failed to load overview' });
    }
});

// ── /api/cases ────────────────────────────────────────────────────────────────
app.get('/api/cases', (req, res) => {
    try {
        const gid    = req.query.guild;
        const type   = req.query.type   || 'all';
        const search = (req.query.search || '').toLowerCase();
        const pageN  = Math.max(0, parseInt(req.query.page) || 0);

        let list = dbLoad('cases', {})[gid]?.list || [];
        if (type !== 'all') list = list.filter(c => c.type === type);
        if (search)         list = list.filter(c =>
            c.reason?.toLowerCase().includes(search) ||
            c.id?.toLowerCase().includes(search) ||
            c.userId?.includes(search)
        );
        const total = list.length;
        const paged = [...list].reverse().slice(pageN * 20, (pageN + 1) * 20);
        res.json({ cases: paged, total });
    } catch (e) {
        console.error('[API /cases]', e.message);
        res.status(500).json({ error: 'Failed to load cases', cases: [], total: 0 });
    }
});

// ── /api/staff ────────────────────────────────────────────────────────────────
app.get('/api/staff', (req, res) => {
    try {
        const gid     = req.query.guild;
        const staffDb = dbLoad('staffData', {})[gid] || {};
        const caseDb  = dbLoad('cases',     {})[gid]?.list || [];

        const result = Object.entries(staffDb).map(([uid, r]) => ({
            uid,
            isTerminated:  r.isTerminated  || false,
            isBanned:      r.isBanned      || false,
            isSuspended:   r.isSuspended   || false,
            isLOA:         r.isLOA         || false,
            activeStrikes: r.activeStrikes || 0,
            warnings:    caseDb.filter(c => c.userId === uid && c.type === 'warn').length,
            suspensions: caseDb.filter(c => c.userId === uid && c.type === 'suspend').length,
            promotions:  (r.promotions || []).length,
            trainings:   (r.trainings  || []).length,
        }));
        res.json(result);
    } catch (e) {
        console.error('[API /staff]', e.message);
        res.status(500).json([]);
    }
});

// ── /api/activity ─────────────────────────────────────────────────────────────
app.get('/api/activity', (req, res) => {
    try {
        const gid    = req.query.guild;
        const actDb  = dbLoad('activity', {})[gid] || {};

        const all     = Object.entries(actDb).map(([uid, r]) => ({ uid, ...r }));
        const allTime = [...all].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 50);
        const weekly  = [...all].sort((a, b) => (b.weekMessages || 0) - (a.weekMessages || 0)).slice(0, 20);
        res.json({ allTime, weekly });
    } catch (e) {
        console.error('[API /activity]', e.message);
        res.status(500).json({ allTime: [], weekly: [] });
    }
});

// ── /api/departments ──────────────────────────────────────────────────────────
app.get('/api/departments', (req, res) => {
    try {
        const gid    = req.query.guild;
        const deptDb = dbLoad('departments', {})[gid] || {};
        const DEFAULTS = ['Administration','Moderation','Human Resources','Internal Affairs','Development','Security'];

        const result = DEFAULTS.map(name => {
            const d = deptDb[name] || {};
            return { name, members: (d.members || []).length, memberList: d.members || [], performance: d.performance || 0, notes: d.notes || '' };
        });
        res.json(result);
    } catch (e) {
        console.error('[API /departments]', e.message);
        res.status(500).json([]);
    }
});

// ── /api/training ─────────────────────────────────────────────────────────────
app.get('/api/training', (req, res) => {
    try {
        const gid     = req.query.guild;
        const trainDb = dbLoad('trainings', {})[gid]?.sessions || [];

        const result = [...trainDb].reverse().map(t => ({
            id:         t.id,
            name:       t.name,
            status:     t.status,
            instructor: t.instructor,
            attendees:  (t.attendees || []).length,
            passed:     (t.passed   || []).length,
            failed:     (t.failed   || []).length,
            created:    t.created,
        }));
        res.json(result);
    } catch (e) {
        console.error('[API /training]', e.message);
        res.status(500).json([]);
    }
});

// ── /api/loa ──────────────────────────────────────────────────────────────────
app.get('/api/loa', (req, res) => {
    try {
        const gid    = req.query.guild;
        const loaDb  = dbLoad('loa', {})[gid] || {};
        const result = [];

        for (const [uid, rec] of Object.entries(loaDb)) {
            if (!rec || typeof rec !== 'object') continue;
            if (rec.active) {
                result.push({ uid, active: true, reason: rec.reason, startDate: rec.startDate, endDate: rec.endDate });
            }
            for (const h of (rec.history || [])) {
                result.push({ uid, active: false, reason: h.reason, startDate: h.startDate, endDate: h.endDate, approved: h.approved });
            }
        }
        res.json(result);
    } catch (e) {
        console.error('[API /loa]', e.message);
        res.status(500).json([]);
    }
});

// ── Global Express error handler ──────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[Express error]', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(3000, () => {
    console.log('Web server running on port 3000');
});

// ── Keep the process alive on unexpected errors ────────────────────────────────
process.on('uncaughtException',  err => console.error('[Uncaught Exception]', err));
process.on('unhandledRejection', err => console.error('[Unhandled Rejection]', err));

// 2. Initialize Bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const DEFAULT_PREFIX = '!';
let prefixes = {};
if (fs.existsSync('./prefixes.json')) {
    prefixes = JSON.parse(fs.readFileSync('./prefixes.json', 'utf8'));
}

// ── Verification config ───────────────────────────────────────────────────────

let verifyConfig = {};
if (fs.existsSync('./verifyConfig.json')) {
    verifyConfig = JSON.parse(fs.readFileSync('./verifyConfig.json', 'utf8'));
}
function saveVerifyConfig() {
    fs.writeFileSync('./verifyConfig.json', JSON.stringify(verifyConfig, null, 4));
}

// ── Report config ─────────────────────────────────────────────────────────────

let reportConfig = {};
if (fs.existsSync('./reportConfig.json')) {
    reportConfig = JSON.parse(fs.readFileSync('./reportConfig.json', 'utf8'));
}
function saveReportConfig() {
    fs.writeFileSync('./reportConfig.json', JSON.stringify(reportConfig, null, 4));
}

// ── Appeal config ─────────────────────────────────────────────────────────────

let appealConfig = {};
if (fs.existsSync('./appealConfig.json')) {
    appealConfig = JSON.parse(fs.readFileSync('./appealConfig.json', 'utf8'));
}
function saveAppealConfig() {
    fs.writeFileSync('./appealConfig.json', JSON.stringify(appealConfig, null, 4));
}

// ── Tickets database ──────────────────────────────────────────────────────────

let tickets = { channels: {}, activeReports: {}, activeAppeals: {}, nextReportId: 1, nextAppealId: 1 };
if (fs.existsSync('./tickets.json')) {
    tickets = { ...tickets, ...JSON.parse(fs.readFileSync('./tickets.json', 'utf8')) };
}
function saveTickets() {
    fs.writeFileSync('./tickets.json', JSON.stringify(tickets, null, 4));
}

// Tracks in-progress setup sessions: guildId → state object
const verifySetupState  = new Map();
const reportSetupState  = new Map();
const appealSetupState  = new Map();

// ── Commands list ─────────────────────────────────────────────────────────────
const MEMBER_CMDS = [
    // ── General ───────────────────────────────────────────────────────────────
    { name: '!cmds',                                desc: 'View all member commands, paginated.' },
    { name: '!staffcmds',                           desc: 'View all staff commands (staff only).' },
    { name: '!ping',                                desc: 'Check if the bot is online and view latency.' },
    { name: '!botinfo',                             desc: 'Show bot version, uptime, and server count.' },
    { name: '!uptime',                              desc: 'Show how long the bot has been running.' },
    { name: '!setprefix <new>',                     desc: 'Change the command prefix. Requires Manage Server.' },
    { name: '!prefix',                              desc: 'Show the current command prefix for this server.' },
    { name: '!invite',                              desc: 'Get a link to invite RoUtil to your server.' },
    // ── Roblox Lookup ─────────────────────────────────────────────────────────
    { name: '!find user <name>',                    desc: 'Search for a Roblox user by username.' },
    { name: '!find item <query>',                   desc: 'Search the Roblox catalog for items.' },
    { name: '!find item <query> by <creator>',      desc: 'Search catalog items filtered by creator name.' },
    { name: '!find game <query>',                   desc: 'Search for Roblox games by name.' },
    { name: '!find group <query>',                  desc: 'Search for Roblox groups by name.' },
    { name: '!roblox <username>',                   desc: 'View detailed profile stats for a Roblox user.' },
    { name: '!gameinfo <placeId>',                  desc: 'View info and stats about a specific Roblox game.' },
    { name: '!groupinfo <groupId>',                 desc: 'View details about a Roblox group.' },
    { name: '!groupwall <groupId>',                 desc: 'View recent wall posts for a Roblox group.' },
    { name: '!groupranks <groupId>',                desc: 'List all ranks inside a Roblox group.' },
    { name: '!groupmembers <groupId>',              desc: 'View member count and breakdown for a Roblox group.' },
    { name: '!catalogitem <itemId>',                desc: 'Get detailed info on a specific catalog item.' },
    { name: '!limiteds',                            desc: 'Browse popular Roblox limited items.' },
    { name: '!newlimiteds',                         desc: 'Show the most recently released limited items.' },
    { name: '!topgames',                            desc: 'Show the top trending Roblox games right now.' },
    { name: '!newgames',                            desc: 'Show newly released Roblox games.' },
    { name: '!featuredgames',                       desc: 'Show currently featured Roblox games.' },
    { name: '!gamesearch <query>',                  desc: 'Search all public Roblox games.' },
    { name: '!badgeinfo <badgeId>',                 desc: 'Get info on a specific Roblox badge.' },
    { name: '!assetinfo <assetId>',                 desc: 'View info about any Roblox asset.' },
    // ── Verification ──────────────────────────────────────────────────────────
    { name: '!verify',                              desc: 'Link your Roblox account via bio code or gamepass.' },
    { name: '!whois @user',                         desc: 'Look up the Roblox account linked to a Discord member.' },
    { name: '!verified',                            desc: 'Show how many members have verified in this server.' },
    { name: '!myverify',                            desc: 'Show your currently linked Roblox account.' },
    { name: '!unverify',                            desc: 'Unlink your Roblox account from Discord.' },
    { name: '!reverify',                            desc: 'Re-link to a different Roblox account.' },
    { name: '!verifyinfo',                          desc: 'Explain how the verification system works.' },
    { name: '!verifycheck @user',                   desc: 'Check whether a member is verified.' },
    // ── Profile & Customization ───────────────────────────────────────────────
    { name: '!profile [@user]',                     desc: 'View a member\'s profile card.' },
    { name: '!setbio <text>',                       desc: 'Set your personal profile bio.' },
    { name: '!mybio',                               desc: 'View your current profile bio.' },
    { name: '!setpronoun <pronouns>',               desc: 'Set your preferred pronouns shown on your profile.' },
    { name: '!mypronoun',                           desc: 'View the pronouns set on your profile.' },
    { name: '!settimezone <tz>',                    desc: 'Set your timezone for the server (e.g. America/New_York).' },
    { name: '!timezone [@user]',                    desc: 'Show your or another member\'s set timezone.' },
    { name: '!avatar [@user]',                      desc: 'Show a user\'s full-size Discord avatar.' },
    { name: '!banner [@user]',                      desc: 'Show a user\'s Discord banner image.' },
    { name: '!userinfo [@user]',                    desc: 'Show Discord account info for a member.' },
    { name: '!setcolor <hex>',                      desc: 'Set your personal color role by hex code.' },
    { name: '!resetcolor',                          desc: 'Remove your current color role.' },
    { name: '!mycolor',                             desc: 'Show your currently active color role.' },
    { name: '!colors',                              desc: 'View all available color roles you can pick.' },
    // ── Server Info ───────────────────────────────────────────────────────────
    { name: '!serverstats',                         desc: 'Show member, channel, and role counts for this server.' },
    { name: '!membercount',                         desc: 'Quick total member count.' },
    { name: '!roleinfo <role>',                     desc: 'Show info about a specific role.' },
    { name: '!channelinfo [#channel]',              desc: 'Show info about a channel.' },
    { name: '!servericon',                          desc: 'Show the full server icon image.' },
    { name: '!serverbanner',                        desc: 'Show the server banner image.' },
    { name: '!serverinfo',                          desc: 'Detailed server info (ID, owner, features, etc.).' },
    { name: '!emojis',                              desc: 'List all custom emojis in this server.' },
    { name: '!stickers',                            desc: 'List all custom stickers in this server.' },
    { name: '!boosts',                              desc: 'Show the server\'s current boost level and count.' },
    { name: '!roles',                               desc: 'List all roles in the server.' },
    { name: '!stafflist',                           desc: 'View the public staff directory.' },
    // ── My Records ────────────────────────────────────────────────────────────
    { name: '!myrecord',                            desc: 'View your full moderation record.' },
    { name: '!mywarnings',                          desc: 'View all warnings on your record.' },
    { name: '!mystrikes',                           desc: 'View your active strikes.' },
    { name: '!mycase <case-id>',                    desc: 'Look up a specific case by its ID.' },
    { name: '!mysuspensions',                       desc: 'View your suspension history.' },
    { name: '!mynotes',                             desc: 'View staff notes attached to your record.' },
    { name: '!appealstatus',                        desc: 'Check the status of your active appeal.' },
    { name: '!myrep',                               desc: 'View your current reputation score.' },
    { name: '!mypoints',                            desc: 'Check your current points balance.' },
    { name: '!myquota',                             desc: 'Check your current activity quota progress.' },
    // ── Applications ──────────────────────────────────────────────────────────
    { name: '!apply',                               desc: 'Apply for a staff position (opens a form).' },
    { name: '!applicationstatus',                   desc: 'Check the status of your application.' },
    { name: '!withdrawapplication',                 desc: 'Withdraw your pending application.' },
    { name: '!applicationinfo',                     desc: 'Learn about the staff application process.' },
    { name: '!applicationrequirements',             desc: 'View the requirements to submit an application.' },
    { name: '!applicationfaq',                      desc: 'Frequently asked application questions.' },
    { name: '!applicationhistory',                  desc: 'View your past application submissions.' },
    { name: '!openpositions',                       desc: 'View currently open staff positions.' },
    // ── Training ──────────────────────────────────────────────────────────────
    { name: '!mytrainings',                         desc: 'View your training history and pass/fail record.' },
    { name: '!trainingschedule',                    desc: 'See all upcoming training sessions.' },
    { name: '!nextraining',                         desc: 'Show the next scheduled training session.' },
    { name: '!traininginfo <id>',                   desc: 'Get details about a specific training session.' },
    { name: '!trainingresults <id>',                desc: 'View the results from a training session.' },
    { name: '!trainingteam',                        desc: 'See who is on the training team.' },
    { name: '!trainingleaderboard',                 desc: 'Top members by trainings completed.' },
    { name: '!trainingfaq',                         desc: 'Frequently asked training questions.' },
    // ── LOA ───────────────────────────────────────────────────────────────────
    { name: '!loastatus',                           desc: 'Check your current leave of absence status.' },
    { name: '!myactiveloa',                         desc: 'Show your active LOA details and end date.' },
    { name: '!loahistory',                          desc: 'View your past leave of absence records.' },
    { name: '!loainfo',                             desc: 'Learn how the LOA system works.' },
    { name: '!loalist',                             desc: 'View all members currently on LOA.' },
    { name: '!loarequest',                          desc: 'Request a leave of absence (opens a form).' },
    // ── Department Info ───────────────────────────────────────────────────────
    { name: '!deptinfo <name>',                     desc: 'View info and details about a department.' },
    { name: '!mydepartment',                        desc: 'See which departments you\'re a member of.' },
    { name: '!deptmembers <name>',                  desc: 'View all members of a specific department.' },
    { name: '!deptlead <name>',                     desc: 'See who leads a department.' },
    { name: '!deptlist',                            desc: 'List all departments and their member counts.' },
    { name: '!deptperformance <name>',              desc: 'View a department\'s current performance score.' },
    { name: '!deptleaderboard',                     desc: 'Rankings of departments by performance score.' },
    { name: '!applydept <name>',                    desc: 'Apply to join a department.' },
    // ── Promotions & Rank ─────────────────────────────────────────────────────
    { name: '!rankinfo <rank>',                     desc: 'View info and perks for a specific rank.' },
    { name: '!promotioninfo',                       desc: 'Learn about the promotion and demotion system.' },
    { name: '!myrankstatus',                        desc: 'Check your current promotion eligibility.' },
    { name: '!promotionrequirements',               desc: 'View requirements needed for your next rank.' },
    { name: '!promotionhistory',                    desc: 'View your personal promotion/demotion history.' },
    { name: '!rankleaderboard',                     desc: 'Members ranked by their current position.' },
    { name: '!checkeligibility',                    desc: 'Run a full promotion eligibility check on yourself.' },
    { name: '!quotainfo',                           desc: 'View quota requirements for your rank.' },
    { name: '!quotaprogress',                       desc: 'See how far along you are to meeting quota.' },
    { name: '!rankchangelog',                       desc: 'View recent changes to the rank structure.' },
    // ── Events ────────────────────────────────────────────────────────────────
    { name: '!events',                              desc: 'List all upcoming events.' },
    { name: '!eventinfo <id>',                      desc: 'Get full details about a specific event.' },
    { name: '!nextevent',                           desc: 'Show the next scheduled event and countdown.' },
    { name: '!rsvp <id>',                           desc: 'RSVP to an upcoming event.' },
    { name: '!unrsvp <id>',                         desc: 'Cancel your RSVP for an event.' },
    { name: '!myrsvp',                              desc: 'Show all events you have RSVPed to.' },
    { name: '!pastedevents',                        desc: 'View a history of past completed events.' },
    { name: '!eventcalendar',                       desc: 'Show the monthly event calendar.' },
    { name: '!eventleaderboard',                    desc: 'Top members by total event attendance.' },
    { name: '!eventannouncement',                   desc: 'View the latest event announcement.' },
    // ── Points & XP ───────────────────────────────────────────────────────────
    { name: '!points [@user]',                      desc: 'Check your or another member\'s points balance.' },
    { name: '!pointsleaderboard',                   desc: 'Top members by points balance.' },
    { name: '!pointshistory',                       desc: 'View your points earning and spending history.' },
    { name: '!giftpoints @user <amount>',           desc: 'Gift some of your points to another member.' },
    { name: '!level [@user]',                       desc: 'Show your current XP level.' },
    { name: '!rank [@user]',                        desc: 'View your full rank card with XP progress.' },
    { name: '!xp [@user]',                          desc: 'Check your current XP and progress to next level.' },
    { name: '!levelboard',                          desc: 'Top members by XP level.' },
    { name: '!levelrewards',                        desc: 'View rewards unlocked at each XP level.' },
    { name: '!nextlevel',                           desc: 'Show how much XP you need for the next level.' },
    { name: '!xprate',                              desc: 'View the current XP earn rate per message.' },
    { name: '!activity [@user]',                    desc: 'View activity statistics and score for a member.' },
    // ── Social ────────────────────────────────────────────────────────────────
    { name: '!kudos @user <reason>',                desc: 'Give kudos to a member for something great.' },
    { name: '!topkudos',                            desc: 'Members with the most kudos received.' },
    { name: '!mykudos',                             desc: 'View kudos you have received from others.' },
    { name: '!rep @user',                           desc: 'Give reputation to a member (once per day).' },
    { name: '!toprep',                              desc: 'Members with the highest reputation score.' },
    { name: '!greet @user',                         desc: 'Send a friendly greeting to a member.' },
    { name: '!congrats @user',                      desc: 'Send congratulations to a member.' },
    { name: '!thank @user',                         desc: 'Express thanks to a member publicly.' },
    { name: '!welcome @user',                       desc: 'Welcome a new member to the server.' },
    { name: '!afk <reason>',                        desc: 'Set yourself as AFK with an optional reason.' },
    // ── Fun & Utility ─────────────────────────────────────────────────────────
    { name: '!coinflip',                            desc: 'Flip a coin — Heads or Tails.' },
    { name: '!dice [sides]',                        desc: 'Roll a dice. Default is 6 sides.' },
    { name: '!8ball <question>',                    desc: 'Ask the magic 8-ball a question.' },
    { name: '!choose <a|b|c>',                      desc: 'Let the bot randomly pick from your options.' },
    { name: '!random <min> <max>',                  desc: 'Generate a random number in a range.' },
    { name: '!time',                                desc: 'Show the current UTC time.' },
    { name: '!timestamp <date>',                    desc: 'Generate a Discord-formatted timestamp.' },
    { name: '!worldtime <city>',                    desc: 'Show the current time in a given city.' },
    { name: '!convert <amount> <from> <to>',        desc: 'Convert between units (e.g. km to miles).' },
    { name: '!percentage <value> <total>',          desc: 'Calculate a percentage.' },
    { name: '!calculate <expression>',              desc: 'Evaluate a math expression.' },
    { name: '!qrcode <text>',                       desc: 'Generate a QR code image for any text.' },
    { name: '!encode <text>',                       desc: 'Base64-encode a string.' },
    { name: '!decode <text>',                       desc: 'Base64-decode a string.' },
    { name: '!color <hex>',                         desc: 'Preview a hex color and get its RGB values.' },
    { name: '!shorten <url>',                       desc: 'Shorten a long URL.' },
    { name: '!charcount <text>',                    desc: 'Count characters and words in a string.' },
    { name: '!reverse <text>',                      desc: 'Reverse a string of text.' },
    // ── Polls & Voting ────────────────────────────────────────────────────────
    { name: '!poll <q>|<opt1>|<opt2>',              desc: 'Create a multi-option vote.' },
    { name: '!vote <poll-id> <option>',             desc: 'Cast your vote on an active poll.' },
    { name: '!polls',                               desc: 'View all currently active polls.' },
    { name: '!pollresults <id>',                    desc: 'View the current results of a poll.' },
    { name: '!mypoll',                              desc: 'View polls you have created.' },
    { name: '!pollhistory',                         desc: 'View past polls and their final results.' },
    { name: '!endpoll <id>',                        desc: 'End your own poll early and display results.' },
    { name: '!activepoll',                          desc: 'Show the most recently started active poll.' },
    // ── Suggestions ───────────────────────────────────────────────────────────
    { name: '!suggest <text>',                      desc: 'Submit a suggestion to the staff team.' },
    { name: '!suggestions',                         desc: 'View open suggestions and their vote counts.' },
    { name: '!mysuggestions',                       desc: 'View suggestions you have submitted.' },
    { name: '!voteon <id>',                         desc: 'Upvote or downvote a suggestion.' },
    { name: '!suggestionstatus <id>',               desc: 'Check the current status of a suggestion.' },
    { name: '!topsuggestions',                      desc: 'View the most upvoted suggestions.' },
    // ── Giveaways ─────────────────────────────────────────────────────────────
    { name: '!giveaways',                           desc: 'List all currently active giveaways.' },
    { name: '!joingiveaway <id>',                   desc: 'Enter an active giveaway.' },
    { name: '!mygiveaways',                         desc: 'See giveaways you have entered.' },
    { name: '!giveawayinfo <id>',                   desc: 'Get full details on a specific giveaway.' },
    { name: '!pastgiveaways',                       desc: 'View ended giveaways and their winners.' },
    { name: '!giveawaywinners <id>',                desc: 'See who won a specific giveaway.' },
    { name: '!giveawaycount',                       desc: 'How many giveaways you have won in total.' },
    { name: '!giveawaynotify',                      desc: 'Toggle giveaway ping notifications for yourself.' },
    // ── Tags ──────────────────────────────────────────────────────────────────
    { name: '!tag <name>',                          desc: 'View a saved tag by name.' },
    { name: '!tags',                                desc: 'List all available server tags.' },
    { name: '!taginfo <name>',                      desc: 'View details and the author of a tag.' },
    { name: '!tagsearch <query>',                   desc: 'Search tags by keyword.' },
    { name: '!tagrecent',                           desc: 'View the most recently created tags.' },
    { name: '!tagpopular',                          desc: 'View the most frequently used tags.' },
    { name: '!tagalias <name>',                     desc: 'View aliases registered for a tag.' },
    { name: '!tagraw <name>',                       desc: 'View the raw source content of a tag.' },
    // ── Reminders ─────────────────────────────────────────────────────────────
    { name: '!remind <time> <message>',             desc: 'Set a personal reminder (e.g. 1h, 30m, 2d).' },
    { name: '!reminders',                           desc: 'View all your active reminders.' },
    { name: '!clearremind <id>',                    desc: 'Cancel a specific reminder by its ID.' },
    { name: '!snooze <id> <time>',                  desc: 'Snooze a reminder by a set amount of time.' },
    { name: '!clearallreminders',                   desc: 'Cancel all of your active reminders at once.' },
    // ── Handbook & Guides ─────────────────────────────────────────────────────
    { name: '!handbook',                            desc: 'View the official staff and member handbook.' },
    { name: '!rules',                               desc: 'View the server rules.' },
    { name: '!guidelines',                          desc: 'View the server community guidelines.' },
    { name: '!faq',                                 desc: 'View frequently asked questions.' },
    { name: '!sop',                                 desc: 'View standard operating procedures.' },
    { name: '!guide <topic>',                       desc: 'View a guide on a specific topic.' },
    { name: '!guides',                              desc: 'List all available guides and tutorials.' },
    { name: '!tutorial',                            desc: 'Interactive bot tutorial for new members.' },
    // ── Modmail & Tickets ─────────────────────────────────────────────────────
    { name: '!modmail <message>',                   desc: 'Send a message to staff via modmail.' },
    { name: '!mymodmail',                           desc: 'View your open modmail thread.' },
    { name: '!closemodmail',                        desc: 'Close your own modmail thread.' },
    { name: '!modmailstatus',                       desc: 'Check if the modmail system is currently open.' },
    { name: '!report',                              desc: 'Open a player report ticket.' },
    { name: '!appeal',                              desc: 'Open a ban appeal ticket.' },
    // ── Birthdays ─────────────────────────────────────────────────────────────
    { name: '!setbirthday <month/day>',             desc: 'Set your birthday for the server.' },
    { name: '!birthday [@user]',                    desc: 'View a member\'s birthday.' },
    { name: '!birthdaylist',                        desc: 'View upcoming birthdays in the server.' },
    { name: '!birthdaytoday',                       desc: 'Show members with birthdays today.' },
    { name: '!clearbirthday',                       desc: 'Remove your birthday from the server.' },
    // ── Countdowns ────────────────────────────────────────────────────────────
    { name: '!countdown <event>',                   desc: 'Show a countdown to a scheduled event.' },
    { name: '!countdowns',                          desc: 'List all active server countdowns.' },
    { name: '!nextreset',                           desc: 'Countdown to the weekly quota/activity reset.' },
    { name: '!timer <seconds>',                     desc: 'Start a countdown timer in the channel.' },
    { name: '!stopwatch',                           desc: 'Start or stop a personal stopwatch.' },
    // ── Miscellaneous ─────────────────────────────────────────────────────────
    { name: '!news',                                desc: 'View the latest server news and announcements.' },
    { name: '!announcements',                       desc: 'View recent server announcements.' },
    { name: '!updates',                             desc: 'View recent bot updates and new features.' },
    { name: '!links',                               desc: 'View all saved useful server links.' },
    { name: '!status',                              desc: 'View the current server and bot status.' },
    { name: '!leaderboard',                         desc: 'Show the top 15 most active members by score.' },
    { name: '!unafk',                               desc: 'Remove your AFK status.' },
    { name: '!afklist',                             desc: 'View members currently marked as AFK.' },
    { name: '!feedback',                            desc: 'Submit feedback about the server or bot.' },
    { name: '!changelog',                           desc: 'View the latest bot update changelog.' },
];

const STAFF_CMDS = [
    // ── Setup & Configuration ─────────────────────────────────────────────────
    { name: '!setupmod',                                  desc: 'Configure moderator, HR, and management roles + Roblox Group ID. Admin only.' },
    { name: '!setuplogs',                                 desc: 'Configure log channels for moderation, promotions, appeals, training, feedback, and LOA. Admin only.' },
    { name: '!setupranks',                                desc: 'Map Roblox rank IDs to Discord roles. Admin only.' },
    { name: '!setupdepartments',                          desc: 'Configure department role assignments. Admin only.' },
    { name: '!setuproles',                                desc: 'Configure HR and management roles. Admin only.' },
    { name: '!reportsetup',                               desc: 'Set up the player report ticket system. Requires Manage Server.' },
    { name: '!appealsetup',                               desc: 'Set up the ban appeal ticket system. Requires Manage Server.' },
    { name: '!verifysetup',                               desc: 'Run the 5-step Roblox verification setup wizard. Requires Manage Server.' },
    { name: '!loasetup',                                  desc: 'Post the Leave of Absence request panel. HR or Admin only.' },
    { name: '!promotionsetup',                            desc: 'Post the promotion request panel. Admin only.' },
    { name: '!demotionsetup',                             desc: 'Post the demotion recommendation panel. Admin only.' },
    { name: '!feedbacksetup',                             desc: 'Post the staff feedback panel (positive, concern, general). Admin only.' },
    { name: '!trainingsetup',                             desc: 'Configure training session settings and channels. Admin only.' },
    { name: '!activitysetup',                             desc: 'Configure activity tracking thresholds and channels. Admin only.' },
    { name: '!deptsetup',                                 desc: 'Set up department channels, roles, and categories. Admin only.' },
    { name: '!modmailsetup',                              desc: 'Configure the modmail system channel and format. Admin only.' },
    { name: '!automodsetup',                              desc: 'Configure the automatic moderation system. Admin only.' },
    { name: '!welcomesetup',                              desc: 'Set up welcome and leave messages for new members. Admin only.' },
    // ── Moderation Actions ────────────────────────────────────────────────────
    { name: '!warn @user <reason>',                       desc: 'Issue a formal warning. Creates a numbered case record.' },
    { name: '!strike @user <reason>',                     desc: 'Issue a strike. Auto-escalates at 2 (suspend), 3 (demote), 5 (termination).' },
    { name: '!removestrike @user <reason>',               desc: 'Remove one active strike from a staff member.' },
    { name: '!suspend @user <duration> <reason>',         desc: 'Suspend a staff member. Durations: 1d 3d 7d 14d perm. Auto-expires.' },
    { name: '!endsuspension @user',                       desc: 'Manually end a member\'s suspension early.' },
    { name: '!extendsuspension @user <duration>',         desc: 'Extend the duration of an active suspension.' },
    { name: '!demote @user <reason>',                     desc: 'Demote a staff member. Logged to case system and promotion log.' },
    { name: '!terminate @user <reason>',                  desc: 'Terminate a staff member. HR role required.' },
    { name: '!ban @user <reason>',                        desc: 'Ban a staff member from the server. HR role required.' },
    { name: '!unban <userId> <reason>',                   desc: 'Unban a user by Discord ID. HR role required.' },
    { name: '!softban @user <reason>',                    desc: 'Ban and immediately unban to purge messages without a permanent ban.' },
    { name: '!hackban <userId> <reason>',                 desc: 'Ban a user who is not currently in the server.' },
    { name: '!kick @user <reason>',                       desc: 'Kick a member from the server.' },
    { name: '!mute @user <duration> <reason>',            desc: 'Mute a member for a set duration.' },
    { name: '!unmute @user <reason>',                     desc: 'Remove a mute from a member.' },
    { name: '!timeout @user <duration> <reason>',         desc: 'Apply a Discord timeout to a member.' },
    { name: '!removetimeout @user',                       desc: 'Remove a Discord timeout from a member early.' },
    { name: '!note @user <text>',                         desc: 'Add a staff note to a member\'s record.' },
    { name: '!removenote @user <id>',                     desc: 'Remove a specific note from a member\'s record.' },
    { name: '!clearnotes @user',                          desc: 'Clear all notes from a member\'s record.' },
    { name: '!massban <reason>',                          desc: 'Mass ban multiple users at once. Admin only.' },
    { name: '!massunban <reason>',                        desc: 'Mass unban a list of users. Admin only.' },
    { name: '!masskick <reason>',                         desc: 'Mass kick multiple members. Admin only.' },
    { name: '!slowmode [#channel] <seconds>',             desc: 'Set slowmode for a channel (0 to disable).' },
    { name: '!lockdown',                                  desc: 'Lock all public channels instantly (raid mode). Admin only.' },
    { name: '!unlock',                                    desc: 'Unlock all channels after a lockdown. Admin only.' },
    // ── Case Management ───────────────────────────────────────────────────────
    { name: '!caseinfo <case-id>',                        desc: 'View full details of a case by its ID.' },
    { name: '!caselist [@user]',                          desc: 'List all cases for a member.' },
    { name: '!caseedit <case-id> <field> <value>',        desc: 'Edit a field on an existing case.' },
    { name: '!caseclose <case-id> <reason>',              desc: 'Mark a case as resolved.' },
    { name: '!casedelete <case-id>',                      desc: 'Permanently delete a case. Admin only.' },
    { name: '!casenote <case-id> <note>',                 desc: 'Add a note to an existing case.' },
    { name: '!caseexport [@user]',                        desc: 'Export cases to a text file.' },
    { name: '!casesearch <query>',                        desc: 'Search cases by reason or username.' },
    { name: '!casecount [@user]',                         desc: 'Count total cases for a user or server.' },
    { name: '!casetypes',                                 desc: 'Show a breakdown of all cases by type.' },
    { name: '!recentcases',                               desc: 'View the 10 most recently created cases.' },
    { name: '!casehistory @user',                         desc: 'View the full case timeline for a member.' },
    { name: '!caselookup <case-id>',                      desc: 'Quick case lookup by ID.' },
    { name: '!caseaudit',                                 desc: 'View the case audit log.' },
    // ── Staff Records ─────────────────────────────────────────────────────────
    { name: '!staffprofile [@user]',                      desc: 'Display a full staff profile: cases, strikes, LOA, trainings, activity score.' },
    { name: '!editprofile @user <field> <value>',         desc: 'Edit a staff record field. Admin only.' },
    { name: '!staffnotes @user',                          desc: 'View all staff notes for a member.' },
    { name: '!flagstaff @user <reason>',                  desc: 'Flag a staff member for HR review.' },
    { name: '!unflagstaff @user',                         desc: 'Remove a flag from a staff member.' },
    { name: '!flaggedstaff',                              desc: 'List all currently flagged staff members.' },
    { name: '!staffstatus @user',                         desc: 'Quick status check (suspended, on LOA, flagged, etc.).' },
    { name: '!staffsearch <query>',                       desc: 'Search the staff directory by name or rank.' },
    { name: '!stafflist',                                 desc: 'View all tracked staff members.' },
    { name: '!staffdirectory',                            desc: 'Paginated full staff directory.' },
    { name: '!staffaudit',                                desc: 'View staff record change history.' },
    { name: '!staffexport',                               desc: 'Export the full staff directory to a file.' },
    { name: '!staffcount',                                desc: 'Show total staff count by rank.' },
    { name: '!staffonline',                               desc: 'Show which staff members are currently online.' },
    { name: '!staffabsent',                               desc: 'Show staff members who have not been active recently.' },
    // ── LOA Management ────────────────────────────────────────────────────────
    { name: '!loaapprove @user',                          desc: 'Approve a pending LOA request.' },
    { name: '!loadeny @user <reason>',                    desc: 'Deny a pending LOA request.' },
    { name: '!loaend @user',                              desc: 'Manually end a member\'s active LOA.' },
    { name: '!loaend',                                    desc: 'Manually end your own active LOA.' },
    { name: '!loaextend @user <duration>',                desc: 'Extend an active LOA by a set duration.' },
    { name: '!loareview',                                 desc: 'View all pending LOA requests.' },
    { name: '!loalist',                                   desc: 'View all currently active LOAs.' },
    { name: '!loahistory [@user]',                        desc: 'View LOA history for a specific user.' },
    { name: '!loastats',                                  desc: 'LOA statistics and trends.' },
    { name: '!loanotify @user',                           desc: 'Send a reminder ping to a member on LOA.' },
    { name: '!loacheck @user',                            desc: 'Check if a specific member is currently on LOA.' },
    { name: '!loamanage',                                 desc: 'Open the LOA management panel with all pending requests.' },
    { name: '!loaarchive',                                desc: 'View archived and expired LOA records.' },
    { name: '!loaexport',                                 desc: 'Export all LOA records to a file.' },
    { name: '!loasetlimit <days>',                        desc: 'Set the maximum allowed LOA duration. Admin only.' },
    // ── Promotions & Demotions ────────────────────────────────────────────────
    { name: '!promote @user <reason>',                    desc: 'Manually log a promotion. HR role required.' },
    { name: '!checkpromotion [@user]',                    desc: 'Check if a staff member meets promotion eligibility.' },
    { name: '!approvepromote <request-id>',               desc: 'Approve a pending promotion request.' },
    { name: '!denypromote <request-id> <reason>',         desc: 'Deny a promotion request with a reason.' },
    { name: '!promotionlist',                             desc: 'View all pending promotion requests.' },
    { name: '!promotionhistory [@user]',                  desc: 'View promotion and demotion history for a user.' },
    { name: '!promotionrequirements',                     desc: 'View promotion requirements for each rank.' },
    { name: '!setpromotionreq <rank> <req>',              desc: 'Set promotion requirements for a rank. Admin only.' },
    { name: '!promotionreview',                           desc: 'View promotion requests that need review.' },
    { name: '!promotionannounce @user <rank>',            desc: 'Formally announce a promotion in the log channel.' },
    { name: '!promotionlog',                              desc: 'View recent promotions and demotions.' },
    { name: '!promotionreset @user',                      desc: 'Reset a member\'s promotion tracking data. Admin only.' },
    { name: '!promotionfreeze @user',                     desc: 'Freeze a member\'s promotions temporarily.' },
    { name: '!promotionunfreeze @user',                   desc: 'Unfreeze a member\'s promotions.' },
    { name: '!promotionaudit',                            desc: 'View the full promotion audit log.' },
    // ── Training Management ───────────────────────────────────────────────────
    { name: '!trainingcreate <name>|<desc>',              desc: 'Create a new training session with a name and description.' },
    { name: '!traininghost <TRAIN-XXXX>',                 desc: 'Start hosting a training session. Posts a join button.' },
    { name: '!trainingcomplete <id> <pass|fail> @users',  desc: 'Log training results and update staff records.' },
    { name: '!traininglist',                              desc: 'List all training sessions and their status.' },
    { name: '!trainingdelete <id>',                       desc: 'Delete a training session. Admin only.' },
    { name: '!trainingresults <id>',                      desc: 'View full results from a completed training session.' },
    { name: '!trainingattendance <id>',                   desc: 'View the attendance list for a training session.' },
    { name: '!trainingschedule',                          desc: 'View all upcoming scheduled training sessions.' },
    { name: '!trainingannounce <id>',                     desc: 'Announce an upcoming training to the server.' },
    { name: '!trainingarchive <id>',                      desc: 'Archive a completed training session.' },
    { name: '!trainingexport <id>',                       desc: 'Export training session data to a file.' },
    { name: '!trainingnotify <id>',                       desc: 'Send reminder pings for an upcoming training.' },
    { name: '!trainingcancel <id> <reason>',              desc: 'Cancel a training session with a reason.' },
    { name: '!trainingreschedule <id> <time>',            desc: 'Reschedule a training session to a new time.' },
    { name: '!trainingteam',                              desc: 'View and manage the training team roster.' },
    { name: '!trainingquota',                             desc: 'View or set training host quota requirements.' },
    { name: '!traininghistory [@user]',                   desc: 'View a user\'s full history as a training host.' },
    { name: '!trainingpass @user <id>',                   desc: 'Manually mark a member as passed in a training.' },
    // ── Feedback Management ───────────────────────────────────────────────────
    { name: '!feedbacklist',                              desc: 'View all submitted staff feedback entries.' },
    { name: '!feedbackreview <id>',                       desc: 'Review a specific feedback submission.' },
    { name: '!feedbackapprove <id>',                      desc: 'Approve and acknowledge a feedback entry.' },
    { name: '!feedbackdeny <id> <reason>',                desc: 'Deny a feedback submission with a reason.' },
    { name: '!feedbackarchive <id>',                      desc: 'Archive a resolved feedback entry.' },
    { name: '!feedbackreport <id>',                       desc: 'Flag a feedback entry for escalation.' },
    { name: '!feedbackstats',                             desc: 'View feedback submission statistics.' },
    { name: '!feedbackexport',                            desc: 'Export all feedback to a file.' },
    { name: '!feedbackcategory <type>',                   desc: 'View feedback filtered by category (positive/concern/general).' },
    { name: '!feedbackrecent',                            desc: 'View the 10 most recently submitted feedback entries.' },
    // ── Activity Tracking ─────────────────────────────────────────────────────
    { name: '!activity [@user]',                          desc: 'View a staff member\'s activity statistics and score.' },
    { name: '!leaderboard',                               desc: 'Show the top 15 most active staff members by score.' },
    { name: '!addscore @user <points>',                   desc: 'Manually add activity score points to a member. Admin only.' },
    { name: '!removescore @user <points>',                desc: 'Manually remove activity score points from a member. Admin only.' },
    { name: '!resetactivity @user',                       desc: 'Reset a member\'s activity tracking data. Admin only.' },
    { name: '!setactivity @user <count>',                 desc: 'Manually override a member\'s message count. Admin only.' },
    { name: '!activityreport',                            desc: 'Generate a full activity report for all staff.' },
    { name: '!activityexport',                            desc: 'Export activity data to a downloadable file.' },
    { name: '!activityrequirements',                      desc: 'View the activity requirements per rank.' },
    { name: '!checkquota @user',                          desc: 'Check whether a member is meeting their activity quota.' },
    { name: '!quotalist',                                 desc: 'List all staff members who are not meeting quota.' },
    { name: '!setquota <rank> <amount>',                  desc: 'Set the quota requirement for a specific rank. Admin only.' },
    { name: '!activitylog [@user]',                       desc: 'View the activity log entries for a member.' },
    { name: '!weeklyreport',                              desc: 'Generate a weekly activity and moderation report.' },
    { name: '!monthlyreport',                             desc: 'Generate a monthly activity and moderation report.' },
    // ── Departments ───────────────────────────────────────────────────────────
    { name: '!departments',                               desc: 'Show an overview of all departments with member count and performance.' },
    { name: '!department <name>',                         desc: 'Show the full dashboard for a specific department.' },
    { name: '!deptadd <dept> @user',                      desc: 'Add a staff member to a department. HR or Admin.' },
    { name: '!deptremove <dept> @user',                   desc: 'Remove a staff member from a department. HR or Admin.' },
    { name: '!deptperformance <dept> <0-100>',            desc: 'Set a department\'s performance score. HR or Admin.' },
    { name: '!deptlead <dept>',                           desc: 'View who leads a specific department.' },
    { name: '!deptsetlead <dept> @user',                  desc: 'Set the lead for a department. Admin only.' },
    { name: '!deptannounce <dept> <message>',             desc: 'Send an announcement to all department members.' },
    { name: '!deptlog <dept>',                            desc: 'View the activity log for a department.' },
    { name: '!deptnotes <dept>',                          desc: 'View internal notes for a department.' },
    { name: '!deptaddnote <dept> <note>',                 desc: 'Add a note to a department\'s record.' },
    { name: '!deptmembers <dept>',                        desc: 'View all members in a specific department.' },
    { name: '!deptinvite <dept> @user',                   desc: 'Invite a member to a department.' },
    { name: '!deptremoveall <dept>',                      desc: 'Remove all members from a department at once. Admin only.' },
    { name: '!deptcreate <name>',                         desc: 'Create a new department. Admin only.' },
    { name: '!deptdelete <name>',                         desc: 'Delete a department permanently. Admin only.' },
    { name: '!deptrename <dept> <new-name>',              desc: 'Rename a department. Admin only.' },
    { name: '!deptcolor <dept> <hex>',                    desc: 'Set a department\'s embed color. Admin only.' },
    { name: '!deptdesc <dept> <desc>',                    desc: 'Set a department\'s description. Admin only.' },
    { name: '!deptquota <dept> <amount>',                 desc: 'Set an activity quota for a department. Admin only.' },
    // ── Analytics & Reporting ─────────────────────────────────────────────────
    { name: '!dashboard',                                 desc: 'Full real-time overview of all staff management stats.' },
    { name: '!stats',                                     desc: 'Detailed moderation statistics: cases by type, top mods, monthly trends.' },
    { name: '!statsexport',                               desc: 'Export all stats to a downloadable file.' },
    { name: '!analyticsreport',                           desc: 'Generate a full analytics report for the server.' },
    { name: '!casetypebreakdown',                         desc: 'Cases broken down by type (warn/strike/ban/etc.).' },
    { name: '!modstats [@user]',                          desc: 'View moderation stats for a specific moderator.' },
    { name: '!topmod',                                    desc: 'Most active moderators this month.' },
    { name: '!mostreported',                              desc: 'Members who have the most cases filed against them.' },
    { name: '!casetrends',                                desc: 'View case frequency trends over time.' },
    { name: '!weeklytrends',                              desc: 'Weekly activity and moderation trends.' },
    { name: '!monthlytrends',                             desc: 'Monthly moderation and LOA trends.' },
    { name: '!staffperformance',                          desc: 'Performance report for all staff members.' },
    { name: '!deptanalytics',                             desc: 'Department-level performance analytics.' },
    { name: '!traininganalytics',                         desc: 'Training session volume and pass-rate analytics.' },
    { name: '!loaanalytics',                              desc: 'Leave of absence frequency and duration analytics.' },
    // ── Roles Management ──────────────────────────────────────────────────────
    { name: '!giverole @user @role',                      desc: 'Give a role to a member.' },
    { name: '!removerole @user @role',                    desc: 'Remove a role from a member.' },
    { name: '!massgive @role @users',                     desc: 'Give a role to multiple members at once.' },
    { name: '!massremove @role @users',                   desc: 'Remove a role from multiple members at once.' },
    { name: '!temprole @user @role <duration>',           desc: 'Give a temporary role that auto-expires.' },
    { name: '!expirerole @user @role',                    desc: 'Immediately expire a temporary role.' },
    { name: '!listroles',                                 desc: 'List all server roles with member counts.' },
    { name: '!whohas @role',                              desc: 'Show all members who have a specific role.' },
    { name: '!inrole @role',                              desc: 'Count the total members in a role.' },
    { name: '!rolecolor @role <hex>',                     desc: 'Change a role\'s color. Admin only.' },
    { name: '!rolename @role <name>',                     desc: 'Rename a role. Admin only.' },
    { name: '!rolepermissions @role',                     desc: 'View all permissions assigned to a role.' },
    // ── Channel Management ────────────────────────────────────────────────────
    { name: '!createchannel <name> [category]',           desc: 'Create a new channel in an optional category. Admin only.' },
    { name: '!deletechannel [#channel]',                  desc: 'Delete a channel. Admin only.' },
    { name: '!lockchannel [#channel] <reason>',           desc: 'Lock a channel to stop members from sending messages.' },
    { name: '!unlockchannel [#channel]',                  desc: 'Unlock a channel.' },
    { name: '!renamechannel [#channel] <name>',           desc: 'Rename a channel. Admin only.' },
    { name: '!archivechannel [#channel]',                 desc: 'Archive a channel by moving it to an archive category.' },
    { name: '!clonechannel [#channel]',                   desc: 'Clone a channel with the same settings.' },
    { name: '!movechannel [#channel] <category>',         desc: 'Move a channel to a different category.' },
    { name: '!channelperms [#channel]',                   desc: 'View permission overwrites for a channel.' },
    { name: '!nsfw [#channel] <on|off>',                  desc: 'Toggle NSFW flag on a channel. Admin only.' },
    // ── Announcements & Comms ─────────────────────────────────────────────────
    { name: '!announce <#channel> <message>',             desc: 'Send an announcement embed to any channel.' },
    { name: '!dm @user <message>',                        desc: 'Direct message a member as the bot. Admin only.' },
    { name: '!bulkdm @role <message>',                    desc: 'DM all members with a specific role. Admin only.' },
    { name: '!embed <#channel> <json>',                   desc: 'Send a fully custom embed to a channel.' },
    { name: '!pin <message-id>',                          desc: 'Pin a message in the current channel.' },
    { name: '!unpin <message-id>',                        desc: 'Unpin a pinned message.' },
    { name: '!purge <amount>',                            desc: 'Bulk delete up to 100 messages.' },
    { name: '!say <#channel> <message>',                  desc: 'Send a plain message as the bot.' },
    { name: '!staffannounce <message>',                   desc: 'Send a staff-only announcement to the staff channel.' },
    { name: '!editannouncement <msg-id> <text>',          desc: 'Edit an existing bot announcement message.' },
    // ── Tickets Management ────────────────────────────────────────────────────
    { name: '!ticketlist',                                desc: 'View all currently open tickets.' },
    { name: '!ticketclose <id> <reason>',                 desc: 'Close a ticket with a reason.' },
    { name: '!ticketarchive <id>',                        desc: 'Archive a closed ticket for record-keeping.' },
    { name: '!ticketclaim <id>',                          desc: 'Claim a ticket as your own to handle.' },
    { name: '!tickettransfer <id> @user',                 desc: 'Transfer a ticket to another staff member.' },
    { name: '!ticketadduser <id> @user',                  desc: 'Add a user to a ticket thread.' },
    { name: '!ticketremoveuser <id> @user',               desc: 'Remove a user from a ticket thread.' },
    { name: '!ticketlog <id>',                            desc: 'View the full transcript log of a ticket.' },
    { name: '!ticketstats',                               desc: 'View ticket volume and resolution statistics.' },
    { name: '!ticketblacklist @user',                     desc: 'Blacklist a user from opening tickets.' },
    // ── Appeals & Reports ─────────────────────────────────────────────────────
    { name: '!appeallist',                                desc: 'View all open ban/moderation appeals.' },
    { name: '!appealclose <id> <reason>',                 desc: 'Close an appeal with a reason.' },
    { name: '!appealapprove <id> <reason>',               desc: 'Approve an appeal and reverse the punishment.' },
    { name: '!appealdeny <id> <reason>',                  desc: 'Deny an appeal with a reason.' },
    { name: '!appealreview <id>',                         desc: 'Mark an appeal as currently under review.' },
    { name: '!appealnote <id> <note>',                    desc: 'Add an internal note to an appeal thread.' },
    { name: '!appealstats',                               desc: 'View appeal approval/denial statistics.' },
    { name: '!reportlist',                                desc: 'View all open player reports.' },
    { name: '!reportclaim <id>',                          desc: 'Claim a player report to investigate.' },
    { name: '!reportclose <id> <reason>',                 desc: 'Close a player report with a resolution.' },
    // ── Verification Management ───────────────────────────────────────────────
    { name: '!verifymember @user',                        desc: 'Manually verify a member\'s Roblox account.' },
    { name: '!unverify @user',                            desc: 'Manually unverify a member.' },
    { name: '!verifylist',                                desc: 'View all verified members in this server.' },
    { name: '!verifyexport',                              desc: 'Export the full verified members list.' },
    { name: '!verifycheck @user',                         desc: 'Check a member\'s verification status.' },
    { name: '!verifymanual @user <roblox-name>',          desc: 'Manually link a specific Roblox account to a member.' },
    { name: '!verifyblacklist @user',                     desc: 'Blacklist a member from using the verify system.' },
    { name: '!verifywhitelist @user',                     desc: 'Whitelist a member to bypass verification requirements.' },
    { name: '!verifystats',                               desc: 'View verification statistics.' },
    { name: '!verifyaudit',                               desc: 'View the verification audit log.' },
    // ── Roblox Group Management ───────────────────────────────────────────────
    { name: '!groupsync',                                 desc: 'Sync Discord roles with Roblox group ranks.' },
    { name: '!grouprank @user <rank>',                    desc: 'Set a member\'s Roblox group rank.' },
    { name: '!groupexile @user <reason>',                 desc: 'Exile a member from the Roblox group.' },
    { name: '!groupshout <message>',                      desc: 'Post a shout to the Roblox group wall.' },
    { name: '!groupwall',                                 desc: 'View recent Roblox group wall posts from Discord.' },
    { name: '!groupmembers',                              desc: 'View Roblox group member counts broken down by rank.' },
    { name: '!groupstats',                                desc: 'View group statistics and recent activity.' },
    { name: '!groupaudit',                                desc: 'View the Roblox group audit log.' },
    { name: '!grouplog',                                  desc: 'View recent rank changes in the Roblox group.' },
    { name: '!groupconfig',                               desc: 'Configure Roblox group sync settings. Admin only.' },
    // ── Points Admin ──────────────────────────────────────────────────────────
    { name: '!givepoints @user <amount> <reason>',        desc: 'Award points to a member. Logged with reason.' },
    { name: '!removepoints @user <amount> <reason>',      desc: 'Deduct points from a member. Logged with reason.' },
    { name: '!resetpoints @user',                         desc: 'Reset a member\'s points balance to zero.' },
    { name: '!setpoints @user <amount>',                  desc: 'Set a member\'s points to a specific value.' },
    { name: '!pointslog @user',                           desc: 'View a member\'s full points transaction history.' },
    { name: '!pointsexport',                              desc: 'Export all points data to a file.' },
    { name: '!pointsaudit',                               desc: 'View admin-level points change audit log.' },
    { name: '!pointsconfig',                              desc: 'Configure the points system settings. Admin only.' },
    // ── Events Admin ──────────────────────────────────────────────────────────
    { name: '!eventcreate <name>|<desc>|<time>',          desc: 'Create a new server event.' },
    { name: '!eventdelete <id>',                          desc: 'Delete an event permanently. Admin only.' },
    { name: '!eventlist',                                 desc: 'View all events (past and upcoming) with status.' },
    { name: '!eventedit <id> <field> <value>',            desc: 'Edit an event\'s details.' },
    { name: '!eventannounce <id>',                        desc: 'Announce an event to the server.' },
    { name: '!eventclose <id>',                           desc: 'Mark an event as completed.' },
    { name: '!eventarchive <id>',                         desc: 'Archive an old event.' },
    { name: '!eventattendance <id>',                      desc: 'View and export the attendance list for an event.' },
    { name: '!eventresults <id>',                         desc: 'Log and publish results from a completed event.' },
    { name: '!eventrsvp <id>',                            desc: 'View the RSVP list for an event.' },
    { name: '!eventremind <id>',                          desc: 'Send reminder pings to all RSVPed members.' },
    // ── Automoderation ────────────────────────────────────────────────────────
    { name: '!automodstatus',                             desc: 'View the current automod configuration.' },
    { name: '!automodtest <text>',                        desc: 'Test a piece of text against the automod filters.' },
    { name: '!automodlog',                                desc: 'View recent actions taken by automod.' },
    { name: '!addfilter <type> <pattern>',                desc: 'Add a word or pattern to the automod filter.' },
    { name: '!removefilter <id>',                         desc: 'Remove a filter entry by its ID.' },
    { name: '!filterlist',                                desc: 'View all active automod filters.' },
    { name: '!addexempt @role',                           desc: 'Exempt a role from all automod checks.' },
    { name: '!removeexempt @role',                        desc: 'Remove a role\'s automod exemption.' },
    { name: '!exemptlist',                                desc: 'View all roles that are exempt from automod.' },
    { name: '!antispamconfig <threshold>',                desc: 'Configure the anti-spam message threshold.' },
    { name: '!anticapsconfig <percent>',                  desc: 'Configure the anti-caps percentage threshold.' },
    { name: '!antiinviteconfig <on|off>',                 desc: 'Toggle invite link blocking via automod.' },
    // ── Giveaway Admin ────────────────────────────────────────────────────────
    { name: '!gcreate <prize>|<duration>|<winners>',      desc: 'Create a giveaway with prize, duration, and winner count.' },
    { name: '!gend <id>',                                 desc: 'End a giveaway early and select winner(s).' },
    { name: '!greroll <id>',                              desc: 'Reroll a giveaway to pick a new winner.' },
    { name: '!glist',                                     desc: 'View all active giveaways.' },
    { name: '!gdelete <id>',                              desc: 'Delete a giveaway permanently.' },
    { name: '!gstart <id>',                               desc: 'Start a pre-configured scheduled giveaway.' },
    { name: '!greq <id> <requirement>',                   desc: 'Set entry requirements for a giveaway.' },
    { name: '!gannounce <id>',                            desc: 'Announce a giveaway to the server.' },
    { name: '!gstats',                                    desc: 'View giveaway participation and win statistics.' },
    { name: '!gexport <id>',                              desc: 'Export the entry list for a giveaway.' },
    // ── Tag Admin ─────────────────────────────────────────────────────────────
    { name: '!tagcreate <name> <content>',                desc: 'Create a new server tag.' },
    { name: '!tagdelete <name>',                          desc: 'Delete a tag permanently.' },
    { name: '!tagedit <name> <new-content>',              desc: 'Edit the content of an existing tag.' },
    { name: '!taginfo <name>',                            desc: 'View tag details, author, and usage count.' },
    { name: '!tagtransfer <name> @user',                  desc: 'Transfer ownership of a tag to another member.' },
    { name: '!taglock <name>',                            desc: 'Lock a tag so only admins can edit it.' },
    { name: '!tagunlock <name>',                          desc: 'Unlock a tag for editing.' },
    { name: '!tagstats',                                  desc: 'View tag usage statistics across the server.' },
    // ── Modmail Admin ─────────────────────────────────────────────────────────
    { name: '!modmailopen @user',                         desc: 'Open a modmail thread with a specific member.' },
    { name: '!modmailclose <id> <reason>',                desc: 'Close a modmail thread.' },
    { name: '!modmailblock @user',                        desc: 'Block a member from using modmail.' },
    { name: '!modmailunblock @user',                      desc: 'Unblock a member\'s modmail access.' },
    { name: '!modmaillist',                               desc: 'View all open modmail threads.' },
    { name: '!modmaillog <id>',                           desc: 'View the full transcript of a modmail thread.' },
    { name: '!modmailstats',                              desc: 'View modmail volume and resolution statistics.' },
    { name: '!modmailblacklist',                          desc: 'View the modmail block list.' },
    // ── Warning / Strike / Ban Records ────────────────────────────────────────
    { name: '!warnlist [@user]',                          desc: 'View all warnings for a user or the whole server.' },
    { name: '!warnremove @user <id>',                     desc: 'Remove a specific warning by its ID.' },
    { name: '!warnclear @user',                           desc: 'Clear all warnings from a user\'s record. Admin only.' },
    { name: '!banlist',                                   desc: 'View all currently banned users.' },
    { name: '!baninfo <userId>',                          desc: 'View details on a specific ban entry.' },
    { name: '!strikelist [@user]',                        desc: 'List all strikes for a user.' },
    { name: '!strikereset @user',                         desc: 'Reset all strikes for a user. Admin only.' },
    { name: '!suspensionlist',                            desc: 'View all currently active suspensions.' },
    { name: '!suspensionend @user',                       desc: 'End a member\'s suspension immediately.' },
    { name: '!mutelist',                                  desc: 'View all currently muted members.' },
    // ── Server Management ─────────────────────────────────────────────────────
    { name: '!serverinfo',                                desc: 'View detailed server info as a staff embed.' },
    { name: '!serverstats',                               desc: 'View server statistics (members, channels, roles).' },
    { name: '!serveraudit',                               desc: 'View the server\'s Discord audit log entries.' },
    { name: '!invitelist',                                desc: 'View all active server invites.' },
    { name: '!invitedelete <code>',                       desc: 'Delete a specific server invite.' },
    { name: '!invitestats',                               desc: 'View invite usage and join statistics.' },
    { name: '!backupconfig',                              desc: 'Back up the server bot configuration. Admin only.' },
    { name: '!restoreconfig',                             desc: 'Restore a previous bot configuration backup. Admin only.' },
    // ── Audit & Compliance ────────────────────────────────────────────────────
    { name: '!auditlog <type>',                           desc: 'View the bot\'s internal audit log by type.' },
    { name: '!auditstaff @user',                          desc: 'View all audit log entries for a staff member.' },
    { name: '!auditmod @user',                            desc: 'View moderation audit entries for a moderator.' },
    { name: '!auditexport <type>',                        desc: 'Export an audit log to a file.' },
    { name: '!compliancereport',                          desc: 'Generate a full compliance and activity report. Admin only.' },
    { name: '!quotareport',                               desc: 'Show all staff members failing to meet quota.' },
    { name: '!inactivereport',                            desc: 'List staff members with no activity in the last 7 days.' },
    { name: '!staffhealth',                               desc: 'Overview of staff health: LOA, strikes, quota failures.' },
];

// Keep a combined list for any code that still references COMMANDS
const COMMANDS = [...MEMBER_CMDS, ...STAFF_CMDS];

// ── Ready ─────────────────────────────────────────────────────────────────────

client.once('clientReady', () => {
    console.log(`Success! Logged in as ${client.user.tag}`);
    // Run suspension expiry check every hour
    modSystem.tickSuspensions(client);
    setInterval(() => modSystem.tickSuspensions(client), 3_600_000);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function levenshtein(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    const m = [];
    for (let i = 0; i <= b.length; i++) m[i] = [i];
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            m[i][j] = b[i - 1] === a[j - 1]
                ? m[i - 1][j - 1]
                : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
        }
    }
    return m[b.length][a.length];
}

function didYouMean(query, topName) {
    const dist = levenshtein(query, topName);
    const threshold = Math.max(2, Math.floor(query.length / 3));
    if (dist > 0 && dist <= threshold) return `💡 Did you mean **${topName}**?`;
    return null;
}

async function robloxGet(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

let xsrfToken = null;
async function robloxPost(url, body) {
    const attempt = (token) => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
        body: JSON.stringify(body)
    });
    let res = await attempt(xsrfToken);
    if (res.status === 403) {
        const newToken = res.headers.get('x-csrf-token');
        if (newToken) { xsrfToken = newToken; res = await attempt(xsrfToken); }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ── Roblox API ────────────────────────────────────────────────────────────────

async function searchUsers(query) {
    const data = await robloxGet(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(query)}&limit=10`);
    return data.data || [];
}
async function getUserStats(userId) {
    const [fl, fw] = await Promise.all([
        robloxGet(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
        robloxGet(`https://friends.roblox.com/v1/users/${userId}/followings/count`)
    ]);
    return { followers: fl.count ?? 0, following: fw.count ?? 0 };
}
async function getUserGames(userId) {
    const data = await robloxGet(`https://games.roblox.com/v2/users/${userId}/games?limit=5&sortOrder=Desc`);
    return data.data || [];
}
async function searchCatalog(query, creatorName = null) {
    let url = `https://catalog.roblox.com/v1/search/items?keyword=${encodeURIComponent(query)}&limit=10&category=All`;
    if (creatorName) url += `&creatorName=${encodeURIComponent(creatorName)}`;
    const data = await robloxGet(url);
    return data.data || [];
}
async function getCatalogDetails(items) {
    if (!items.length) return [];
    const data = await robloxPost('https://catalog.roblox.com/v1/catalog/items/details', { items });
    return data.data || [];
}

// ── Embed builders ────────────────────────────────────────────────────────────

async function buildUserEmbed(user, index, total, query) {
    const embed = new EmbedBuilder()
        .setColor(0x00b4d8)
        .setTitle(`👤 ${user.displayName} (@${user.name})`)
        .setURL(`https://www.roblox.com/users/${user.id}/profile`)
        .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${user.id}&width=420&height=420&format=png`)
        .setFooter({ text: `Result ${index + 1} of ${total}  •  User  •  Roblox` });

    const correction = didYouMean(query, user.name);
    const desc = user.blurb ? user.blurb.slice(0, 350) : '_No description set._';
    embed.setDescription((correction ? `${correction}\n\n` : '') + desc);

    try {
        const stats = await getUserStats(user.id);
        embed.addFields(
            { name: '👥 Followers', value: stats.followers.toLocaleString(), inline: true },
            { name: '➡️ Following', value: stats.following.toLocaleString(), inline: true }
        );
    } catch { }

    try {
        const games = await getUserGames(user.id);
        if (games.length > 0) {
            const gameList = games.slice(0, 5)
                .map(g => `• [${g.name}](https://www.roblox.com/games/${g.rootPlace?.id ?? g.id})`)
                .join('\n');
            embed.addFields({ name: '🎮 Their Games', value: gameList });
        }
    } catch { }

    return embed;
}

function buildCatalogEmbed(item, index, total, query) {
    const price = item.price != null ? `R$${item.price.toLocaleString()}` : '🔒 Offsale';
    const rap   = item.recentAveragePrice ? `R$${item.recentAveragePrice.toLocaleString()}` : 'N/A';
    const lowestPrice = item.lowestPrice != null ? `R$${item.lowestPrice.toLocaleString()}` : 'N/A';

    const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle(`🛒 ${item.name}`)
        .setURL(`https://www.roblox.com/catalog/${item.id}`)
        .setDescription((item.description || '_No description available._').slice(0, 400))
        .addFields(
            { name: '💰 Price',        value: price,                         inline: true },
            { name: '📈 RAP',          value: rap,                           inline: true },
            { name: '📉 Lowest Price', value: lowestPrice,                   inline: true },
            { name: '🏷️ Type',         value: item.itemType ?? 'Asset',      inline: true },
            { name: '👤 Creator',      value: item.creatorName ?? 'Unknown', inline: true }
        )
        .setFooter({ text: `Result ${index + 1} of ${total}  •  Catalog  •  Roblox` });

    const correction = didYouMean(query, item.name);
    if (correction) embed.setDescription(`${correction}\n\n${embed.data.description}`);
    if (item.id) embed.setThumbnail(`https://www.roblox.com/asset-thumbnail/image?assetId=${item.id}&width=420&height=420&format=png`);

    return embed;
}

async function buildEmbed(result, index, total, query) {
    if (result.type === 'user')    return buildUserEmbed(result.data, index, total, query);
    if (result.type === 'catalog') return buildCatalogEmbed(result.data, index, total, query);
}

function buildFindButtons(page, total) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('find_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('find_info').setLabel(`${page + 1} / ${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId('find_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === total - 1)
    );
}

// ── Verify Setup — interaction handler ───────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
    // ── Route to staff management systems ────────────────────────────────────
    const cid = interaction.customId || '';
    if (cid.startsWith('mod_'))  return modSystem.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('cfg_'))  return cfgSystem.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('sp_'))   return profileSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('loa_') || cid === 'loa_create' || cid === 'loa_modal')
                                 return loaSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('promo_') || cid === 'promo_request' || cid === 'promo_modal' ||
        cid === 'promo_demotion' || cid === 'promo_demotion_modal')
                                 return promoSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('train_'))return trainSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('fb_'))   return feedbackSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('act_'))  return activitySys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('dept_')) return deptSys.handleInteraction(interaction).catch(console.error);
    if (cid.startsWith('dash_')) return analyticsSys.handleInteraction(interaction).catch(console.error);
    if (!interaction.guild) return;
    const gid = interaction.guild.id;

    try {

        // ══════════════════════════════════════════════════════════════════════
        // SECTION A — VERIFY SETUP  (vs_* custom IDs)
        // ══════════════════════════════════════════════════════════════════════
        const isVerifyInteraction =
            (interaction.isStringSelectMenu() && (interaction.customId === `vs_q1_${gid}` || interaction.customId === `vs_q3_${gid}`)) ||
            (interaction.isRoleSelectMenu()   && (interaction.customId === `vs_q4a_${gid}` || interaction.customId === `vs_q4b_${gid}`)) ||
            (interaction.isButton()           &&  interaction.customId === `vs_next_${gid}`) ||
            (interaction.isModalSubmit()      && (interaction.customId === `vs_gpmodal_${gid}` || interaction.customId === `vs_q2modal_${gid}`));

        if (isVerifyInteraction) {
            const state = verifySetupState.get(gid);
            if (!state) return;
            if (interaction.user.id !== state.authorId) {
                return interaction.reply({ content: '❌ Only the person who started setup can interact with this.', ephemeral: true });
            }
        // ── Q1: Choose verification method ────────────────────────────────────
        if (interaction.isStringSelectMenu() && interaction.customId === `vs_q1_${gid}`) {
            state.method = interaction.values[0];

            if (state.method === 'gamepass') {
                await interaction.showModal(
                    new ModalBuilder()
                        .setCustomId(`vs_gpmodal_${gid}`)
                        .setTitle('Gamepass ID')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('gamepass_id')
                                    .setLabel('Enter your Roblox Gamepass ID')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('e.g. 123456789')
                                    .setMinLength(1).setMaxLength(20)
                                    .setRequired(true)
                            )
                        )
                );
            } else {
                // Bio — go straight to step 1 complete + Next button
                await interaction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x57f287)
                            .setTitle('✅ Step 1 Complete — Bio Verification')
                            .setDescription(
                                'Members will receive a **unique code** to paste into their Roblox profile bio.\n' +
                                'RoUtil will check the bio automatically when they run the verify command.\n\n' +
                                'Click **Next** to customise what the verification message looks like.'
                            )
                            .setFooter({ text: 'Step 1 of 5 complete' })
                    ],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`vs_next_${gid}`)
                                .setLabel('Next: Customise Message →')
                                .setStyle(ButtonStyle.Primary)
                        )
                    ]
                });
            }
        }

        // ── Gamepass modal submit ─────────────────────────────────────────────
        if (interaction.isModalSubmit() && interaction.customId === `vs_gpmodal_${gid}`) {
            state.gamepasId = interaction.fields.getTextInputValue('gamepass_id').trim();

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57f287)
                        .setTitle('✅ Step 1 Complete — Gamepass Verification')
                        .setDescription(
                            `Gamepass ID \`${state.gamepasId}\` saved.\n\n` +
                            'Members must own the **"RoUtil"** gamepass in your game to verify their account.\n\n' +
                            'Click **Next** to customise what the verification message looks like.'
                        )
                        .setFooter({ text: 'Step 1 of 5 complete' })
                ],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`vs_next_${gid}`)
                            .setLabel('Next: Customise Message →')
                            .setStyle(ButtonStyle.Primary)
                    )
                ]
            });
        }

        // ── Next button → open Q2 modal ───────────────────────────────────────
        if (interaction.isButton() && interaction.customId === `vs_next_${gid}`) {
            await interaction.showModal(
                new ModalBuilder()
                    .setCustomId(`vs_q2modal_${gid}`)
                    .setTitle('Step 2 — Verification Message')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('msg_title')
                                .setLabel('Title')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('e.g. Verify your Roblox Account')
                                .setMaxLength(256).setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('msg_description')
                                .setLabel('Description')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('Explain how members should verify...')
                                .setMaxLength(2000).setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('msg_thumbnail')
                                .setLabel('Thumbnail Image URL (optional)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('https://example.com/image.png')
                                .setRequired(false)
                        )
                    )
            );
        }

        // ── Q2 modal submit → show Q3 ─────────────────────────────────────────
        if (interaction.isModalSubmit() && interaction.customId === `vs_q2modal_${gid}`) {
            state.title       = interaction.fields.getTextInputValue('msg_title').trim();
            state.description = interaction.fields.getTextInputValue('msg_description').trim();
            state.thumbnail   = interaction.fields.getTextInputValue('msg_thumbnail').trim() || null;

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('📋 Step 3 of 3 — Message Style')
                        .setDescription(
                            'Should the verification message be sent as a **rich embed** or **plain text**?\n\n' +
                            '> 🎨 **Embed** — A colourful card showing your title, description, and thumbnail image.\n\n' +
                            '> 📝 **Simple Text** — A plain text message with no extra formatting.'
                        )
                        .addFields(
                            { name: '📌 Your Title',       value: state.title,                                                     inline: false },
                            { name: '📄 Your Description', value: state.description.slice(0, 200) + (state.description.length > 200 ? '…' : ''), inline: false },
                            ...(state.thumbnail ? [{ name: '🖼️ Thumbnail', value: state.thumbnail, inline: false }] : [])
                        )
                        .setFooter({ text: 'Step 3 of 5 • Halfway there!' })
                ],
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`vs_q3_${gid}`)
                            .setPlaceholder('Choose a message style...')
                            .addOptions(
                                { label: 'Embed', description: 'Rich card with title, description, and thumbnail', value: 'embed', emoji: '🎨' },
                                { label: 'Simple Text', description: 'Plain text message with no formatting', value: 'text', emoji: '📝' }
                            )
                    )
                ]
            });
        }

        // ── Q3: Style → show Q4a (join role) ─────────────────────────────────
        if (interaction.isStringSelectMenu() && interaction.customId === `vs_q3_${gid}`) {
            state.style = interaction.values[0];

            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('👋 Step 4 of 5 — Join Role')
                        .setDescription(
                            'Select the role to **automatically give every new member** when they join the server.\n\n' +
                            '> This is typically an "Unverified" or "Member" role that restricts channel access until they verify.'
                        )
                        .setFooter({ text: 'Step 4 of 5' })
                ],
                components: [
                    new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId(`vs_q4a_${gid}`)
                            .setPlaceholder('Select the join role...')
                    )
                ]
            });
        }

        // ── Q4a: Join role → show Q4b (verified role) ────────────────────────
        if (interaction.isRoleSelectMenu() && interaction.customId === `vs_q4a_${gid}`) {
            state.joinRoleId = interaction.values[0];

            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('✅ Step 5 of 5 — Verified Role')
                        .setDescription(
                            'Select the role to give members **once they successfully verify** their Roblox account.\n\n' +
                            '> This is typically a "Verified" role that grants access to the rest of the server.'
                        )
                        .addFields({ name: '👋 Join Role', value: `<@&${state.joinRoleId}>`, inline: true })
                        .setFooter({ text: 'Step 5 of 5 • Final step!' })
                ],
                components: [
                    new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId(`vs_q4b_${gid}`)
                            .setPlaceholder('Select the verified role...')
                    )
                ]
            });
        }

        // ── Q4b: Verified role → save config + summary ────────────────────────
        if (interaction.isRoleSelectMenu() && interaction.customId === `vs_q4b_${gid}`) {
            state.verifiedRoleId = interaction.values[0];

            verifyConfig[gid] = {
                method:        state.method,
                gamepasId:     state.method === 'gamepass' ? state.gamepasId : undefined,
                title:         state.title,
                description:   state.description,
                thumbnail:     state.thumbnail,
                style:         state.style,
                joinRoleId:    state.joinRoleId,
                verifiedRoleId: state.verifiedRoleId
            };
            saveVerifyConfig();
            verifySetupState.delete(gid);

            const methodText = state.method === 'bio'
                ? '🔖 Bio Verification'
                : `🎫 Gamepass Verification (ID: \`${state.gamepasId}\`)`;

            const summary = new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle('🎉 Verification Setup Complete!')
                .setDescription('Your verification system is fully configured. Here\'s a summary:')
                .addFields(
                    { name: '🔐 Verification Method', value: methodText,                                                                                       inline: false },
                    { name: '📝 Message Title',        value: state.title,                                                                                      inline: true  },
                    { name: '🎨 Message Style',        value: state.style === 'embed' ? '🎨 Embed' : '📝 Simple Text',                                          inline: true  },
                    { name: '👋 Join Role',            value: `<@&${state.joinRoleId}> — given to every new member on join`,                                    inline: false },
                    { name: '✅ Verified Role',        value: `<@&${state.verifiedRoleId}> — given when a member verifies`,                                     inline: false },
                    { name: '📄 Description Preview',  value: state.description.slice(0, 200) + (state.description.length > 200 ? '…' : ''),                   inline: false },
                    ...(state.thumbnail ? [{ name: '🖼️ Thumbnail', value: state.thumbnail, inline: false }] : [])
                )
                .setFooter({ text: 'Members can now run !verify to link their Roblox account' });

            if (state.thumbnail) summary.setThumbnail(state.thumbnail);

            await interaction.update({ embeds: [summary], components: [] });
        }

            return; // end of verify setup section
        }

        // ══════════════════════════════════════════════════════════════════════
        // SECTION B — REPORT SETUP  (rs_* custom IDs)
        // ══════════════════════════════════════════════════════════════════════
        const isReportSetup =
            (interaction.isChannelSelectMenu() && (interaction.customId === `rs_cat_${gid}` || interaction.customId === `rs_log_${gid}`)) ||
            (interaction.isRoleSelectMenu()    &&  interaction.customId === `rs_mod_${gid}`);

        if (isReportSetup) {
            const state = reportSetupState.get(gid);
            if (!state) return;
            if (interaction.user.id !== state.authorId) {
                return interaction.reply({ content: '❌ Only the person who started setup can interact with this.', ephemeral: true });
            }

            // Step 1 → category chosen, ask for log channel
            if (interaction.customId === `rs_cat_${gid}`) {
                state.categoryId = interaction.values[0];
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 Report Setup — Step 2 of 3')
                        .setDescription('Select the **text channel** where report summaries will be logged.')
                        .setFooter({ text: 'Step 2 of 3' })],
                    components: [new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder().setCustomId(`rs_log_${gid}`).setPlaceholder('Select log channel...').setChannelTypes(ChannelType.GuildText)
                    )]
                });
            }

            // Step 2 → log channel chosen, ask for mod role
            if (interaction.customId === `rs_log_${gid}`) {
                state.logChannelId = interaction.values[0];
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 Report Setup — Step 3 of 3')
                        .setDescription('Select the **Moderator Role** that can manage and action reports.')
                        .setFooter({ text: 'Step 3 of 3 • Final step!' })],
                    components: [new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder().setCustomId(`rs_mod_${gid}`).setPlaceholder('Select moderator role(s)...').setMinValues(1).setMaxValues(10)
                    )]
                });
            }

            // Step 3 → mod role(s) chosen, save config + send panel
            if (interaction.customId === `rs_mod_${gid}`) {
                state.modRoleIds = interaction.values;
                reportConfig[gid] = { categoryId: state.categoryId, logChannelId: state.logChannelId, modRoleIds: state.modRoleIds };
                saveReportConfig();
                reportSetupState.delete(gid);

                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Report Setup Complete!')
                        .setDescription('The report panel has been posted. Use `!reportsetup` to reconfigure.')
                        .addFields(
                            { name: '📁 Category',     value: `<#${state.categoryId}>`,                                       inline: true  },
                            { name: '📋 Log Channel',  value: `<#${state.logChannelId}>`,                                     inline: true  },
                            { name: '🛡️ Mod Roles',   value: state.modRoleIds.map(id => `<@&${id}>`).join('\n'), inline: false }
                        )],
                    components: []
                });

                // Post the persistent report panel
                await interaction.channel.send({
                    embeds: [new EmbedBuilder().setColor(0xe74c3c)
                        .setTitle('🚨 Player Report System')
                        .setDescription('Use the button below to report exploiters, hackers, teamers, bypassers, or rule breakers. Please provide valid evidence.')],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('report_create').setLabel('📝 Create Report').setStyle(ButtonStyle.Danger)
                    )]
                });
            }

            return;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SECTION C — APPEAL SETUP  (as_* custom IDs)
        // ══════════════════════════════════════════════════════════════════════
        const isAppealSetup =
            (interaction.isChannelSelectMenu() && (interaction.customId === `as_cat_${gid}` || interaction.customId === `as_log_${gid}`)) ||
            (interaction.isRoleSelectMenu()    &&  interaction.customId === `as_mod_${gid}`);

        if (isAppealSetup) {
            const state = appealSetupState.get(gid);
            if (!state) return;
            if (interaction.user.id !== state.authorId) {
                return interaction.reply({ content: '❌ Only the person who started setup can interact with this.', ephemeral: true });
            }

            if (interaction.customId === `as_cat_${gid}`) {
                state.categoryId = interaction.values[0];
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('📩 Appeal Setup — Step 2 of 3')
                        .setDescription('Select the **text channel** where appeal summaries will be logged.')
                        .setFooter({ text: 'Step 2 of 3' })],
                    components: [new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder().setCustomId(`as_log_${gid}`).setPlaceholder('Select log channel...').setChannelTypes(ChannelType.GuildText)
                    )]
                });
            }

            if (interaction.customId === `as_log_${gid}`) {
                state.logChannelId = interaction.values[0];
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('📩 Appeal Setup — Step 3 of 3')
                        .setDescription('Select the **Moderator Role** that can manage and action appeals.')
                        .setFooter({ text: 'Step 3 of 3 • Final step!' })],
                    components: [new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder().setCustomId(`as_mod_${gid}`).setPlaceholder('Select moderator role(s)...').setMinValues(1).setMaxValues(10)
                    )]
                });
            }

            if (interaction.customId === `as_mod_${gid}`) {
                state.modRoleIds = interaction.values;
                appealConfig[gid] = { categoryId: state.categoryId, logChannelId: state.logChannelId, modRoleIds: state.modRoleIds };
                saveAppealConfig();
                appealSetupState.delete(gid);

                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Appeal Setup Complete!')
                        .setDescription('The appeal panel has been posted. Use `!appealsetup` to reconfigure.')
                        .addFields(
                            { name: '📁 Category',    value: `<#${state.categoryId}>`,                                        inline: true  },
                            { name: '📋 Log Channel', value: `<#${state.logChannelId}>`,                                      inline: true  },
                            { name: '🛡️ Mod Roles',  value: state.modRoleIds.map(id => `<@&${id}>`).join('\n'), inline: false }
                        )],
                    components: []
                });

                await interaction.channel.send({
                    embeds: [new EmbedBuilder().setColor(0x3498db)
                        .setTitle('📩 Ban Appeal System')
                        .setDescription('If you believe your punishment was unfair, submit an appeal using the button below.')],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('appeal_create').setLabel('📨 Create Appeal').setStyle(ButtonStyle.Primary)
                    )]
                });
            }

            return;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SECTION D — TICKET BUTTONS
        // ══════════════════════════════════════════════════════════════════════
        if (!interaction.isButton()) return;

        // ── Helper: run Q&A in a ticket channel ───────────────────────────────
        async function collectAnswers(channel, userId, questions) {
            const answers = [];
            for (const q of questions) {
                await channel.send(q);
                const res = await channel.awaitMessages({
                    filter: m => m.author.id === userId,
                    max: 1,
                    time: 300_000
                }).catch(() => null);
                if (!res || res.size === 0) return null;
                answers.push(res.first().content);
            }
            return answers;
        }

        // ── Create Report Ticket ───────────────────────────────────────────────
        if (interaction.customId === 'report_create') {
            const cfg = reportConfig[gid];
            if (!cfg) return interaction.reply({ content: '❌ Reports are not set up. Ask an admin to run `!reportsetup`.', ephemeral: true });

            const key = `${gid}_${interaction.user.id}`;
            if (tickets.activeReports[key]) {
                const existing = interaction.guild.channels.cache.get(tickets.activeReports[key]);
                if (existing) return interaction.reply({ content: `❌ You already have an open report: ${existing}`, ephemeral: true });
                delete tickets.activeReports[key];
                saveTickets();
            }

            await interaction.deferReply({ ephemeral: true });

            // Create private ticket channel
            const channel = await interaction.guild.channels.create({
                name: `report-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
                type: ChannelType.GuildText,
                parent: cfg.categoryId,
                permissionOverwrites: [
                    { id: interaction.guild.id,       deny:  [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
                    ...(cfg.modRoleIds ?? (cfg.modRoleId ? [cfg.modRoleId] : [])).map(id => ({
                        id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    }))
                ]
            });

            const ticketId = `R-${String(tickets.nextReportId++).padStart(4, '0')}`;
            tickets.activeReports[key] = channel.id;
            saveTickets();

            await interaction.editReply({ content: `✅ Report ticket created: ${channel}` });

            // Send intro embed
            await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 Report Submission')
                    .setDescription(
                        `**Ticket ID:** \`${ticketId}\`\n\n` +
                        'Answer the questions below one at a time. You have **5 minutes** per answer.\n\n' +
                        '**1.** Roblox Username of Suspect\n' +
                        '**2.** What happened?\n' +
                        '**3.** Video Evidence Link\n' +
                        '**4.** Additional Evidence (or type `none`)'
                    )]
            });

            // Collect answers
            const answers = await collectAnswers(channel, interaction.user.id, [
                '**[1/4]** What is the **Roblox username** of the suspect?',
                '**[2/4]** What **happened**? Describe the incident in detail.',
                '**[3/4]** Provide a **video evidence link** (YouTube, Gyazo, Streamable, etc.).',
                '**[4/4]** Any **additional evidence or info**? (type `none` if not applicable)'
            ]);

            if (!answers) {
                await channel.send('⏱️ Timed out. This channel will be deleted in 10 seconds.');
                delete tickets.activeReports[key];
                saveTickets();
                setTimeout(() => channel.delete().catch(() => {}), 10_000);
                return;
            }

            // Post to log channel
            const logCh = interaction.guild.channels.cache.get(cfg.logChannelId);
            if (!logCh) return;

            const logEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle(`🚨 Report — ${ticketId}`)
                .addFields(
                    { name: '🆔 Report ID',       value: ticketId,                                                   inline: true  },
                    { name: '👤 Reporter',         value: `${interaction.user.tag} (<@${interaction.user.id}>)`,      inline: true  },
                    { name: '🎮 Suspect Username', value: answers[0],                                                 inline: true  },
                    { name: '📝 What Happened',    value: answers[1].slice(0, 1024),                                  inline: false },
                    { name: '🎥 Video Evidence',   value: answers[2],                                                 inline: false },
                    { name: '📎 Additional Info',  value: answers[3],                                                 inline: false },
                    { name: '📅 Date',             value: `<t:${Math.floor(Date.now() / 1000)}:F>`,                   inline: true  },
                    { name: '🔄 Status',           value: '🟡 Pending Review',                                        inline: true  }
                );

            const logRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket_accept_${channel.id}`).setLabel('✅ Accept Report').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ticket_reject_${channel.id}`).setLabel('❌ Reject Report').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`ticket_close_${channel.id}`).setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Secondary)
            );

            const logMsg = await logCh.send({ embeds: [logEmbed], components: [logRow] });

            // Persist
            tickets.channels[channel.id] = {
                type: 'report', guildId: gid, userId: interaction.user.id,
                ticketId, logMessageId: logMsg.id, logChannelId: cfg.logChannelId,
                status: 'pending', answers
            };
            saveTickets();

            await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Report Submitted')
                .setDescription('Your report has been submitted to the moderation team. Please stand by.')
                .addFields({ name: '🆔 Ticket ID', value: ticketId, inline: true })] });
        }

        // ── Create Appeal Ticket ───────────────────────────────────────────────
        if (interaction.customId === 'appeal_create') {
            const cfg = appealConfig[gid];
            if (!cfg) return interaction.reply({ content: '❌ Appeals are not set up. Ask an admin to run `!appealsetup`.', ephemeral: true });

            const key = `${gid}_${interaction.user.id}`;
            if (tickets.activeAppeals[key]) {
                const existing = interaction.guild.channels.cache.get(tickets.activeAppeals[key]);
                if (existing) return interaction.reply({ content: `❌ You already have an open appeal: ${existing}`, ephemeral: true });
                delete tickets.activeAppeals[key];
                saveTickets();
            }

            await interaction.deferReply({ ephemeral: true });

            const channel = await interaction.guild.channels.create({
                name: `appeal-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
                type: ChannelType.GuildText,
                parent: cfg.categoryId,
                permissionOverwrites: [
                    { id: interaction.guild.id,       deny:  [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
                    ...(cfg.modRoleIds ?? (cfg.modRoleId ? [cfg.modRoleId] : [])).map(id => ({
                        id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    }))
                ]
            });

            const ticketId = `A-${String(tickets.nextAppealId++).padStart(4, '0')}`;
            tickets.activeAppeals[key] = channel.id;
            saveTickets();

            await interaction.editReply({ content: `✅ Appeal ticket created: ${channel}` });

            await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('📩 Appeal Submission')
                    .setDescription(
                        `**Ticket ID:** \`${ticketId}\`\n\n` +
                        'Answer the questions below one at a time. You have **5 minutes** per answer.\n\n' +
                        '**1.** Your Roblox Username\n' +
                        '**2.** Punishment Type\n' +
                        '**3.** Punishment Reason\n' +
                        '**4.** Why should it be removed?\n' +
                        '**5.** Additional Information (or type `none`)'
                    )]
            });

            const answers = await collectAnswers(channel, interaction.user.id, [
                '**[1/5]** What is your **Roblox username**?',
                '**[2/5]** What type of **punishment** did you receive? (e.g. Ban, Mute, Kick)',
                '**[3/5]** What was the stated **reason** for your punishment?',
                '**[4/5]** Why do you believe this punishment should be **removed or reduced**?',
                '**[5/5]** Any **additional information**? (type `none` if not applicable)'
            ]);

            if (!answers) {
                await channel.send('⏱️ Timed out. This channel will be deleted in 10 seconds.');
                delete tickets.activeAppeals[key];
                saveTickets();
                setTimeout(() => channel.delete().catch(() => {}), 10_000);
                return;
            }

            const logCh = interaction.guild.channels.cache.get(cfg.logChannelId);
            if (!logCh) return;

            const logEmbed = new EmbedBuilder().setColor(0x3498db).setTitle(`📩 Appeal — ${ticketId}`)
                .addFields(
                    { name: '🆔 Appeal ID',         value: ticketId,                                                  inline: true  },
                    { name: '💬 Discord User',       value: `${interaction.user.tag} (<@${interaction.user.id}>)`,    inline: true  },
                    { name: '🎮 Roblox Username',    value: answers[0],                                               inline: true  },
                    { name: '⚖️ Punishment Type',    value: answers[1],                                               inline: true  },
                    { name: '📋 Punishment Reason',  value: answers[2],                                               inline: false },
                    { name: '📝 Appeal Statement',   value: answers[3].slice(0, 1024),                                inline: false },
                    { name: '📎 Additional Info',    value: answers[4],                                               inline: false },
                    { name: '📅 Date Submitted',     value: `<t:${Math.floor(Date.now() / 1000)}:F>`,                 inline: true  },
                    { name: '🔄 Status',             value: '🟡 Pending',                                             inline: true  }
                );

            const logRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket_accept_${channel.id}`).setLabel('✅ Accept Appeal').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ticket_deny_${channel.id}`).setLabel('❌ Deny Appeal').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`ticket_close_${channel.id}`).setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Secondary)
            );

            const logMsg = await logCh.send({ embeds: [logEmbed], components: [logRow] });

            tickets.channels[channel.id] = {
                type: 'appeal', guildId: gid, userId: interaction.user.id,
                ticketId, logMessageId: logMsg.id, logChannelId: cfg.logChannelId,
                status: 'pending', answers
            };
            saveTickets();

            await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Appeal Submitted')
                .setDescription('Your appeal has been submitted to the moderation team. Please stand by.')
                .addFields({ name: '🆔 Ticket ID', value: ticketId, inline: true })] });
        }

        // ── Accept ─────────────────────────────────────────────────────────────
        if (interaction.customId.startsWith('ticket_accept_')) {
            const channelId = interaction.customId.slice('ticket_accept_'.length);
            const ticket = tickets.channels[channelId];
            if (!ticket) return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            const cfg = ticket.type === 'report' ? reportConfig[gid] : appealConfig[gid];
            const modIds1 = cfg?.modRoleIds ?? (cfg?.modRoleId ? [cfg.modRoleId] : []);
            if (!cfg || !modIds1.some(id => interaction.member.roles.cache.has(id)))
                return interaction.reply({ content: '❌ You need a moderator role to action tickets.', ephemeral: true });

            const newStatus = ticket.type === 'report' ? '🟡 Under Investigation' : '🟢 Accepted';
            ticket.status   = ticket.type === 'report' ? 'under_investigation' : 'accepted';
            saveTickets();

            // Update log embed
            const logCh = interaction.guild.channels.cache.get(ticket.logChannelId);
            if (logCh) {
                const logMsg = await logCh.messages.fetch(ticket.logMessageId).catch(() => null);
                if (logMsg) {
                    const idx = logMsg.embeds[0].fields.findIndex(f => f.name === '🔄 Status');
                    const updated = EmbedBuilder.from(logMsg.embeds[0]).spliceFields(idx, 1, { name: '🔄 Status', value: newStatus, inline: true })
                        .addFields({ name: '✅ Actioned By', value: interaction.user.tag, inline: true });
                    await logMsg.edit({ embeds: [updated] });
                }
            }

            // Notify in ticket channel
            const ticketCh = interaction.guild.channels.cache.get(channelId);
            if (ticketCh) await ticketCh.send({ embeds: [new EmbedBuilder()
                .setColor(ticket.type === 'report' ? 0xfee75c : 0x57f287)
                .setTitle(ticket.type === 'report' ? '🟡 Report Accepted — Under Investigation' : '🟢 Appeal Accepted')
                .setDescription(ticket.type === 'report'
                    ? `Your report (**${ticket.ticketId}**) has been accepted and is now under investigation.`
                    : `Your appeal (**${ticket.ticketId}**) has been **accepted**. Your punishment will be reviewed.`)
                .addFields({ name: '🛡️ Reviewed by', value: interaction.user.tag, inline: true })] });

            await interaction.reply({ content: `✅ ${ticket.type === 'report' ? 'Report accepted — Under Investigation.' : 'Appeal accepted.'}`, ephemeral: true });
        }

        // ── Reject / Deny ──────────────────────────────────────────────────────
        if (interaction.customId.startsWith('ticket_reject_') || interaction.customId.startsWith('ticket_deny_')) {
            const isReject  = interaction.customId.startsWith('ticket_reject_');
            const channelId = interaction.customId.slice(isReject ? 'ticket_reject_'.length : 'ticket_deny_'.length);
            const ticket    = tickets.channels[channelId];
            if (!ticket) return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            const cfg = ticket.type === 'report' ? reportConfig[gid] : appealConfig[gid];
            const modIds2 = cfg?.modRoleIds ?? (cfg?.modRoleId ? [cfg.modRoleId] : []);
            if (!cfg || !modIds2.some(id => interaction.member.roles.cache.has(id)))
                return interaction.reply({ content: '❌ You need a moderator role to action tickets.', ephemeral: true });

            ticket.status = 'rejected';
            saveTickets();

            const logCh = interaction.guild.channels.cache.get(ticket.logChannelId);
            if (logCh) {
                const logMsg = await logCh.messages.fetch(ticket.logMessageId).catch(() => null);
                if (logMsg) {
                    const idx = logMsg.embeds[0].fields.findIndex(f => f.name === '🔄 Status');
                    const updated = EmbedBuilder.from(logMsg.embeds[0]).spliceFields(idx, 1, { name: '🔄 Status', value: '🔴 Rejected', inline: true })
                        .addFields({ name: '❌ Rejected By', value: interaction.user.tag, inline: true });
                    await logMsg.edit({ embeds: [updated] });
                }
            }

            const ticketCh = interaction.guild.channels.cache.get(channelId);
            if (ticketCh) await ticketCh.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('🔴 Rejected')
                .setDescription(ticket.type === 'report'
                    ? `Your report (**${ticket.ticketId}**) has been **rejected** — it did not meet the requirements for action.`
                    : `Your appeal (**${ticket.ticketId}**) has been **denied** — the moderation team has decided to uphold the punishment.`)
                .addFields({ name: '🛡️ Reviewed by', value: interaction.user.tag, inline: true })] });

            await interaction.reply({ content: `✅ ${ticket.type} ${isReject ? 'rejected' : 'denied'}.`, ephemeral: true });
        }

        // ── Close Ticket ───────────────────────────────────────────────────────
        if (interaction.customId.startsWith('ticket_close_')) {
            const channelId = interaction.customId.slice('ticket_close_'.length);
            const ticket    = tickets.channels[channelId];
            if (!ticket) return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            const cfg = ticket.type === 'report' ? reportConfig[gid] : appealConfig[gid];
            const modIds3 = cfg?.modRoleIds ?? (cfg?.modRoleId ? [cfg.modRoleId] : []);
            if (!cfg || !modIds3.some(id => interaction.member.roles.cache.has(id)))
                return interaction.reply({ content: '❌ You need a moderator role to close tickets.', ephemeral: true });

            const ticketCh = interaction.guild.channels.cache.get(channelId);
            if (!ticketCh) return interaction.reply({ content: '❌ Channel not found.', ephemeral: true });

            // Build transcript
            const messages = await ticketCh.messages.fetch({ limit: 100 }).catch(() => null);
            let transcript = `=== TICKET TRANSCRIPT ===\nTicket ID: ${ticket.ticketId}\nType: ${ticket.type.toUpperCase()}\nClosed by: ${interaction.user.tag}\nDate: ${new Date().toUTCString()}\n========================\n\n`;
            if (messages) {
                for (const msg of [...messages.values()].reverse()) {
                    transcript += `[${new Date(msg.createdTimestamp).toUTCString()}] ${msg.author.tag}: ${msg.content}\n`;
                }
            }

            // Post transcript + close notice to log channel
            const logCh = interaction.guild.channels.cache.get(ticket.logChannelId);
            if (logCh) {
                await logCh.send({
                    embeds: [new EmbedBuilder().setColor(0x7289da).setTitle(`🔒 Ticket Closed — ${ticket.ticketId}`)
                        .addFields(
                            { name: '🆔 Ticket ID',  value: ticket.ticketId,          inline: true },
                            { name: '👤 User',        value: `<@${ticket.userId}>`,    inline: true },
                            { name: '🛡️ Closed By',  value: interaction.user.tag,     inline: true },
                            { name: '📅 Closed At',  value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                        )],
                    files: [new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `transcript-${ticket.ticketId}.txt` })]
                });

                // Disable the action buttons on the log entry
                const logMsg = await logCh.messages.fetch(ticket.logMessageId).catch(() => null);
                if (logMsg?.components[0]) {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        logMsg.components[0].components.map(b => ButtonBuilder.from(b).setDisabled(true))
                    );
                    await logMsg.edit({ components: [disabledRow] }).catch(() => {});
                }
            }

            // Clean up ticket records
            const key = `${gid}_${ticket.userId}`;
            if (ticket.type === 'report') delete tickets.activeReports[key];
            else                          delete tickets.activeAppeals[key];
            delete tickets.channels[channelId];
            saveTickets();

            await interaction.reply({ content: '🔒 Ticket closed. Deleting channel in 5 seconds...', ephemeral: true });
            setTimeout(() => ticketCh.delete().catch(() => {}), 5_000);
        }

    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: '❌ An error occurred. Please try again.', ephemeral: true }).catch(() => {});
        }
    }
});

// ── Auto-assign join role on member join ──────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
    const config = verifyConfig[member.guild.id];
    if (!config?.joinRoleId) return;
    try {
        await member.roles.add(config.joinRoleId);
    } catch (err) {
        console.error(`Failed to assign join role to ${member.user.tag}:`, err.message);
    }
});

// ── Verify helper ─────────────────────────────────────────────────────────────

async function assignVerifiedRoles(member, config) {
    if (config.verifiedRoleId) {
        await member.roles.add(config.verifiedRoleId).catch(e => console.error('Add verified role:', e.message));
    }
    if (config.joinRoleId && member.roles.cache.has(config.joinRoleId)) {
        await member.roles.remove(config.joinRoleId).catch(e => console.error('Remove join role:', e.message));
    }
}

// ── Message listener ──────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // ── Activity tracking (fires on every message) ────────────────────────────
    activitySys.trackMessage(message.guild.id, message.author.id);

    const prefix = prefixes[message.guild.id] || DEFAULT_PREFIX;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ── Staff management system routing ───────────────────────────────────────
    const MOD_CMDS    = ['warn','strike','removestrike','suspend','demote','terminate','ban','unban','note'];
    const SETUP_CMDS  = ['setupmod','setuplogs','setupranks','setupdepartments','setuproles'];
    const PROMO_CMDS  = ['promotionsetup','demotionsetup','promote','checkpromotion'];
    const TRAIN_CMDS  = ['trainingcreate','traininghost','trainingcomplete','traininglist'];
    const DEPT_CMDS   = ['departments','department','deptadd','deptremove','deptperformance'];
    const ACT_CMDS    = ['activity','leaderboard','resetactivity','addscore'];
    const STATS_CMDS  = ['dashboard','stats'];

    if (MOD_CMDS.includes(command))   return modSystem.handleCommand(message, command, args).catch(console.error);
    if (SETUP_CMDS.includes(command)) return cfgSystem.handleCommand(message, command, args).catch(console.error);
    if (command === 'staffprofile')   return profileSys.handleCommand(message, args).catch(console.error);
    if (command === 'loasetup' || command === 'loaend')
                                      return loaSys.handleCommand(message, command, args).catch(console.error);
    if (PROMO_CMDS.includes(command)) return promoSys.handleCommand(message, command, args).catch(console.error);
    if (TRAIN_CMDS.includes(command)) return trainSys.handleCommand(message, command, args).catch(console.error);
    if (command === 'feedbacksetup')  return feedbackSys.handleCommand(message, args).catch(console.error);
    if (ACT_CMDS.includes(command))   return activitySys.handleCommand(message, command, args).catch(console.error);
    if (DEPT_CMDS.includes(command))  return deptSys.handleCommand(message, command, args).catch(console.error);
    if (STATS_CMDS.includes(command)) return analyticsSys.handleCommand(message, command, args).catch(console.error);

    // ── !ping ─────────────────────────────────────────────────────────────────
    if (command === 'ping') {
        return message.reply('Pong! 🏓');
    }

    // ── !setprefix ────────────────────────────────────────────────────────────
    if (command === 'setprefix') {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need the "Manage Server" permission to change my prefix.');
        }
        const newPrefix = args[0];
        if (!newPrefix) return message.reply(`❌ Please specify a new prefix. Example: \`${prefix}setprefix ?\``);
        if (newPrefix.length > 5) return message.reply('❌ The prefix must be 5 characters or less.');
        prefixes[message.guild.id] = newPrefix;
        fs.writeFileSync('./prefixes.json', JSON.stringify(prefixes, null, 4));
        return message.reply(`✅ Prefix changed to \`${newPrefix}\``);
    }

    // ── !reportsetup ──────────────────────────────────────────────────────────
    if (command === 'reportsetup') {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need the **Manage Server** permission to run report setup.');
        }

        reportSetupState.set(message.guild.id, { authorId: message.author.id });
        setTimeout(() => {
            const s = reportSetupState.get(message.guild.id);
            if (s && s.authorId === message.author.id) reportSetupState.delete(message.guild.id);
        }, 300_000);

        return message.reply({
            embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 Report Setup — Step 1 of 3')
                .setDescription(
                    'Welcome to the **Report System Setup Wizard!**\n\n' +
                    'Select the **category** where report ticket channels will be created.'
                )
                .addFields(
                    { name: '📋 What we\'ll configure', value: '**Step 1 —** Reports category\n**Step 2 —** Reports log channel\n**Step 3 —** Moderator role', inline: false }
                )
                .setFooter({ text: 'Only you can interact with this setup  •  Expires in 5 minutes' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(`rs_cat_${message.guild.id}`)
                    .setPlaceholder('Select the reports category...')
                    .setChannelTypes(ChannelType.GuildCategory)
            )]
        });
    }

    // ── !appealsetup ──────────────────────────────────────────────────────────
    if (command === 'appealsetup') {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need the **Manage Server** permission to run appeal setup.');
        }

        appealSetupState.set(message.guild.id, { authorId: message.author.id });
        setTimeout(() => {
            const s = appealSetupState.get(message.guild.id);
            if (s && s.authorId === message.author.id) appealSetupState.delete(message.guild.id);
        }, 300_000);

        return message.reply({
            embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('📩 Appeal Setup — Step 1 of 3')
                .setDescription(
                    'Welcome to the **Appeal System Setup Wizard!**\n\n' +
                    'Select the **category** where appeal ticket channels will be created.'
                )
                .addFields(
                    { name: '📋 What we\'ll configure', value: '**Step 1 —** Appeals category\n**Step 2 —** Appeals log channel\n**Step 3 —** Moderator role', inline: false }
                )
                .setFooter({ text: 'Only you can interact with this setup  •  Expires in 5 minutes' })],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(`as_cat_${message.guild.id}`)
                    .setPlaceholder('Select the appeals category...')
                    .setChannelTypes(ChannelType.GuildCategory)
            )]
        });
    }

    // ── !verifysetup ──────────────────────────────────────────────────────────
    if (command === 'verifysetup') {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need the **Manage Server** permission to run verification setup.');
        }

        // Cancel any existing setup session for this server
        verifySetupState.set(message.guild.id, { authorId: message.author.id });

        // Auto-expire after 5 minutes
        setTimeout(() => {
            const s = verifySetupState.get(message.guild.id);
            if (s && s.authorId === message.author.id) verifySetupState.delete(message.guild.id);
        }, 300_000);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔐 RoUtil Verification Setup')
            .setDescription(
                'Welcome to the **RoUtil Verification Setup Wizard!**\n' +
                'This will configure how members link their Roblox account to this server.\n\u200b'
            )
            .addFields(
                {
                    name: '📋 What we\'ll set up',
                    value:
                        '**Step 1 —** Choose how members verify their Roblox account\n' +
                        '**Step 2 —** Write the verification message (title, description, thumbnail)\n' +
                        '**Step 3 —** Choose whether the message is a rich embed or plain text\n' +
                        '**Step 4 —** Select the role given to every new member on join\n' +
                        '**Step 5 —** Select the role given when a member verifies',
                    inline: false
                },
                {
                    name: '🔖 Bio Verification',
                    value: 'RoUtil gives each member a unique code. They paste it into their **Roblox profile bio** to prove account ownership.',
                    inline: false
                },
                {
                    name: '🎫 Gamepass Verification',
                    value: 'Members must own a specific gamepass (named **"RoUtil"**) in your Roblox game. You supply the **Gamepass ID**.',
                    inline: false
                }
            )
            .setFooter({ text: 'Only you can interact with this setup  •  Expires in 5 minutes' });

        const menu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`vs_q1_${message.guild.id}`)
                .setPlaceholder('📋 Step 1 — How should members verify?')
                .addOptions(
                    { label: 'Bio Verification',      description: 'Member pastes a unique code into their Roblox bio',          value: 'bio',      emoji: '🔖' },
                    { label: 'Gamepass Verification', description: 'Member owns a "RoUtil" gamepass in your Roblox game',         value: 'gamepass', emoji: '🎫' }
                )
        );

        return message.reply({ embeds: [embed], components: [menu] });
    }

    // ── !verify ───────────────────────────────────────────────────────────────
    if (command === 'verify') {
        const config = verifyConfig[message.guild.id];
        if (!config) {
            return message.reply('❌ Verification has not been set up for this server yet. An admin can run `!verifysetup` to configure it.');
        }

        if (config.verifiedRoleId && message.member.roles.cache.has(config.verifiedRoleId)) {
            return message.reply('✅ You are already verified!');
        }

        const promptMsg = await message.reply('🔍 What is your **Roblox username**? Reply within 60 seconds.');

        const usernameCollector = message.channel.createMessageCollector({
            filter: m => m.author.id === message.author.id,
            max: 1,
            time: 60_000
        });

        usernameCollector.on('collect', async (usernameMsg) => {
            const username = usernameMsg.content.trim();

            let robloxUser;
            try {
                const res = await fetch('https://users.roblox.com/v1/usernames/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
                });
                const data = await res.json();
                robloxUser = data.data?.[0];
            } catch {
                return message.reply('❌ Failed to contact Roblox. Please try again later.');
            }

            if (!robloxUser) {
                return message.reply(`❌ No Roblox user found with the username **${username}**. Check the spelling and try again.`);
            }

            // ── Gamepass method ──────────────────────────────────────────────
            if (config.method === 'gamepass') {
                const checking = await message.reply(`🎫 Checking if **${robloxUser.name}** owns the gamepass...`);
                try {
                    const gpRes  = await fetch(`https://inventory.roblox.com/v1/users/${robloxUser.id}/items/GamePass/${config.gamepasId}`);
                    const gpData = await gpRes.json();

                    if (gpData.data?.length > 0) {
                        await assignVerifiedRoles(message.member, config);
                        verifyConfig.links = verifyConfig.links || {};
                        verifyConfig.links[message.author.id] = { robloxName: robloxUser.name, robloxId: robloxUser.id };
                        saveVerifyConfig();
                        await checking.edit(`✅ Verified! **${robloxUser.name}** owns the gamepass — you've been given the verified role.`);
                    } else {
                        await checking.edit(`❌ **${robloxUser.name}** does not own the required gamepass (ID: \`${config.gamepasId}\`).`);
                    }
                } catch {
                    await checking.edit('❌ Failed to check gamepass ownership. Please try again later.');
                }
                return;
            }

            // ── Bio method ───────────────────────────────────────────────────
            const code = `routil-${message.author.id.slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;

            const bioEmbed = () => new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('🔖 Bio Verification')
                .setDescription(
                    `Add the code below **exactly** to your [Roblox profile bio](https://www.roblox.com/my/account#!/info), then click **Verify**.\n\n` +
                    `\`\`\`${code}\`\`\``
                )
                .addFields({ name: '👤 Roblox Account', value: `**${robloxUser.name}** (ID: \`${robloxUser.id}\`)`, inline: false })
                .setFooter({ text: 'Expires in 5 minutes  •  You can try as many times as you need' });

            const bioRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_check').setLabel('✅ Verify').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('verify_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );

            const bioMsg = await message.reply({ embeds: [bioEmbed()], components: [bioRow] });

            const btnCollector = bioMsg.createMessageComponentCollector({
                filter: i => i.user.id === message.author.id,
                time: 300_000
            });

            btnCollector.on('collect', async (interaction) => {
                if (interaction.customId === 'verify_cancel') {
                    await interaction.update({
                        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Verification Cancelled').setDescription('Run `!verify` again whenever you\'re ready.')],
                        components: []
                    });
                    btnCollector.stop('cancelled');
                    return;
                }

                await interaction.deferUpdate();

                let profile;
                try {
                    const profileRes = await fetch(`https://users.roblox.com/v1/users/${robloxUser.id}`);
                    profile = await profileRes.json();
                } catch {
                    await bioMsg.edit({ content: '❌ Failed to reach Roblox. Please try again.', embeds: [bioEmbed()], components: [bioRow] });
                    return;
                }

                if (profile.description?.includes(code)) {
                    await assignVerifiedRoles(message.member, config);
                    verifyConfig.links = verifyConfig.links || {};
                    verifyConfig.links[message.author.id] = { robloxName: robloxUser.name, robloxId: robloxUser.id };
                    saveVerifyConfig();
                    await bioMsg.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0x57f287)
                                .setTitle('✅ Verification Successful!')
                                .setDescription(`Your Discord account is now linked to **${robloxUser.name}**! You've been given the verified role.`)
                                .addFields({ name: '🎮 Roblox Account', value: `**${robloxUser.name}** (ID: \`${robloxUser.id}\`)`, inline: false })
                        ],
                        components: []
                    });
                    btnCollector.stop('verified');
                } else {
                    await bioMsg.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0xfee75c)
                                .setTitle('🔖 Bio Verification — Code Not Found')
                                .setDescription(
                                    `The code wasn't found in **${robloxUser.name}**'s bio yet. Make sure it's copied exactly:\n\n` +
                                    `\`\`\`${code}\`\`\`\n` +
                                    `[Open your Roblox profile settings](https://www.roblox.com/my/account#!/info)`
                                )
                                .addFields({ name: '👤 Roblox Account', value: `**${robloxUser.name}** (ID: \`${robloxUser.id}\`)`, inline: false })
                                .setFooter({ text: 'Expires in 5 minutes  •  You can try as many times as you need' })
                        ],
                        components: [bioRow]
                    });
                }
            });

            btnCollector.on('end', (_, reason) => {
                if (reason !== 'verified' && reason !== 'cancelled') {
                    bioMsg.edit({ components: [] }).catch(() => {});
                }
            });
        });

        usernameCollector.on('end', (collected) => {
            if (collected.size === 0) {
                promptMsg.edit('⏱️ Verification timed out. Run `!verify` again when you\'re ready.').catch(() => {});
            }
        });

        return;
    }

    // ── !whois ────────────────────────────────────────────────────────────────
    if (command === 'whois') {
        const user = message.mentions.users.first();
        if (!user) return message.reply('❌ Mention a user. Example: `!whois @someone`');

        const data = verifyConfig.links?.[user.id];
        if (!data) return message.reply(`❌ **${user.tag}** has not verified their Roblox account in this server.`);

        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('🔍 Roblox Link')
                    .addFields(
                        { name: '💬 Discord',      value: user.tag,                     inline: true },
                        { name: '🎮 Roblox Name',  value: data.robloxName,              inline: true },
                        { name: '🆔 Roblox ID',    value: `\`${data.robloxId}\``,       inline: true }
                    )
                    .setThumbnail(user.displayAvatarURL())
            ]
        });
    }

    // ── !verified ─────────────────────────────────────────────────────────────
    if (command === 'verified') {
        const count = verifyConfig.links ? Object.keys(verifyConfig.links).length : 0;
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57f287)
                    .setTitle('✅ Verified Members')
                    .setDescription(`**${count}** member${count !== 1 ? 's have' : ' has'} verified their Roblox account in this server.`)
            ]
        });
    }

    // ── !serverstats ──────────────────────────────────────────────────────────
    if (command === 'serverstats') {
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x00ae86)
                    .setTitle('📊 Server Statistics')
                    .setThumbnail(message.guild.iconURL())
                    .addFields(
                        { name: '👥 Members',  value: `${message.guild.memberCount}`,              inline: true },
                        { name: '💬 Channels', value: `${message.guild.channels.cache.size}`,      inline: true },
                        { name: '🏷️ Roles',   value: `${message.guild.roles.cache.size}`,         inline: true }
                    )
                    .setFooter({ text: message.guild.name })
            ]
        });
    }

    // ── !userinfo ─────────────────────────────────────────────────────────────
    if (command === 'userinfo') {
        const member = message.mentions.members.first() || message.member;
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('👤 User Information')
                    .setThumbnail(member.user.displayAvatarURL())
                    .addFields(
                        { name: 'Username',      value: member.user.tag,                                                 inline: true  },
                        { name: 'User ID',       value: `\`${member.id}\``,                                              inline: true  },
                        { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,            inline: false },
                        { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,   inline: false }
                    )
            ]
        });
    }

    // ── !avatar ───────────────────────────────────────────────────────────────
    if (command === 'avatar') {
        const user = message.mentions.users.first() || message.author;
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle(`🖼️ ${user.username}'s Avatar`)
                    .setImage(user.displayAvatarURL({ size: 1024 }))
            ]
        });
    }

    // ── Paginator helper (shared by !cmds and !staffcmds) ────────────────────
    const buildCmdsPaginator = async (replyTarget, list, color, title) => {
        const PAGE_SIZE  = 8;
        let page = 1;
        const totalPages = () => Math.ceil(list.length / PAGE_SIZE);

        const buildEmbed = () => new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(
                list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                    .map(c => `**${c.name}**\n${c.desc}`).join('\n\n')
            )
            .setFooter({ text: `Page ${page} of ${totalPages()}  •  ${list.length} commands total` });

        const buildRow = () => new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cmds_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
            new ButtonBuilder().setCustomId('cmds_page').setLabel(`${page} / ${totalPages()}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('cmds_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages())
        );

        const msg = await replyTarget.reply({ embeds: [buildEmbed()], components: [buildRow()] });

        const collector = msg.createMessageComponentCollector({
            filter: i => i.user.id === replyTarget.author.id,
            time: 120_000
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'cmds_prev' && page > 1) page--;
            if (interaction.customId === 'cmds_next' && page < totalPages()) page++;
            await interaction.update({ embeds: [buildEmbed()], components: [buildRow()] });
        });

        collector.on('end', () => {
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('cmds_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('cmds_page').setLabel(`${page} / ${totalPages()}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('cmds_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            msg.edit({ components: [disabledRow] }).catch(() => {});
        });
    };

    // ── !cmds — member commands only ─────────────────────────────────────────
    if (command === 'cmds') {
        await buildCmdsPaginator(message, MEMBER_CMDS, 0x5865f2, '👤 RoUtil — Member Commands');
        return;
    }

    // ── !staffcmds — staff commands only ─────────────────────────────────────
    if (command === 'staffcmds') {
        await buildCmdsPaginator(message, STAFF_CMDS, 0xed4245, '🛡️ RoUtil — Staff Commands');
        return;
    }

    // ── !find ─────────────────────────────────────────────────────────────────
    if (command === 'find') {
        const TYPE_ALIASES = {
            user: 'user', users: 'user', player: 'user',
            item: 'catalog', items: 'catalog', catalog: 'catalog',
            marketplace: 'catalog', limited: 'catalog'
        };

        if (!args.length) {
            return message.reply(
                `❌ Please provide a search query.\n` +
                `> **Usage:** \`${prefix}find [user|item] <name> [by <creator>]\`\n` +
                `> **Examples:**\n` +
                `> \`${prefix}find user Builderman\`\n` +
                `> \`${prefix}find item Bloxy Cola\`\n` +
                `> \`${prefix}find item Bloxy Cola by Roblox\`\n` +
                `> \`${prefix}find Builderman\` *(searches users + marketplace)*`
            );
        }

        const firstArg = args[0].toLowerCase();
        let searchType = TYPE_ALIASES[firstArg] || 'all';
        let remaining  = searchType !== 'all' ? args.slice(1) : args;

        let creatorFilter = null;
        if (searchType === 'catalog' || searchType === 'all') {
            const byIndex = remaining.findIndex(a => a.toLowerCase() === 'by');
            if (byIndex !== -1 && byIndex < remaining.length - 1) {
                creatorFilter = remaining.slice(byIndex + 1).join(' ');
                remaining     = remaining.slice(0, byIndex);
            }
        }

        const query = remaining.join(' ');
        if (!query) return message.reply(`❌ Please provide a name to search. Example: \`${prefix}find ${firstArg} Bloxy Cola\``);

        const creatorLabel = creatorFilter ? ` by **${creatorFilter}**` : '';
        const typeLabel    = searchType === 'all' ? 'users & marketplace' : searchType === 'catalog' ? 'marketplace items' : 'users';
        const loading      = await message.reply(`🔍 Searching Roblox ${typeLabel} for **"${query}"**${creatorLabel}…`);

        try {
            let users = [], rawCatalog = [];

            if (searchType === 'all' || searchType === 'user')    users      = await searchUsers(query).catch(() => []);
            if (searchType === 'all' || searchType === 'catalog') rawCatalog = await searchCatalog(query, creatorFilter).catch(() => []);

            let catalogItems = [];
            if (rawCatalog.length > 0) {
                const payload = rawCatalog.map(i => ({ itemType: i.itemType === 'Bundle' ? 'Bundle' : 'Asset', id: i.id }));
                catalogItems = await getCatalogDetails(payload).catch(() => []);
            }

            const results = [
                ...users.map(d => ({ type: 'user',    data: d })),
                ...catalogItems.map(d => ({ type: 'catalog', data: d }))
            ];

            if (results.length === 0) {
                return loading.edit({ content: `❌ No results found for **"${query}"**.\n> Check your spelling and try again.`, embeds: [], components: [] });
            }

            let page = 0;
            await loading.edit({ content: null, embeds: [await buildEmbed(results[0], 0, results.length, query)], components: [buildFindButtons(0, results.length)] });

            const collector = loading.createMessageComponentCollector({
                filter: i => i.user.id === message.author.id,
                time: 120_000
            });

            collector.on('collect', async (interaction) => {
                if (interaction.customId === 'find_prev' && page > 0) page--;
                if (interaction.customId === 'find_next' && page < results.length - 1) page++;
                await interaction.update({ embeds: [await buildEmbed(results[page], page, results.length, query)], components: [buildFindButtons(page, results.length)] });
            });

            collector.on('end', () => {
                const disabled = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('find_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('find_info').setLabel(`${page + 1} / ${results.length}`).setStyle(ButtonStyle.Primary).setDisabled(true),
                    new ButtonBuilder().setCustomId('find_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
                loading.edit({ components: [disabled] }).catch(() => {});
            });

        } catch (err) {
            console.error('Find command error:', err);
            loading.edit({ content: '❌ Something went wrong while searching Roblox. Please try again.', embeds: [], components: [] }).catch(() => {});
        }
    }
});

// Handle unhandled promise rejections to prevent crashes
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Log in
client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('Failed to log in:', error.message);
    console.error('Make sure DISCORD_TOKEN is set correctly.');
});
