import {
  MuLawTrack,
  callWindow,
  callWindows,
  inCallWindow,
  languageName,
  callStatusOf,
  connectStreamLaml,
  muLawStereoWav,
  realtimeSession,
  realtimeTools,
  signalWireSignatureValid,
  spokenScript,
} from './voice.util';
import { createHmac } from 'node:crypto';

describe('voice util (step12)', () => {
  it('streams the call with the token as a <Parameter>, escaped, never in the URL', () => {
    const laml = connectStreamLaml('wss://cygfinance.com/api/voice/stream', {
      token: 'a"b<c',
    });
    expect(laml).toContain(
      '<Connect><Stream url="wss://cygfinance.com/api/voice/stream"><Parameter name="token" value="a&quot;b&lt;c"/></Stream></Connect>',
    );
    expect(laml).not.toContain('?token');
  });

  it('gives Realtime the same tools in its flat shape, μ-law both ways, the chosen voice', () => {
    const tools = [
      { name: 'get_link', description: 'd', parameters: { type: 'object' } },
    ];
    expect(realtimeTools(tools)).toEqual([
      {
        type: 'function',
        name: 'get_link',
        description: 'd',
        parameters: { type: 'object' },
      },
    ]);
    const s = realtimeSession({
      model: 'm',
      instructions: 'i',
      voice: 'cedar',
      tools,
    });
    expect(s.session.audio.input.format).toEqual({ type: 'audio/pcmu' });
    expect(s.session.audio.output).toEqual({
      format: { type: 'audio/pcmu' },
      voice: 'cedar',
    });
    expect(
      realtimeSession({ model: 'm', instructions: 'i', voice: 'robot', tools })
        .session.audio.output.voice,
    ).toBe('marin');
  });

  it('turns a scheduled text into something to say (no links, no bullets)', () => {
    const text =
      'Hi Dana, your weekly account status (ABC Inc):\n• 20 attachments not matched\n• 3 transactions are still Uncategorized\nReply here and I’ll help you sort them out, or open:\nhttps://cygfinance.com/dashboard';
    const said = spokenScript(text);
    expect(said).not.toContain('http');
    expect(said).not.toContain('•');
    expect(said).toContain('20 attachments not matched. 3 transactions');
  });

  it('names the default language, English for anything unknown', () => {
    expect(languageName('fr')).toBe('French');
    expect(languageName('en')).toBe('English');
    expect(languageName('xx')).toBe('English');
    expect(languageName(null)).toBe('English');
    expect(languageName('toString')).toBe('English');
  });

  it('maps SignalWire call statuses', () => {
    expect(callStatusOf('no-answer')).toBe('NO_ANSWER');
    expect(callStatusOf('busy')).toBe('NO_ANSWER');
    expect(callStatusOf('in-progress')).toBe('IN_PROGRESS');
    expect(callStatusOf('completed')).toBe('COMPLETED');
    expect(callStatusOf('failed')).toBe('FAILED');
  });

  it('builds a stereo μ-law WAV, the AI placed after the caller', () => {
    const caller = new MuLawTrack();
    const ai = new MuLawTrack();
    caller.writeAt(0, Buffer.from([1, 2, 3, 4]));
    ai.writeAt(Math.max(caller.samples, ai.samples), Buffer.from([9]));
    const wav = muLawStereoWav(caller.toBuffer(5), ai.toBuffer(5));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.readUInt16LE(20)).toBe(7); // μ-law
    expect(wav.readUInt16LE(22)).toBe(2); // stereo
    const data = wav.subarray(46);
    expect([...data]).toEqual([1, 0xff, 2, 0xff, 3, 0xff, 4, 0xff, 0xff, 9]);
  });

  it('checks the status webhook signature, failing closed', () => {
    const url = 'https://cygfinance.com/api/voice/status';
    const params = { CallSid: 'abc', CallStatus: 'completed' };
    const sig = createHmac('sha1', 'k')
      .update(`${url}CallSidabcCallStatuscompleted`)
      .digest('base64');
    expect(signalWireSignatureValid(url, params, sig, 'k')).toBe(true);
    expect(signalWireSignatureValid(url, params, sig, 'other')).toBe(false);
    expect(signalWireSignatureValid(url, params, sig, null)).toBe(false);
    expect(signalWireSignatureValid(url, params, null, 'k')).toBe(false);
  });
});

describe('call transcript windows (step12g)', () => {
  const at = (s: string) => new Date(`2026-10-26T${s}Z`);
  const call = (start: string, end: string | null, conversationId = 1) => ({
    conversationId,
    startedAt: at(start),
    endedAt: end ? at(end) : null,
  });

  it('runs from the start to a minute after the hang-up', () => {
    const w = callWindow(call('10:00:00', '10:05:00'), null);
    expect(w.from).toEqual(at('09:59:58'));
    expect(w.to).toEqual(at('10:06:00'));
  });

  it('never reaches into the next call', () => {
    const w = callWindow(call('10:00:00', '10:05:00'), at('10:05:30'));
    expect(w.to).toEqual(at('10:05:30'));
  });

  it('a live call runs to now; one that never ended stops after two hours', () => {
    expect(callWindow(call('10:00:00', null), null, at('10:03:00')).to).toEqual(
      at('10:04:00'),
    );
    expect(callWindow(call('10:00:00', null), null, at('18:00:00')).to).toEqual(
      at('12:01:00'),
    );
  });

  it('caps each call by the next one on the SAME conversation only', () => {
    const ws = callWindows([
      call('10:05:20', '10:08:00', 2),
      call('10:00:00', '10:05:00', 1),
      call('10:05:10', '10:07:00', 1),
    ]);
    expect(ws.map((w) => w.to)).toEqual([
      at('10:05:10'),
      at('10:08:00'),
      at('10:09:00'),
    ]);
    expect(inCallWindow(ws, 1, at('10:05:05'))).toBe(true);
    expect(inCallWindow(ws, 1, at('10:07:30'))).toBe(true);
    expect(inCallWindow(ws, 1, at('10:08:30'))).toBe(false);
    expect(inCallWindow(ws, 1, at('10:20:00'))).toBe(false);
    expect(inCallWindow(ws, 3, at('10:01:00'))).toBe(false);
  });
});
