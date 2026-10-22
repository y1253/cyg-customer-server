/**
 * step12: AI cost tracking — the pure part. What OpenAI says a call used (each API words its
 * `usage` differently), what that costs at a model's prices, and the model's prices out of
 * LiteLLM's public price list (OpenAI has no pricing API). No clock, no database.
 */

/** One call's usage, normalised. Text and audio tokens are kept apart (priced apart). */
export interface UsageTokens {
  /** Text input tokens, cached ones included. */
  input: number;
  /** The part of `input` OpenAI served from its prompt cache (cheaper). */
  cached: number;
  output: number;
  audioIn: number;
  audioOut: number;
  /** Transcription billed by the minute. */
  audioSeconds: number;
}

/** A model's prices, USD per 1M tokens (`perMinute`: USD per audio minute). */
export interface ModelPrices {
  inputPerMTok: number | null;
  cachedInputPerMTok: number | null;
  outputPerMTok: number | null;
  audioInputPerMTok: number | null;
  audioOutputPerMTok: number | null;
  perMinute: number | null;
}

export type UsageKind = 'chat' | 'responses' | 'transcribe' | 'realtime';

const n = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

/**
 * The `usage` object of a response, normalised — null when there is none (an error reply,
 * or an API that did not report it).
 */
export function parseUsage(kind: UsageKind, raw: unknown): UsageTokens | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Obj;
  const zero: UsageTokens = {
    input: 0,
    cached: 0,
    output: 0,
    audioIn: 0,
    audioOut: 0,
    audioSeconds: 0,
  };
  if (kind === 'chat') {
    // { prompt_tokens, completion_tokens, prompt_tokens_details: { cached_tokens, audio_tokens },
    //   completion_tokens_details: { audio_tokens } }
    const inD = obj(u.prompt_tokens_details);
    const outD = obj(u.completion_tokens_details);
    const audioIn = n(inD.audio_tokens);
    const audioOut = n(outD.audio_tokens);
    return {
      ...zero,
      input: Math.max(0, n(u.prompt_tokens) - audioIn),
      cached: n(inD.cached_tokens),
      output: Math.max(0, n(u.completion_tokens) - audioOut),
      audioIn,
      audioOut,
    };
  }
  if (kind === 'responses') {
    // { input_tokens, input_tokens_details: { cached_tokens }, output_tokens }
    return {
      ...zero,
      input: n(u.input_tokens),
      cached: n(obj(u.input_tokens_details).cached_tokens),
      output: n(u.output_tokens),
    };
  }
  if (kind === 'transcribe') {
    // { type: 'tokens', input_tokens, input_token_details: { text_tokens, audio_tokens },
    //   output_tokens }  or  { type: 'duration', seconds }
    if (u.type === 'duration') return { ...zero, audioSeconds: n(u.seconds) };
    const d = obj(u.input_token_details);
    const audioIn =
      d.audio_tokens !== undefined ? n(d.audio_tokens) : n(u.input_tokens);
    return {
      ...zero,
      input: n(d.text_tokens),
      audioIn,
      output: n(u.output_tokens),
    };
  }
  // realtime `response.done`: { input_tokens, output_tokens,
  //   input_token_details: { text_tokens, audio_tokens, cached_tokens_details: { text_tokens } },
  //   output_token_details: { text_tokens, audio_tokens } }
  const inD = obj(u.input_token_details);
  const outD = obj(u.output_token_details);
  return {
    ...zero,
    input: n(inD.text_tokens),
    cached: Math.min(
      n(inD.text_tokens),
      n(obj(inD.cached_tokens_details).text_tokens),
    ),
    output: n(outD.text_tokens),
    audioIn: n(inD.audio_tokens),
    audioOut: n(outD.audio_tokens),
  };
}

/** True when the call used nothing worth a row. */
export function isEmptyUsage(u: UsageTokens): boolean {
  return !(u.input || u.output || u.audioIn || u.audioOut || u.audioSeconds);
}

/**
 * What the call cost in USD (6 decimals), or null when the model has no price yet. A
 * missing cached / audio price falls back to the plain input / output price.
 */
export function costOf(p: ModelPrices, u: UsageTokens): number | null {
  if (
    p.inputPerMTok === null &&
    p.outputPerMTok === null &&
    p.audioInputPerMTok === null &&
    p.perMinute === null
  ) {
    return null;
  }
  const inP = p.inputPerMTok ?? 0;
  const outP = p.outputPerMTok ?? 0;
  const cached = Math.min(u.cached, u.input);
  const usd =
    ((u.input - cached) * inP +
      cached * (p.cachedInputPerMTok ?? inP) +
      u.output * outP +
      u.audioIn * (p.audioInputPerMTok ?? inP) +
      u.audioOut * (p.audioOutputPerMTok ?? outP)) /
      1_000_000 +
    (u.audioSeconds / 60) * (p.perMinute ?? 0);
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** A LiteLLM entry (model_prices_and_context_window.json), the fields we read. */
interface LiteLlmEntry {
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  input_cost_per_audio_token?: number;
  output_cost_per_audio_token?: number;
  input_cost_per_second?: number;
}

const perM = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.round(v * 1_000_000 * 10_000) / 10_000
    : null;

/**
 * A model's prices out of the LiteLLM list, or null when it is not there. Tried in order:
 * the exact name, `openai/<name>`, then the name without a date suffix
 * ("gpt-4o-2024-08-06" → "gpt-4o").
 */
export function pricesFromLiteLlm(
  list: Record<string, unknown>,
  model: string,
): ModelPrices | null {
  const name = model.trim();
  const undated = name.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const candidates = [name, `openai/${name}`, undated, `openai/${undated}`];
  for (const key of candidates) {
    const e = list[key] as LiteLlmEntry | undefined;
    if (!e || typeof e !== 'object') continue;
    const prices: ModelPrices = {
      inputPerMTok: perM(e.input_cost_per_token),
      cachedInputPerMTok: perM(e.cache_read_input_token_cost),
      outputPerMTok: perM(e.output_cost_per_token),
      audioInputPerMTok: perM(e.input_cost_per_audio_token),
      audioOutputPerMTok: perM(e.output_cost_per_audio_token),
      perMinute:
        typeof e.input_cost_per_second === 'number'
          ? Math.round(e.input_cost_per_second * 60 * 1_000_000) / 1_000_000
          : null,
    };
    if (
      prices.inputPerMTok === null &&
      prices.outputPerMTok === null &&
      prices.perMinute === null
    ) {
      continue;
    }
    return prices;
  }
  return null;
}

/** Same prices? (Decimals come back from MySQL as strings with trailing zeros.) */
export function samePrices(a: ModelPrices, b: ModelPrices): boolean {
  const keys: Array<keyof ModelPrices> = [
    'inputPerMTok',
    'cachedInputPerMTok',
    'outputPerMTok',
    'audioInputPerMTok',
    'audioOutputPerMTok',
    'perMinute',
  ];
  return keys.every((k) => {
    const x = a[k];
    const y = b[k];
    if (x === null || y === null) return x === y;
    return Math.abs(x - y) < 1e-6;
  });
}
