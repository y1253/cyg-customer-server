import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 60_000;

export interface SwRecording {
  sid: string;
  callSid: string | null;
  durationSec: number | null;
  status: string;
}

export interface SwCallInfo {
  sid: string;
  status: string;
  durationSec: number | null;
}

/** A field of SignalWire's JSON as a string, else null. */
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * step12: the few SignalWire Compatibility-API calls the customer API makes for AI phone
 * calls — place a call (inline LaML), record a live one, read its recordings, fetch the
 * audio (proxied: SignalWire serves recordings WITHOUT auth, so the URL must never reach a
 * browser — the internal `phone/recordings` docblock), hang up. Form-encoded requests,
 * Basic auth with the project id + API token (the same keys the internal app uses).
 */
@Injectable()
export class SignalWireClient {
  private readonly logger = new Logger(SignalWireClient.name);

  constructor(private readonly config: ConfigService) {}

  private env(key: string): string | null {
    return this.config.get<string>(key)?.trim() || null;
  }

  get configured(): boolean {
    return !!(
      this.env('SIGNALWIRE_PROJECT_ID') &&
      this.env('SIGNALWIRE_API_TOKEN') &&
      this.env('SIGNALWIRE_SPACE_URL')
    );
  }

  private base(): string {
    const space = this.env('SIGNALWIRE_SPACE_URL')!
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    return `https://${space}/api/laml/2010-04-01/Accounts/${this.env('SIGNALWIRE_PROJECT_ID')!}`;
  }

  private auth(): string {
    return `Basic ${Buffer.from(
      `${this.env('SIGNALWIRE_PROJECT_ID')!}:${this.env('SIGNALWIRE_API_TOKEN')!}`,
    ).toString('base64')}`;
  }

  private async request(
    label: string,
    path: string,
    init: {
      method: 'GET' | 'POST';
      form?: Record<string, string | undefined>;
      query?: Record<string, string | undefined>;
    },
  ): Promise<Record<string, unknown>> {
    if (!this.configured) throw new Error('SignalWire is not configured');
    const url = new URL(this.base() + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v) url.searchParams.set(k, v);
    }
    let body: string | undefined;
    if (init.form) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(init.form)) if (v) params.set(k, v);
      body = params.toString();
    }
    const res = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: this.auth(),
        Accept: 'application/json',
        ...(body
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.warn(`${label} ${res.status}: ${text.slice(0, 300)}`);
      throw new Error(
        `SignalWire ${label} ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    try {
      return (JSON.parse(text) ?? {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /**
   * Places a call that runs `laml` once answered. `record` = a dual-channel recording of
   * the whole call, kept by SignalWire like every staff call.
   */
  async createCall(input: {
    to: string;
    from: string;
    laml: string;
    statusCallback?: string | null;
    record?: boolean;
    timeoutSec?: number;
  }): Promise<string> {
    const data = await this.request(
      `createCall to=${mask(input.to)}`,
      '/Calls',
      {
        method: 'POST',
        form: {
          To: input.to,
          From: input.from,
          Laml: input.laml,
          StatusCallback: input.statusCallback ?? undefined,
          StatusCallbackMethod: input.statusCallback ? 'POST' : undefined,
          Timeout: String(input.timeoutSec ?? 30),
          Record: input.record ? 'true' : undefined,
          RecordingChannels: input.record ? 'dual' : undefined,
        },
      },
    );
    const sid = str(data.sid);
    if (!sid) throw new Error('SignalWire returned no call sid');
    return sid;
  }

  /** Starts recording a live call (both sides). The recording's sid, or null when refused. */
  async startRecording(callSid: string): Promise<string | null> {
    try {
      const data = await this.request(
        `startRecording ${callSid}`,
        `/Calls/${encodeURIComponent(callSid)}/Recordings`,
        { method: 'POST', form: { RecordingChannels: 'dual' } },
      );
      return str(data.sid);
    } catch {
      return null;
    }
  }

  async getCall(callSid: string): Promise<SwCallInfo | null> {
    try {
      const d = await this.request(
        `getCall ${callSid}`,
        `/Calls/${encodeURIComponent(callSid)}`,
        { method: 'GET' },
      );
      const sid = str(d.sid);
      return sid
        ? { sid, status: str(d.status) ?? '', durationSec: num(d.duration) }
        : null;
    } catch {
      return null;
    }
  }

  async listRecordings(callSid: string): Promise<SwRecording[]> {
    try {
      const d = await this.request(`listRecordings ${callSid}`, '/Recordings', {
        method: 'GET',
        query: { CallSid: callSid, PageSize: '20' },
      });
      const list = Array.isArray(d.recordings) ? d.recordings : [];
      return list.flatMap((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        const sid = str(r.sid);
        return sid
          ? [
              {
                sid,
                callSid: str(r.call_sid),
                durationSec: num(r.duration),
                status: str(r.status) ?? '',
              },
            ]
          : [];
      });
    } catch {
      return [];
    }
  }

  /** The recording's mp3 (proxied to the customer — never its public URL). */
  async fetchRecording(sid: string): Promise<Buffer> {
    const res = await fetch(
      `${this.base()}/Recordings/${encodeURIComponent(sid)}.mp3`,
      {
        headers: { Authorization: this.auth() },
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`recording ${sid}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Ends a live call (best effort). */
  async hangup(callSid: string): Promise<void> {
    try {
      await this.request(
        `hangup ${callSid}`,
        `/Calls/${encodeURIComponent(callSid)}`,
        {
          method: 'POST',
          form: { Status: 'completed' },
        },
      );
    } catch {
      // already over
    }
  }
}

function mask(phone: string): string {
  return phone.length > 8 ? `${phone.slice(0, 5)}***${phone.slice(-4)}` : '***';
}
