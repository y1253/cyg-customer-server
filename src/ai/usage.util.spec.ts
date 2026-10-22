import {
  costOf,
  isEmptyUsage,
  parseUsage,
  pricesFromLiteLlm,
  samePrices,
  type ModelPrices,
} from './usage.util';

const PRICES: ModelPrices = {
  inputPerMTok: 2,
  cachedInputPerMTok: 0.5,
  outputPerMTok: 8,
  audioInputPerMTok: null,
  audioOutputPerMTok: null,
  perMinute: null,
};

describe('parseUsage (step12 AI costs)', () => {
  it('reads chat completions usage with cached tokens', () => {
    const u = parseUsage('chat', {
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 400 },
    });
    expect(u).toEqual({
      input: 1000,
      cached: 400,
      output: 200,
      audioIn: 0,
      audioOut: 0,
      audioSeconds: 0,
    });
  });

  it('reads Responses API usage', () => {
    const u = parseUsage('responses', {
      input_tokens: 5000,
      input_tokens_details: { cached_tokens: 1000 },
      output_tokens: 300,
    });
    expect(u?.input).toBe(5000);
    expect(u?.cached).toBe(1000);
    expect(u?.output).toBe(300);
  });

  it('reads transcription usage, by tokens or by duration', () => {
    const t = parseUsage('transcribe', {
      type: 'tokens',
      input_tokens: 120,
      input_token_details: { text_tokens: 0, audio_tokens: 120 },
      output_tokens: 30,
    });
    expect(t?.audioIn).toBe(120);
    expect(t?.output).toBe(30);
    expect(
      parseUsage('transcribe', { type: 'duration', seconds: 90 })?.audioSeconds,
    ).toBe(90);
  });

  it('reads realtime usage, audio apart from text', () => {
    const u = parseUsage('realtime', {
      input_tokens: 900,
      output_tokens: 500,
      input_token_details: {
        text_tokens: 600,
        audio_tokens: 300,
        cached_tokens_details: { text_tokens: 200 },
      },
      output_token_details: { text_tokens: 100, audio_tokens: 400 },
    });
    expect(u).toEqual({
      input: 600,
      cached: 200,
      output: 100,
      audioIn: 300,
      audioOut: 400,
      audioSeconds: 0,
    });
  });

  it('is null without usage, and spots an empty one', () => {
    expect(parseUsage('chat', undefined)).toBeNull();
    expect(isEmptyUsage(parseUsage('chat', {})!)).toBe(true);
  });
});

describe('costOf', () => {
  it('prices cached input cheaper', () => {
    const u = parseUsage('chat', {
      prompt_tokens: 1_000_000,
      completion_tokens: 100_000,
      prompt_tokens_details: { cached_tokens: 500_000 },
    })!;
    // 500k × $2 + 500k × $0.5 + 100k × $8 = 1 + 0.25 + 0.8
    expect(costOf(PRICES, u)).toBe(2.05);
  });

  it('is null for a model with no price', () => {
    const none: ModelPrices = {
      inputPerMTok: null,
      cachedInputPerMTok: null,
      outputPerMTok: null,
      audioInputPerMTok: null,
      audioOutputPerMTok: null,
      perMinute: null,
    };
    expect(
      costOf(none, {
        input: 5,
        cached: 0,
        output: 5,
        audioIn: 0,
        audioOut: 0,
        audioSeconds: 0,
      }),
    ).toBeNull();
  });

  it('prices audio minutes', () => {
    const p = { ...PRICES, perMinute: 0.006 };
    expect(
      costOf(p, {
        input: 0,
        cached: 0,
        output: 0,
        audioIn: 0,
        audioOut: 0,
        audioSeconds: 120,
      }),
    ).toBe(0.012);
  });
});

describe('pricesFromLiteLlm', () => {
  const LIST = {
    'gpt-4o': {
      litellm_provider: 'openai',
      input_cost_per_token: 2.5e-6,
      output_cost_per_token: 1e-5,
      cache_read_input_token_cost: 1.25e-6,
    },
    'openai/gpt-realtime': {
      input_cost_per_token: 4e-6,
      output_cost_per_token: 1.6e-5,
      input_cost_per_audio_token: 3.2e-5,
      output_cost_per_audio_token: 6.4e-5,
    },
    whisper: { input_cost_per_second: 0.0001 },
  };

  it('converts per-token prices to per 1M tokens', () => {
    expect(pricesFromLiteLlm(LIST, 'gpt-4o')).toEqual({
      inputPerMTok: 2.5,
      cachedInputPerMTok: 1.25,
      outputPerMTok: 10,
      audioInputPerMTok: null,
      audioOutputPerMTok: null,
      perMinute: null,
    });
  });

  it('finds dated and provider-prefixed names', () => {
    expect(pricesFromLiteLlm(LIST, 'gpt-4o-2024-08-06')?.inputPerMTok).toBe(
      2.5,
    );
    expect(pricesFromLiteLlm(LIST, 'gpt-realtime')?.audioOutputPerMTok).toBe(
      64,
    );
    expect(pricesFromLiteLlm(LIST, 'whisper')?.perMinute).toBe(0.006);
  });

  it('is null for a model it does not list', () => {
    expect(pricesFromLiteLlm(LIST, 'gpt-6-astra')).toBeNull();
  });

  it('compares prices', () => {
    const a = pricesFromLiteLlm(LIST, 'gpt-4o')!;
    expect(samePrices(a, { ...a })).toBe(true);
    expect(samePrices(a, { ...a, outputPerMTok: 12 })).toBe(false);
  });
});
