import type { ConfigService } from '@nestjs/config';
import type { ToolContext } from '../assistant/assistant-tools';
import type { SignalWireClient } from '../messaging/signalwire.client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { VoiceCallsService } from './voice-calls.service';

/** step12b: the assistant's "call me now" (call_me) — only the customer's own phone, capped. */
describe('VoiceCallsService.callMeNow', () => {
  const ctx = {
    scope: { customerId: 5, companyId: null },
    messageId: 1,
  } as ToolContext;

  function build(
    opts: {
      phone?: string | null;
      enabled?: boolean;
      callsToday?: number;
      limit?: string;
    } = {},
  ) {
    const prisma = {
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.phone === null
              ? { phoneE164: null }
              : { phoneE164: opts.phone ?? '+15145551234' },
          ),
      },
      customerVoiceSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ enabled: opts.enabled ?? true }),
      },
      aiCall: { count: jest.fn().mockResolvedValue(opts.callsToday ?? 0) },
    };
    const env: Record<string, string> = {
      CUSTOMER_JWT_SECRET: 'test-secret',
      OPENAI_API_KEY: 'sk-test',
      ...(opts.limit !== undefined ? { AI_CALLS_PER_DAY: opts.limit } : {}),
    };
    const config = {
      get: (k: string) => env[k],
      getOrThrow: (k: string) => env[k],
    } as unknown as ConfigService;
    const service = new VoiceCallsService(
      prisma as unknown as PrismaService,
      config,
      { configured: true } as unknown as SignalWireClient,
      {} as ObjectStorageService,
    );
    const placed = jest
      .spyOn(service, 'callCustomer')
      .mockResolvedValue({ callSid: 'CA1' });
    return { service, prisma, placed };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls the account phone a few seconds later, about what they asked', async () => {
    const { service, placed } = build();
    const out = await service.callMeNow(ctx, 'the unmatched receipts');
    expect(out).toEqual({
      ok: true,
      summary: 'Calling the customer at the number ending 1234',
    });
    expect(placed).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    expect(placed).toHaveBeenCalledWith(
      expect.objectContaining({
        peer: '+15145551234',
        purpose: 'REQUESTED',
        scope: ctx.scope,
        script: expect.stringContaining('the unmatched receipts') as string,
      }),
    );
  });

  it('refuses with no phone, with calls off, and over the daily limit', async () => {
    expect(
      await build({ phone: null }).service.callMeNow(ctx, 'x'),
    ).toMatchObject({ ok: false });
    expect(
      await build({ enabled: false }).service.callMeNow(ctx, 'x'),
    ).toMatchObject({ ok: false });
    const capped = build({ callsToday: 5 });
    expect(await capped.service.callMeNow(ctx, 'x')).toMatchObject({
      ok: false,
      error: expect.stringContaining('limit') as string,
    });
    expect(
      await build({ callsToday: 5, limit: '6' }).service.callMeNow(ctx, 'x'),
    ).toMatchObject({ ok: true });
    jest.advanceTimersByTime(5000);
    expect(capped.placed).not.toHaveBeenCalled();
  });
});
