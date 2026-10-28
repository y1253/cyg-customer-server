import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { VoiceDeps } from './voice-session';
import { VoiceSession } from './voice-session';
import { liveCalls } from './live-calls';

/** A socket that records what is sent to it and lets the test push messages in. */
class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: Array<Record<string, unknown>> = [];
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
  push(event: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(event)));
  }
  types() {
    return this.sent.map((e) => e.type ?? e.event);
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

function setup(language = 'en') {
  const phone = new FakeSocket();
  const openai = new FakeSocket();
  const conversation = {
    id: 3,
    customerId: 7,
    companyId: null,
    channel: 'VOICE',
    peer: '+15145550001',
    bookChosen: true,
  };
  const saved: Array<[string, string]> = [];
  const deps = {
    prisma: {
      customer: { findFirst: jest.fn(() => ({ name: 'Dana Smith' })) },
      aiConversation: { findUnique: jest.fn(() => conversation) },
      company: { findMany: jest.fn(() => []) },
    },
    calls: {
      verify: jest.fn((t: string) =>
        t === 'good'
          ? {
              typ: 'voice-call',
              sub: 7,
              peer: '+15145550001',
              to: '+14385550000',
              dir: 'INBOUND',
            }
          : null,
      ),
      settings: jest.fn(() => ({
        enabled: true,
        voice: 'cedar',
        greeting: null,
        maxMinutes: 15,
        language,
      })),
      conversationFor: jest.fn(() => conversation),
      started: jest.fn(),
      ended: jest.fn(() => Promise.resolve()),
    },
    assistant: {
      isOverLimit: jest.fn(() => false),
      promptFor: jest.fn(() => 'THE SAME PROMPT AS THE CHAT'),
      save: jest.fn((_c: unknown, role: string, text: string) => {
        saved.push([role, text]);
        return { id: saved.length };
      }),
    },
    tools: {
      run: jest.fn(() => ({
        content: '{"url":"https://x"}',
        action: { tool: 'get_link', ok: true, summary: 'Link' },
      })),
    },
    signalwire: {
      startRecording: jest.fn(() => 'RE1'),
      hangup: jest.fn(),
    },
    openaiKey: 'sk-test',
    model: null,
    connect: jest.fn(() => openai),
  };
  new VoiceSession(phone as unknown as WebSocket, deps as unknown as VoiceDeps);
  return { phone, openai, deps, saved };
}

describe('VoiceSession (step12)', () => {
  it('refuses a stream without a valid token', async () => {
    const { phone, deps } = setup();
    phone.push({
      event: 'start',
      start: {
        streamSid: 'MZ',
        callSid: 'CA',
        customParameters: { token: 'bad' },
      },
    });
    await flush();
    expect(phone.readyState).toBe(WebSocket.CLOSED);
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it('bridges the call to Realtime as the same agent: prompt, voice, tools, greeting', async () => {
    const { phone, openai, deps } = setup();
    phone.push({
      event: 'start',
      start: {
        streamSid: 'MZ',
        callSid: 'CA',
        customParameters: { token: 'good' },
      },
    });
    await flush();
    expect(deps.signalwire.startRecording).toHaveBeenCalledWith('CA');
    openai.emit('open');
    await flush();
    const update = openai.sent[0] as {
      session: {
        instructions: string;
        audio: { output: { voice: string } };
        tools: unknown[];
      };
    };
    expect(update.session.instructions).toBe('THE SAME PROMPT AS THE CHAT');
    expect(update.session.audio.output.voice).toBe('cedar');
    expect(update.session.tools.length).toBeGreaterThan(5);
    expect(openai.types()).toContain('response.create');

    // Caller audio goes to OpenAI; the AI's audio goes back to the phone.
    phone.push({
      event: 'media',
      media: { payload: 'AAAA', track: 'inbound' },
    });
    openai.push({ type: 'response.output_audio.delta', delta: 'BBBB' });
    await flush();
    expect(openai.sent).toContainEqual({
      type: 'input_audio_buffer.append',
      audio: 'AAAA',
    });
    expect(phone.sent).toContainEqual({
      event: 'media',
      streamSid: 'MZ',
      media: { payload: 'BBBB' },
    });
  });

  it("starts in the admin's language and lets the caller switch", async () => {
    const { phone, openai, deps } = setup('fr');
    phone.push({
      event: 'start',
      start: {
        streamSid: 'MZ',
        callSid: 'CA',
        customParameters: { token: 'good' },
      },
    });
    await flush();
    openai.emit('open');
    await flush();
    const [, extra] = deps.assistant.promptFor.mock.calls[0] as unknown as [
      unknown,
      { note: string },
    ];
    expect(extra.note).toContain('Speak French by default');
    expect(extra.note).toContain('If the caller speaks another language');
    const opening = openai.sent.find((e) => e.type === 'response.create') as {
      response: { instructions: string };
    };
    expect(opening.response.instructions).toMatch(/^In French:/);
  });

  it('runs tools like the chat, saves both sides, and lets the caller interrupt', async () => {
    const { phone, openai, deps, saved } = setup();
    phone.push({
      event: 'start',
      start: {
        streamSid: 'MZ',
        callSid: 'CA',
        customParameters: { token: 'good' },
      },
    });
    await flush();
    openai.emit('open');
    openai.push({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Send me my report',
    });
    openai.push({ type: 'response.created' });
    openai.push({
      type: 'response.function_call_arguments.done',
      call_id: 'c1',
      name: 'get_link',
      arguments: '{"type":"report"}',
    });
    await flush();
    expect(deps.tools.run).toHaveBeenCalledWith(
      'get_link',
      '{"type":"report"}',
      expect.objectContaining({
        scope: { customerId: 7, companyId: null },
        messageId: 1,
      }),
    );
    expect(openai.sent).toContainEqual({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: 'c1',
        output: '{"url":"https://x"}',
      },
    });
    openai.push({ type: 'response.done' });
    openai.push({
      type: 'response.output_audio_transcript.done',
      transcript: 'I texted you the link.',
    });
    await flush();
    expect(saved).toEqual([
      ['USER', 'Send me my report'],
      ['ASSISTANT', 'I texted you the link.'],
    ]);

    openai.push({ type: 'response.created' });
    openai.push({ type: 'input_audio_buffer.speech_started' });
    await flush();
    expect(phone.sent).toContainEqual({ event: 'clear', streamSid: 'MZ' });
    expect(openai.types()).toContain('response.cancel');

    phone.push({ event: 'stop' });
    await flush();
    expect(deps.calls.ended).toHaveBeenCalledWith(
      'CA',
      expect.objectContaining({ recordingSid: 'RE1', wav: null }),
    );
  });
  describe('while a tool runs', () => {
    async function started(
      spokeFirst: boolean,
    ): Promise<{ openai: FakeSocket; finish: () => void }> {
      const { phone, openai, deps } = setup();
      let finish = () => {};
      deps.tools.run.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () =>
              resolve({ content: '{"total":412}', action: undefined });
          }) as never,
      );
      phone.push({
        event: 'start',
        start: {
          streamSid: 'MZ',
          callSid: 'CA',
          customParameters: { token: 'good' },
        },
      });
      await flush();
      openai.emit('open');
      await flush();
      openai.sent = [];
      openai.push({ type: 'response.created' });
      if (spokeFirst)
        openai.push({ type: 'response.output_audio.delta', delta: 'BBBB' });
      openai.push({
        type: 'response.function_call_arguments.done',
        call_id: 'c1',
        name: 'search_transactions',
        arguments: '{}',
      });
      openai.push({ type: 'response.done' });
      await flush();
      return { openai, finish: () => finish() };
    }

    it('says "let me check" when the model went to a tool without a word', async () => {
      const { openai, finish } = await started(false);
      const filler = openai.sent.find((e) => e.type === 'response.create') as {
        response: { instructions: string; tool_choice: string };
      };
      expect(filler.response.instructions).toMatch(/let me check/i);
      expect(filler.response.tool_choice).toBe('none');

      // The answer waits for the filler to finish AND the tool to return.
      openai.push({ type: 'response.created' });
      finish();
      await flush();
      expect(
        openai.types().filter((t) => t === 'response.create'),
      ).toHaveLength(1);
      openai.push({ type: 'response.done' });
      await flush();
      expect(openai.sent.slice(-2)).toEqual([
        {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: 'c1',
            output: '{"total":412}',
          },
        },
        { type: 'response.create' },
      ]);
    });

    it('adds nothing when the model already said something', async () => {
      const { openai, finish } = await started(true);
      expect(openai.types()).not.toContain('response.create');
      finish();
      await flush();
      expect(openai.sent.at(-1)).toEqual({ type: 'response.create' });
    });
  });

  // step12h: a note from outside the call (the strong AI's result, a prospect's text).
  it('hands a live note to the agent only once it is quiet, and forgets the call when it ends', async () => {
    const { phone, openai } = setup();
    phone.push({
      event: 'start',
      start: {
        streamSid: 'MZ',
        callSid: 'CA',
        customParameters: { token: 'good' },
      },
    });
    await flush();
    openai.emit('open');
    await flush();
    openai.push({ type: 'response.created' });
    await flush();
    openai.sent = [];

    expect(liveCalls.toConversation(3, '[Specialist result: redo it]')).toBe(
      true,
    );
    expect(openai.sent).toEqual([]); // the greeting is still being spoken

    openai.push({ type: 'response.done' });
    await flush();
    expect(openai.sent).toEqual([
      {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: '[Specialist result: redo it]' },
          ],
        },
      },
      { type: 'response.create' },
    ]);

    phone.close();
    await flush();
    expect(liveCalls.toConversation(3, 'too late')).toBe(false);
  });
});
