import type { ItemImage } from './pdf-images';
import { StatementImagesService, recutPages } from './statement-images.service';

// mupdf (ESM + WASM) does not load under jest: the cutting is mocked; what is checked is
// which cut images become attachments (step2, 2026-11-12).
const mockItemImages = jest.fn<Promise<ItemImage[]>, unknown[]>();
jest.mock('./pdf-images', () => ({
  itemImages: (...args: unknown[]) => mockItemImages(...args),
}));

const image = (
  index: number,
  caption: ItemImage['caption'] = null,
): ItemImage => ({
  page: 2,
  index,
  png: Buffer.from(`png${index}`),
  caption,
  withBack: false,
});

function setup(ocrText: string | null) {
  const upserts: string[] = [];
  const prisma = {
    transactionAttachment: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(({ where }: { where: { sourceRef: string } }) => {
        upserts.push(where.sourceRef);
        return Promise.resolve({});
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const storage = {
    putBuffer: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn(),
  };
  const attachments = { processSoon: jest.fn() };
  const pipeline = {
    readImage: jest.fn().mockResolvedValue(
      ocrText === null
        ? null
        : {
            text: ocrText,
            lines: [],
            width: 1000,
            height: 400,
            confidence: 0.9,
          },
    ),
  };
  const service = new StatementImagesService(
    prisma as never,
    storage as never,
    attachments as never,
    pipeline as never,
  );
  return { service, upserts, pipeline };
}

const statement = (accountKind: 'BANK' | 'CREDIT_CARD' | null) => ({
  id: 7,
  customerId: 1,
  bookId: 2,
  companyId: null,
  filename: 'x.pdf',
  accountName: 'TD 4496',
  bankName: 'TD',
  periodStart: null,
  periodEnd: null,
  accountKind,
});

describe('StatementImagesService.harvest', () => {
  beforeEach(() => mockItemImages.mockReset());

  it('never harvests a credit-card statement (Amex summary boxes are images)', async () => {
    mockItemImages.mockResolvedValue([image(0)]);
    const { service, upserts } = setup('Payments and Credits');
    await service.harvest(statement('CREDIT_CARD'), Buffer.from(''), [
      { page: 2, hasRows: true },
    ]);
    expect(mockItemImages).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
  });

  it('keeps a captioned cheque without asking the OCR', async () => {
    mockItemImages.mockResolvedValue([
      image(0, {
        text: 'CHEQUE # 00021 $2,318.08',
        number: '00021',
        amount: 2318.08,
      }),
    ]);
    const { service, upserts, pipeline } = setup(null);
    await service.harvest(statement('BANK'), Buffer.from(''), [
      { page: 2, hasRows: false },
    ]);
    expect(upserts).toEqual(['stmt:7:p3:1']);
    expect(pipeline.readImage).not.toHaveBeenCalled();
  });

  it('skips an image whose text is not a cheque, keeps one that is', async () => {
    mockItemImages.mockResolvedValue([image(0)]);
    const notCheque = setup(
      'Contact information for customer care 1-800-555-0100',
    );
    await notCheque.service.harvest(statement(null), Buffer.from(''), [
      { page: 2, hasRows: false },
    ]);
    expect(notCheque.upserts).toEqual([]);

    const cheque = setup('PAY TO THE ORDER OF Revenu Quebec  DOLLARS');
    await cheque.service.harvest(statement(null), Buffer.from(''), [
      { page: 2, hasRows: false },
    ]);
    expect(cheque.upserts).toEqual(['stmt:7:p3:1']);
  });
});

describe('recutPages', () => {
  it("takes the pages a statement's files came from; rows unless a cheque was read there", () => {
    expect(
      recutPages([
        { sourceRef: 'stmt:40:p4:1', extracted: { documentType: 'CHECK' } },
        { sourceRef: 'stmt:40:p4:2', extracted: { documentType: 'DOCUMENT' } },
        {
          sourceRef: 'stmt:40:p1:1',
          extracted: { documentType: 'BANK_STATEMENT' },
        },
        { sourceRef: 'stmt:40:p5:1', extracted: null },
        { sourceRef: 'doc:9:1', extracted: { documentType: 'CHECK' } },
      ]),
    ).toEqual([
      { page: 0, hasRows: true },
      { page: 3, hasRows: false },
      { page: 4, hasRows: true },
    ]);
  });
});

describe('StatementImagesService.recut', () => {
  const scope = { customerId: 1, bookId: 2, companyId: null };

  it('cuts the images again from the PDF and drops the old crops', async () => {
    mockItemImages.mockReset();
    mockItemImages.mockResolvedValue([
      image(0, {
        text: 'CHEQUE # 00021 $2,318.08',
        number: '00021',
        amount: 2318.08,
      }),
    ]);
    const deletes: unknown[] = [];
    const prisma = {
      bankStatement: {
        findFirst: jest.fn().mockResolvedValue({
          ...statement('BANK'),
          status: 'DONE',
          source: 'UPLOAD',
          storageKey: 'k.pdf',
        }),
      },
      transactionAttachment: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              sourceRef: 'stmt:7:p3:1',
              extracted: { documentType: 'CHECK', customerNote: 'x' },
            },
          ])
          .mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          storageKey: 'crop.png',
          sourceStorageKey: 'page.png',
          extracted: { customerNote: 'payee is Revenu Quebec' },
        }),
        upsert: jest.fn().mockResolvedValue({ id: 382 }),
        updateMany: jest.fn((args: unknown) => {
          deletes.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const storage = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      putBuffer: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new StatementImagesService(
      prisma as never,
      storage as never,
      { processSoon: jest.fn() } as never,
      undefined,
    );
    await expect(service.recut(scope, 7)).resolves.toBe(true);
    expect(mockItemImages).toHaveBeenCalledWith(Buffer.from('pdf'), [
      { page: 2, hasRows: false },
    ]);
    // Written over the uncut image, the old crop removed, the note kept.
    expect(storage.putBuffer).toHaveBeenCalledWith(
      'page.png',
      expect.anything(),
      'image/png',
    );
    expect(storage.delete).toHaveBeenCalledWith('crop.png');
    const upsert = (
      prisma.transactionAttachment.upsert.mock.calls[0] as [
        { update: { extracted: unknown; filename: string } },
      ]
    )[0];
    expect(upsert.update.extracted).toEqual({
      customerNote: 'payee is Revenu Quebec',
    });
    expect(upsert.update.filename).toMatch(/cheque 00021\.png$/);
    // The old documents read off it go.
    expect(deletes).toContainEqual(
      expect.objectContaining({
        where: { sourceRef: { startsWith: 'doc:382:' }, deletedAt: null },
      }),
    );
  });

  it('refuses a statement that is gone or unread', async () => {
    const prisma = {
      bankStatement: { findFirst: jest.fn().mockResolvedValue(null) },
      transactionAttachment: {},
    };
    const service = new StatementImagesService(
      prisma as never,
      {} as never,
      {} as never,
      undefined,
    );
    await expect(service.recut(scope, 7)).resolves.toBe(false);
  });
});
