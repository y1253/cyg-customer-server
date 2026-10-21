import { AttachmentStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import type {
  AttachmentExtractor,
  AttachmentReading,
} from './attachment-extractor';
import {
  AttachmentProcessorService,
  kindFor,
  siblingName,
  siblingOf,
  siblingRef,
} from './attachment-processor.service';
import type { NameMemoryService } from './name-memory.service';
import type { ProductMemoryService } from './product-memory.service';
import type { SplitsService } from './splits.service';

/**
 * A queued attachment is matched in its OWN book (step8): a company's receipt must only
 * ever be compared with that company's transactions — never the customer's general book
 * or another of their companies.
 */
describe('AttachmentProcessorService — book scope', () => {
  const reading: AttachmentReading = {
    kind: 'RECEIPT',
    vendor: 'Walmart',
    date: '2026-10-01',
    subtotal: null,
    tax: null,
    total: 12.5,
    items: [],
    checkNumber: null,
    payee: null,
    memo: null,
  };

  function setup(
    companyId: number | null,
    readings: AttachmentReading[] = [reading],
  ) {
    const row = {
      id: 11,
      customerId: 7,
      companyId,
      transactionId: null,
      status: AttachmentStatus.PENDING,
      updatedAt: new Date(0),
      attempts: 0,
      mimeType: 'image/jpeg',
      storageKey: 'k',
      filename: 'r.jpg',
      createdAt: new Date('2026-10-02T00:00:00Z'),
      message: null,
      sourceRef: null,
      deletedAt: null,
    };
    const candidates = jest.fn().mockResolvedValue([]);
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...row, ...args.data, id: 99 }),
    );
    const prisma = {
      transactionAttachment: {
        // The queue sweep gets the row; the sibling lookup (`sourceRef`) finds none yet.
        findMany: jest.fn((args: { where?: { sourceRef?: unknown } }) =>
          Promise.resolve(args?.where?.sourceRef ? [] : [row]),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update,
        create,
      },
      bankTransaction: { findMany: candidates },
    } as unknown as PrismaService;
    const storage = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.from('x')),
    } as unknown as ObjectStorageService;
    const extractor = {
      read: jest.fn().mockResolvedValue(readings),
      pick: jest.fn(),
    } as unknown as AttachmentExtractor;
    const service = new AttachmentProcessorService(
      prisma,
      storage,
      extractor,
      {} as SplitsService,
      {} as ProductMemoryService,
      {} as NameMemoryService,
    );
    return { service, candidates, update, create };
  }

  it.each([null, 3])(
    'searches only the transactions of the row’s book (companyId %p)',
    async (companyId) => {
      const { service, candidates } = setup(companyId);
      await service.sweep();
      expect(candidates).toHaveBeenCalled();
      for (const [args] of candidates.mock.calls as Array<
        [{ where: unknown }]
      >) {
        expect(args.where).toMatchObject({ customerId: 7, companyId });
      }
    },
  );

  it('keeps a letter or a request as a DOCUMENT and never matches it', async () => {
    const { service, candidates, update } = setup(null, [
      {
        ...reading,
        documentType: 'DOCUMENT',
        summary: 'A letter from the CRA about your GST return',
        total: null,
      },
    ]);
    await service.sweep();
    expect(candidates).not.toHaveBeenCalled();
    const [[first]] = update.mock.calls as Array<[{ data: unknown }]>;
    expect(first.data).toMatchObject({
      status: AttachmentStatus.DOCUMENT,
      kind: 'DOCUMENT',
      matchNote: 'A letter from the CRA about your GST return',
    });
  });

  it('files the second cheque of one photo as its own row, matched on its own', async () => {
    const cheque = (total: number): AttachmentReading => ({
      ...reading,
      documentType: 'CHECK',
      kind: 'CHECK',
      total,
    });
    const { service, update, create } = setup(null, [cheque(100), cheque(250)]);
    await service.sweep();
    expect(create).toHaveBeenCalledTimes(1);
    const [[made]] = create.mock.calls;
    expect(made.data).toMatchObject({
      sourceRef: 'doc:11:1',
      storageKey: 'k',
      filename: 'r.jpg (2 of 2)',
    });
    const totals = (
      update.mock.calls as Array<[{ data: { extracted?: { total?: number } } }]>
    ).map((c) => c[0].data.extracted?.total);
    // Each row keeps its OWN amount — the two are never added together.
    expect(totals).toEqual([100, 250]);
  });
});

describe('attachment siblings', () => {
  it('round-trips a sibling reference', () => {
    expect(siblingOf(siblingRef(12, 2))).toEqual({ rowId: 12, index: 2 });
    expect(siblingOf('stmt:4:p1:0')).toBeNull();
    expect(siblingOf(null)).toBeNull();
    expect(siblingName('a.jpg', 1, 3)).toBe('a.jpg (2 of 3)');
  });

  it('stores what a file IS as its kind', () => {
    const r = (documentType: AttachmentReading['documentType']) =>
      ({ kind: 'OTHER', documentType }) as AttachmentReading;
    expect(kindFor('image', r('INVOICE'))).toBe('INVOICE');
    expect(kindFor('image', r('DOCUMENT'))).toBe('DOCUMENT');
    expect(kindFor('image', r('PAYMENT_NOTE'))).toBe('RECEIPT');
    expect(kindFor('audio', r('DOCUMENT'))).toBe('AUDIO');
    expect(kindFor('text', r('RECEIPT'))).toBe('TEXT');
  });
});
