import type { PrismaService } from '../prisma/prisma.service';
import { CHANNELS } from '../assistant/assistant-prompt';
import { toolsFor, WRITE_TOOL_NAMES } from '../assistant/assistant-tools';
import {
  cleanSummary,
  DEDUPE_MS,
  doneTarget,
  featureDoneText,
  saveFeatureRequest,
  SUMMARY_MAX,
} from './feature-requests.store';

const scope = { customerId: 7, bookId: 3, companyId: null };

function prismaMock(recent: { id: number; summary: string } | null) {
  const findFirst = jest
    .fn<Promise<typeof recent>, [{ where: Record<string, unknown> }]>()
    .mockResolvedValue(recent);
  const create = jest
    .fn()
    .mockImplementation(({ data }: { data: { summary: string } }) =>
      Promise.resolve({ id: 99, summary: data.summary }),
    );
  const prisma = {
    featureRequest: { findFirst, create },
  } as unknown as PrismaService;
  return { prisma, findFirst, create };
}

describe('request_feature tool (step12e)', () => {
  it('is offered on every channel and counted as a write', () => {
    for (const channel of CHANNELS) {
      expect(toolsFor(channel).map((t) => t.name)).toContain('request_feature');
    }
    expect(WRITE_TOOL_NAMES.has('request_feature')).toBe(true);
  });
});

describe('saveFeatureRequest', () => {
  const input = {
    scope,
    conversationId: 12,
    channel: 'BOT',
    messageId: 40,
    request: 'Can you file my GST return for me?',
    summary: 'File GST returns',
  };

  it('creates a row with the customer, book and conversation', async () => {
    const { prisma, create } = prismaMock(null);
    const saved = await saveFeatureRequest(prisma, input);
    expect(saved).toEqual({ id: 99, summary: 'File GST returns' });
    const [arg] = create.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(arg.data).toMatchObject({
      customerId: 7,
      bookId: 3,
      conversationId: 12,
      messageId: 40,
      channel: 'BOT',
    });
  });

  it('returns the OPEN request from the same conversation instead of a second one', async () => {
    const { prisma, findFirst, create } = prismaMock({ id: 5, summary: 'x' });
    const now = new Date('2026-10-23T12:00:00Z');
    expect(await saveFeatureRequest(prisma, input, now)).toEqual({
      id: 5,
      summary: 'x',
    });
    expect(create).not.toHaveBeenCalled();
    const { where } = findFirst.mock.calls[0][0];
    expect(where).toMatchObject({ conversationId: 12, status: 'OPEN' });
    expect(where.createdAt).toEqual({
      gte: new Date(now.getTime() - DEDUPE_MS),
    });
  });

  it('falls back to the request text when the title is blank', async () => {
    const { prisma } = prismaMock(null);
    const saved = await saveFeatureRequest(prisma, { ...input, summary: '  ' });
    expect(saved.summary).toBe('Can you file my GST return for me?');
  });
});

describe('feature request helpers', () => {
  it('cleanSummary folds whitespace and clips to the column', () => {
    expect(cleanSummary('  a\n b  ')).toBe('a b');
    expect(cleanSummary('x'.repeat(500))).toHaveLength(SUMMARY_MAX);
  });

  it('featureDoneText includes the staff note only when there is one', () => {
    expect(featureDoneText('GST filing', null)).toContain('GST filing.');
    expect(featureDoneText('GST filing', ' See the Taxes tab. ')).toMatch(
      /GST filing\. See the Taxes tab\.$/,
    );
  });

  it('doneTarget texts back the phone that asked, else uses the preferred contact', () => {
    const email = { channel: 'EMAIL', to: 'a@b.c' };
    expect(
      doneTarget({ channel: 'SMS', peer: '+15145550000' }, true, email),
    ).toEqual({
      channel: 'SMS',
      to: '+15145550000',
    });
    expect(
      doneTarget({ channel: 'SMS', peer: '+15145550000' }, false, email),
    ).toEqual({
      channel: 'EMAIL',
      to: 'a@b.c',
    });
    expect(
      doneTarget({ channel: 'WHATSAPP', peer: '+1514' }, true, email),
    ).toEqual({
      channel: 'EMAIL',
      to: 'a@b.c',
    });
    expect(
      doneTarget({ channel: 'BOT', peer: null }, true, {
        channel: null,
        to: null,
      }),
    ).toBeNull();
  });
});
