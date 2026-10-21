/* eslint-disable */
/**
 * step12 — talks to the AI voice bridge like SignalWire would, from a dev machine:
 * opens ws://localhost:3001/api/voice/stream, sends `start` with a voice-call token signed
 * with this server's CUSTOMER_JWT_SECRET, streams μ-law silence for a few seconds and
 * reports what came back (the AI's greeting audio, `clear`s). No phone line, no SignalWire.
 *
 *   node scripts/voice-stream-probe.js <customerId> [seconds]
 *
 * The server needs OPENAI_API_KEY (and, from the office network, NODE_OPTIONS=--use-system-ca).
 * The call is saved like a real one (AiCall + AiMessages on the VOICE conversation).
 */
require('dotenv').config();
const WebSocket = require('ws');
const { JwtService } = require('@nestjs/jwt');

const customerId = Number(process.argv[2]);
const seconds = Number(process.argv[3] || 8);
if (!customerId) {
  console.error('usage: node scripts/voice-stream-probe.js <customerId> [seconds]');
  process.exit(1);
}
const token = new JwtService({ secret: process.env.CUSTOMER_JWT_SECRET }).sign(
  { typ: 'voice-call', sub: customerId, peer: '+15550001234', to: '+15550009999', dir: 'INBOUND', purpose: 'INBOUND' },
  { expiresIn: 120 },
);
const url = process.env.VOICE_PROBE_URL || `ws://localhost:${process.env.PORT || 3001}/api/voice/stream`;
const callSid = `probe-${Date.now()}`;
const ws = new WebSocket(url);
let media = 0;
let bytes = 0;
let clears = 0;
ws.on('open', () => {
  ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
  ws.send(JSON.stringify({
    event: 'start',
    streamSid: 'MZprobe',
    start: { streamSid: 'MZprobe', callSid, customParameters: { token } },
  }));
  const silence = Buffer.alloc(160, 0xff).toString('base64');
  const t = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'media', streamSid: 'MZprobe', media: { track: 'inbound', payload: silence } }));
    }
  }, 20);
  setTimeout(() => {
    clearInterval(t);
    ws.send(JSON.stringify({ event: 'stop', streamSid: 'MZprobe' }));
    setTimeout(() => ws.close(), 500);
  }, seconds * 1000);
});
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.event === 'media') {
    media++;
    bytes += Buffer.from(m.media.payload, 'base64').length;
  } else if (m.event === 'clear') clears++;
});
ws.on('close', () => {
  console.log(JSON.stringify({ callSid, mediaFrames: media, audioSeconds: +(bytes / 8000).toFixed(1), clears }));
});
ws.on('error', (e) => console.error('ws error', e.message));
