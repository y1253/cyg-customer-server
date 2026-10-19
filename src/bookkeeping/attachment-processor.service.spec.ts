import { AttachmentStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import type {
  AttachmentExtractor,
  AttachmentReading,
} from './attachment-extractor';
import { AttachmentProcessorService } from './attachment-processor.service';
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

  function setup(companyId: number | null) {
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
    const prisma = {
      transactionAttachment: {
        findMany: jest.fn().mockResolvedValue([row]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      bankTransaction: { findMany: candidates },
    } as unknown as PrismaService;
    const storage = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.from('x')),
    } as unknown as ObjectStorageService;
    const extractor = {
      read: jest.fn().mockResolvedValue(reading),
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
    return { service, candidates };
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
});
