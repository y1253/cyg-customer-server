import {
  MuLawTrack,
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
