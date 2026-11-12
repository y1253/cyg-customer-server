import type { ItemImage } from './pdf-images';
import { StatementImagesService } from './statement-images.service';

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
