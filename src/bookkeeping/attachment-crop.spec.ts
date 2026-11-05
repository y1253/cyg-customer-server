import { AttachmentStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import type {
  AttachmentExtractor,
  AttachmentReading,
} from './attachment-extractor';
import {
  AttachmentProcessorService,
  customerNoteOf,
  readerHints,
  sniffImageMime,
} from './attachment-processor.service';
import { cropImage } from './crop';
import type { NameMemoryService } from './name-memory.service';
import type { ProductMemoryService } from './product-memory.service';
import type { SplitsService } from './splits.service';

jest.mock('./crop', () => ({ cropImage: jest.fn() }));

const cheque = (
  total: number,
  box: AttachmentReading['box'],
): AttachmentReading => ({
  documentType: 'CHECK',
  kind: 'CHECK',
  vendor: null,
  date: '2026-10-01',
  subtotal: null,
  tax: null,
  total,
  items: [],
  checkNumber: null,
  payee: null,
  memo: null,
  box,
});

/** step9: two cheques in one image become two files, each on its own row. */
describe('AttachmentProcessorService — one crop per document', () => {
  function setup(readings: AttachmentReading[]) {
    const row = {
      id: 11,
      customerId: 7,
      companyId: null,
      bookId: 1,
      transactionId: null,
      status: AttachmentStatus.PENDING,
      updatedAt: new Date(0),
      attempts: 0,
      mimeType: 'image/png',
      storageKey: 'bookkeeping/7/attachments/orig.png',
      sourceStorageKey: null,
      size: 1000,
      filename: 'stmt p3 #0.png',
      createdAt: new Date('2026-10-02T00:00:00Z'),
      message: null,
      source: 'STATEMENT',
      sourceRef: null,
      extracted: null,
      deletedAt: null,
    };
    const update = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...row, ...args.data }),
    );
    const create = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...row, ...args.data, id: 99 }),
    );
    const prisma = {
      transactionAttachment: {
        findMany: jest.fn((args: { where?: { sourceRef?: unknown } }) =>
          Promise.resolve(args?.where?.sourceRef ? [] : [row]),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update,
        create,
      },
      bankTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const putBuffer = jest.fn().mockResolvedValue(undefined);
    const storage = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.from('whole')),
      putBuffer,
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as ObjectStorageService;
    const read = jest.fn().mockResolvedValue(readings);
    const extractor = {
      read,
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
    return { service, update, create, putBuffer, read };
  }

  const crop = cropImage as jest.MockedFunction<typeof cropImage>;
  beforeEach(() => crop.mockReset());

  it('stores a crop for EACH document and keeps the whole image as the source', async () => {
    crop.mockResolvedValue([Buffer.from('one'), Buffer.from('two')]);
    const { service, update, create, putBuffer, read } = setup([
      cheque(100, { x0: 0, y0: 0, x1: 0.48, y1: 1 }),
      cheque(250, { x0: 0.52, y0: 0, x1: 1, y1: 1 }),
    ]);
    await service.sweep();
    // The reader is told the image came off a statement's cheque page.
    const readArgs = read.mock.calls as unknown[][];
    expect(readArgs[0][6]).toContain('cut out of a bank statement');
    expect(putBuffer).toHaveBeenCalledTimes(2);
    const puts = putBuffer.mock.calls as Array<[string, Buffer]>;
    expect(puts.map((c) => String(c[1]))).toEqual(['one', 'two']);
    const keys = puts.map((c) => c[0]);
    expect(new Set(keys).size).toBe(2);
    expect(keys).not.toContain('bookkeeping/7/attachments/orig.png');
    // Both rows point at their own crop, with the whole image kept as the source.
    const pointed = (
      update.mock.calls as Array<[{ data: Record<string, unknown> }]>
    )
      .map((c) => c[0].data)
      .filter((d) => d.sourceStorageKey);
    expect(pointed).toHaveLength(2);
    for (const d of pointed) {
      expect(d).toMatchObject({
        sourceStorageKey: 'bookkeeping/7/attachments/orig.png',
        mimeType: 'image/png',
      });
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(pointed.map((d) => d.storageKey)).toEqual(keys);
  });

  it('keeps the file whole when a document has no box', async () => {
    const { service, putBuffer, create } = setup([
      cheque(100, { x0: 0, y0: 0, x1: 0.48, y1: 1 }),
      cheque(250, null),
    ]);
    await service.sweep();
    expect(crop).not.toHaveBeenCalled();
    expect(putBuffer).not.toHaveBeenCalled();
    const [[made]] = create.mock.calls;
    expect(made.data).toMatchObject({
      storageKey: 'bookkeeping/7/attachments/orig.png',
    });
  });

  it('keeps the file whole when cutting fails', async () => {
    crop.mockRejectedValue(new Error('bad image'));
    const { service, putBuffer } = setup([
      cheque(100, { x0: 0, y0: 0, x1: 0.48, y1: 1 }),
      cheque(250, { x0: 0.52, y0: 0, x1: 1, y1: 1 }),
    ]);
    await service.sweep();
    expect(putBuffer).not.toHaveBeenCalled();
  });
});

describe('reader helpers (step9)', () => {
  it('knows an image by its first bytes', () => {
    expect(
      sniffImageMime(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toBe('image/png');
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(sniffImageMime(Buffer.from('hello'))).toBeNull();
  });

  it("carries the customer's note to the reader", () => {
    expect(customerNoteOf({ total: 1, customerNote: ' two cheques ' })).toBe(
      'two cheques',
    );
    expect(customerNoteOf(null)).toBeNull();
    expect(readerHints('UPLOAD', 'it is two cheques')).toContain(
      '"it is two cheques"',
    );
    expect(readerHints('UPLOAD', null)).toBe('');
  });
});
