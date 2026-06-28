// commands/ping.js
module.exports = {
  name: 'ping',
  description: 'Responds with Pong and latency.',
  async execute({ client, message, args, prefix }) {
    const sent = await message.channel.send('Pinging...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    sent.edit(`Pong! Latency: ${latency}ms | WebSocket: ${Math.round(client.ws.ping)}ms`);
  }
};
