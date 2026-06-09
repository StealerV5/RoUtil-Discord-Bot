// systems/fun.js — Fun & utility commands
const { EmbedBuilder } = require('discord.js');

const EIGHT_BALL = [
    '🟢 It is certain.', '🟢 It is decidedly so.', '🟢 Without a doubt.',
    '🟢 Yes, definitely.', '🟢 You may rely on it.', '🟢 As I see it, yes.',
    '🟢 Most likely.', '🟢 Outlook good.', '🟢 Yes.', '🟢 Signs point to yes.',
    '🟡 Reply hazy, try again.', '🟡 Ask again later.', '🟡 Better not tell you now.',
    '🟡 Cannot predict now.', '🟡 Concentrate and ask again.',
    '🔴 Don\'t count on it.', '🔴 My reply is no.', '🔴 My sources say no.',
    '🔴 Outlook not so good.', '🔴 Very doubtful.'
];

function safeEval(expr) {
    if (!/^[\d\s+\-*/()%.^]+$/.test(expr)) return null;
    try {
        const sanitized = expr.replace(/\^/g, '**');
        const result = Function('"use strict"; return (' + sanitized + ')')();
        if (!isFinite(result)) return null;
        return Math.round(result * 1e10) / 1e10;
    } catch { return null; }
}

async function handleCommand(message, command, args) {
    const r = (c) => message.reply(c);

    if (command === 'coinflip') {
        const result = Math.random() < 0.5 ? '🪙 Heads' : '🪙 Tails';
        return r({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('Coin Flip').setDescription(`**${result}**`)] });
    }

    if (command === 'dice') {
        const sides = Math.max(2, Math.min(10000, parseInt(args[0]) || 6));
        const roll = Math.floor(Math.random() * sides) + 1;
        return r({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle(`🎲 d${sides} Roll`).setDescription(`You rolled **${roll}** out of ${sides}`)] });
    }

    if (command === '8ball') {
        if (!args.length) return r('❌ Ask a question! Example: `!8ball Will I get promoted?`');
        const answer = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)];
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🎱 Magic 8-Ball')
            .addFields({ name: '❓ Question', value: args.join(' ') }, { name: '🎱 Answer', value: answer })] });
    }

    if (command === 'choose') {
        if (!args.length) return r('❌ Usage: `!choose option1|option2|option3`');
        const options = args.join(' ').split('|').map(o => o.trim()).filter(Boolean);
        if (options.length < 2) return r('❌ Provide at least 2 options separated by `|`.');
        const chosen = options[Math.floor(Math.random() * options.length)];
        return r({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🎯 My Choice')
            .setDescription(`**${chosen}**\n\n*Options: ${options.join(' · ')}*`)] });
    }

    if (command === 'random') {
        const min = parseInt(args[0]), max = parseInt(args[1]);
        if (isNaN(min) || isNaN(max)) return r('❌ Usage: `!random <min> <max>`. Example: `!random 1 100`');
        if (min >= max) return r('❌ Min must be less than max.');
        const n = Math.floor(Math.random() * (max - min + 1)) + min;
        return r({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🔢 Random Number').setDescription(`**${n}** *(range: ${min}–${max})*`)] });
    }

    if (command === 'time') {
        const now = new Date();
        const unix = Math.floor(now.getTime() / 1000);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🕒 Current Time')
            .addFields(
                { name: 'UTC', value: now.toUTCString(), inline: false },
                { name: 'Unix', value: `\`${unix}\``, inline: true },
                { name: 'Discord', value: `<t:${unix}:F>`, inline: true }
            )] });
    }

    if (command === 'timestamp') {
        if (!args.length) return r('❌ Usage: `!timestamp <date>`. Example: `!timestamp 2025-12-25`');
        const d = new Date(args.join(' '));
        if (isNaN(d)) return r('❌ Invalid date. Try: `!timestamp 2025-12-25`');
        const unix = Math.floor(d.getTime() / 1000);
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('⏱️ Discord Timestamps')
            .setDescription(
                `Short date: <t:${unix}:d>  →  \`<t:${unix}:d>\`\n` +
                `Long date:  <t:${unix}:D>  →  \`<t:${unix}:D>\`\n` +
                `Short time: <t:${unix}:t>  →  \`<t:${unix}:t>\`\n` +
                `Long time:  <t:${unix}:T>  →  \`<t:${unix}:T>\`\n` +
                `Full:       <t:${unix}:F>  →  \`<t:${unix}:F>\`\n` +
                `Relative:   <t:${unix}:R>  →  \`<t:${unix}:R>\``
            )] });
    }

    if (command === 'calculate') {
        if (!args.length) return r('❌ Usage: `!calculate <expression>`. Example: `!calculate 25 * 4 + 10`');
        const expr = args.join(' ');
        const result = safeEval(expr);
        if (result === null) return r('❌ Invalid expression. Only numbers and `+ - * / ( ) % ^` allowed.');
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🧮 Calculator')
            .addFields({ name: 'Expression', value: `\`${expr}\``, inline: true }, { name: 'Result', value: `\`${result}\``, inline: true })] });
    }

    if (command === 'percentage') {
        const v = parseFloat(args[0]), t = parseFloat(args[1]);
        if (isNaN(v) || isNaN(t)) return r('❌ Usage: `!percentage <value> <total>`. Example: `!percentage 37 200`');
        if (t === 0) return r('❌ Total cannot be zero.');
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📊 Percentage')
            .setDescription(`**${v}** of **${t}** = **${((v / t) * 100).toFixed(2)}%**`)] });
    }

    if (command === 'encode') {
        if (!args.length) return r('❌ Usage: `!encode <text>`');
        const text = args.join(' ');
        const encoded = Buffer.from(text).toString('base64');
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🔐 Base64 Encode')
            .addFields({ name: 'Input', value: `\`${text.slice(0, 500)}\`` }, { name: 'Encoded', value: `\`${encoded.slice(0, 1000)}\`` })] });
    }

    if (command === 'decode') {
        if (!args.length) return r('❌ Usage: `!decode <base64>`');
        try {
            const decoded = Buffer.from(args.join(' '), 'base64').toString('utf8');
            return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🔓 Base64 Decode')
                .addFields({ name: 'Input', value: `\`${args.join(' ').slice(0, 500)}\`` }, { name: 'Decoded', value: decoded.slice(0, 1000) || '*(empty)*' })] });
        } catch { return r('❌ Invalid base64 string.'); }
    }

    if (command === 'reverse') {
        if (!args.length) return r('❌ Usage: `!reverse <text>`');
        const text = args.join(' ');
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🔄 Reversed')
            .addFields({ name: 'Original', value: text.slice(0, 500) }, { name: 'Reversed', value: [...text].reverse().join('').slice(0, 500) })] });
    }

    if (command === 'charcount') {
        if (!args.length) return r('❌ Usage: `!charcount <text>`');
        const text = args.join(' ');
        return r({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📝 Character Count')
            .addFields(
                { name: '🔤 Characters', value: text.length.toString(), inline: true },
                { name: '📖 Words', value: text.trim().split(/\s+/).length.toString(), inline: true },
                { name: '🔡 Sentences', value: ((text.match(/[.!?]+/g) || []).length).toString(), inline: true }
            )] });
    }

    if (command === 'color') {
        const hex = (args[0] || '').replace('#', '');
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) return r('❌ Usage: `!color <hex>`. Example: `!color 5865F2`');
        const r2 = parseInt(hex.slice(0, 2), 16), g2 = parseInt(hex.slice(2, 4), 16), b2 = parseInt(hex.slice(4, 6), 16);
        return r({ embeds: [new EmbedBuilder().setColor(parseInt(hex, 16)).setTitle(`🎨 #${hex.toUpperCase()}`)
            .addFields(
                { name: 'HEX', value: `#${hex.toUpperCase()}`, inline: true },
                { name: 'RGB', value: `rgb(${r2}, ${g2}, ${b2})`, inline: true }
            )] });
    }
}

const FUN_CMDS = ['coinflip','dice','8ball','choose','random','time','timestamp','calculate','percentage','encode','decode','reverse','charcount','color'];
module.exports = { handleCommand, FUN_CMDS };
