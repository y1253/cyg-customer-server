import type { ConfigService } from '@nestjs/config';
import { AttachmentStatus } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import type { ChatRequest, OpenAiClient } from '../ai/openai.client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import {
  AttachmentExtractor,
  tooThin,
  UnreadableAttachmentError,
  type AttachmentReading,
} from './attachment-extractor';
import { chequeNumberOnlyMatch } from './attachment-match.util';
import {
  AttachmentProcessorService,
  ONE_CHEQUE_HINT,
  withOcrChequeNumber,
} from './attachment-processor.service';
import { chequeRegions } from './cheque-split';
import { cropImage } from './crop';
import type { NameMemoryService } from './name-memory.service';
import { pageContents } from './page-content.util';
import { itemImages } from './pdf-images';
import { DocumentPipeline, type Prepared } from './pipeline/document-pipeline';
import type { OcrService } from './pipeline/ocr.service';
import type { OcrLine, OcrResult } from './pipeline/ocr.util';
import { pdfPageTexts } from './pipeline/pdf-text';
import type { ProductMemoryService } from './product-memory.service';
import type { SplitsService } from './splits.service';
import { showsItemImages, StatementExtractor } from './statement-extractor';
import { StatementImagesService } from './statement-images.service';

// mupdf (ESM + WASM) does not load under jest: everything that renders or reads a PDF is
// mocked here; the pure rules beside them stay real.
jest.mock('./cheque-split', () => ({ chequeRegions: jest.fn() }));
jest.mock('./crop', () => ({ cropImage: jest.fn() }));
jest.mock('./pipeline/pdf-text', () => ({
  ...jest.requireActual<object>('./pipeline/pdf-text'),
  pdfPageTexts: jest.fn(),
}));
jest.mock('./page-content.util', () => ({
  ...jest.requireActual<object>('./page-content.util'),
  pageContents: jest.fn(),
}));
jest.mock('./pdf-images', () => ({
  ...jest.requireActual<object>('./pdf-images'),
  itemImages: jest.fn(),
}));

const regions = chequeRegions as jest.MockedFunction<typeof chequeRegions>;
const crop = cropImage as jest.MockedFunction<typeof cropImage>;
const texts = pdfPageTexts as jest.MockedFunction<typeof pdfPageTexts>;
const contents = pageContents as jest.MockedFunction<typeof pageContents>;
const images = itemImages as jest.MockedFunction<typeof itemImages>;

const reading = (over: Partial<AttachmentReading> = {}): AttachmentReading => ({
  documentType: 'CHECK',
  kind: 'CHECK',
  vendor: null,
  date: '2026-10-01',
  subtotal: null,
  tax: null,
  total: 100,
  items: [],
  checkNumber: null,
  payee: 'Rona',
  memo: null,
  box: null,
  ...over,
});

const line = (
  text: string,
  x: number,
  y: number,
  confidence = 0.97,
): OcrLine => ({
  text,
  confidence,
  boxes: [{ text, confidence, x, y, width: text.length * 12, height: 28 }],
});
const ocr = (lines: OcrLine[]): OcrResult => ({
  text: lines.map((l) => l.text).join('\n'),
  confidence: 0.95,
  lines,
  width: 1000,
  height: 450,
});
const chequeOcr = (number: string, amount: string) =>
  ocr([
    line('ACME PLUMBING INC.', 30, 30),
    line(`No. ${number}`, 860, 30),
    line('Pay to the order of Rona Inc.', 30, 180),
    line(`$ ${amount}`, 820, 180),
    line(`⑈${number}⑈ ⑆12345⑉001⑆ 1234567⑈`, 180, 400, 0.9),
  ]);
const backOcr = ocr([
  line('ENDORSE HERE', 30, 30),
  line('For deposit only', 30, 90),
]);

const config = (env: Record<string, string> = {}) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

describe('step2: cheques are cut apart by CODE and each is read alone', () => {
  function setup(ocrs: Array<OcrResult | null>) {
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
      filename: 'stmt p3 #1.png',
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
    const read = jest.fn(
      (
        _file: Buffer,
        _name: string,
        _mime: string,
        _cls: string,
        _today: string,
        _message: string | null,
        _rules: string,
        prepared: Prepared | null,
      ) =>
        Promise.resolve([
          reading({
            checkNumber: prepared?.chequeNumber ? '9999' : null,
            total: 100,
          }),
        ]),
    );
    const extractor = {
      read,
      pick: jest.fn(),
    } as unknown as AttachmentExtractor;
    const ocrService = {
      enabled: () => true,
      read: jest.fn(),
    } as unknown as OcrService;
    const pipeline = new DocumentPipeline(ocrService, config());
    let n = 0;
    jest
      .spyOn(pipeline, 'readImage')
      .mockImplementation(() => Promise.resolve(ocrs[n++] ?? null));
    const prepare = jest.spyOn(pipeline, 'prepare');
    const service = new AttachmentProcessorService(
      prisma,
      storage,
      extractor,
      {} as SplitsService,
      {} as ProductMemoryService,
      {} as NameMemoryService,
      undefined,
      pipeline,
    );
    return { service, read, putBuffer, update, create, prepare };
  }

  beforeEach(() => {
    regions.mockReset();
    crop.mockReset();
  });

  it('two cheques in one image: two crops, each read on its own, with ONE_CHEQUE_HINT', async () => {
    regions.mockResolvedValue([
      { x0: 0, y0: 0, x1: 0.48, y1: 1 },
      { x0: 0.52, y0: 0, x1: 1, y1: 1 },
    ]);
    crop.mockResolvedValue([Buffer.from('one'), Buffer.from('two')]);
    const { service, read, putBuffer, create } = setup([
      chequeOcr('001042', '450.00'),
      chequeOcr('001043', '120.00'),
    ]);
    await service.sweep();
    const calls = read.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => String(c[0]))).toEqual(['one', 'two']);
    expect(calls.every((c) => c[6].endsWith(ONE_CHEQUE_HINT))).toBe(true);
    // The OCR's printed number replaces the AI's (each crop its own).
    expect(calls.map((c) => c[7]?.chequeNumber)).toEqual(['001042', '001043']);
    expect(
      (putBuffer.mock.calls as Array<[string, Buffer]>).map((c) =>
        String(c[1]),
      ),
    ).toEqual(['one', 'two']);
    expect(create).toHaveBeenCalledTimes(1); // the second cheque's sibling row
  });

  it("drops a cheque's BACK beside its front — one cheque, so the old path decides", async () => {
    regions.mockResolvedValue([
      { x0: 0, y0: 0, x1: 0.48, y1: 1 },
      { x0: 0.52, y0: 0, x1: 1, y1: 1 },
    ]);
    crop.mockResolvedValue([Buffer.from('front'), Buffer.from('back')]);
    const { service, read, prepare } = setup([
      chequeOcr('001042', '450.00'),
      backOcr,
    ]);
    await service.sweep();
    // Not split: the whole file is read once, through the pipeline.
    expect(read).toHaveBeenCalledTimes(1);
    expect(String(read.mock.calls[0][0])).toBe('whole');
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('no regions found: the file is read whole, the pipeline first', async () => {
    regions.mockResolvedValue([]);
    const { service, read, prepare } = setup([]);
    await service.sweep();
    expect(read).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png',
      'image',
    );
    expect(crop).not.toHaveBeenCalled();
  });
});

describe('step2: a cheque follows its NUMBER', () => {
  it("OCR's number replaces a different one the AI read", () => {
    const prepared = {
      source: 'OCR',
      ok: false,
      text: '',
      confidence: 0.9,
      reason: null,
      cheque: true,
      chequeNumber: '001042',
    } as Prepared;
    const r = withOcrChequeNumber(
      reading({
        checkNumber: '1047',
        pipeline: {
          source: 'OCR',
          model: 'vision',
          confidence: 0.9,
          reason: null,
        },
      }),
      prepared,
    );
    expect(r.checkNumber).toBe('001042');
    expect(r.pipeline?.ocrChequeNumber).toBe('001042');
    // The same number (zeros aside) is left alone; a receipt is never touched.
    expect(
      withOcrChequeNumber(reading({ checkNumber: '1042' }), prepared)
        .checkNumber,
    ).toBe('1042');
    expect(
      withOcrChequeNumber(
        reading({ kind: 'RECEIPT', checkNumber: null }),
        prepared,
      ).checkNumber,
    ).toBeNull();
  });

  it("matches the statement's ONE cheque row printing the number, whatever amount was read", () => {
    const row = (id: number, description: string, amount: number) => ({
      id,
      date: '2026-10-03',
      amount,
      name: null,
      description,
      attachedTotals: [],
    });
    const rows = [
      row(1, 'CHEQUE 1042', -450),
      row(2, 'CHEQUE 1043', -120),
      row(3, 'POS STORE #1042 MONTREAL', -1042), // not a cheque row
    ];
    expect(chequeNumberOnlyMatch('001042', rows)?.id).toBe(1);
    expect(chequeNumberOnlyMatch('1044', rows)).toBeNull();
    expect(
      chequeNumberOnlyMatch('1042', [...rows, row(4, 'CHQ#1042', -9)]),
    ).toBeNull(); // two rows print it: not sure
  });
});

describe('step2: the reader reads the pipeline TEXT first, the file when that is not enough', () => {
  const textReply = (doc: Partial<AttachmentReading>) =>
    JSON.stringify({
      documents: [
        {
          documentType: 'RECEIPT',
          summary: 'A receipt',
          kind: 'RECEIPT',
          vendor: 'Walmart',
          date: '2026-10-01',
          subtotal: null,
          tax: null,
          total: 26.85,
          items: [],
          checkNumber: null,
          payee: null,
          memo: null,
          category: null,
          box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 },
          ...doc,
        },
      ],
    });
  const prepared = (ok: boolean): Prepared => ({
    source: 'OCR',
    ok,
    text: 'WALMART\nTOTAL 26.85',
    confidence: 0.95,
    reason: ok ? null : 'low confidence 0.70',
    cheque: false,
    chequeNumber: null,
  });
  function extractor(answers: string[]) {
    let n = 0;
    const chat = jest.fn<Promise<string>, [ChatRequest]>(() =>
      Promise.resolve(answers[n++]),
    );
    return {
      chat,
      ex: new AttachmentExtractor(
        { chat } as unknown as OpenAiClient,
        config(),
      ),
    };
  }
  const read = (
    ex: AttachmentExtractor,
    cls: 'image' | 'sheet',
    p: Prepared | null,
  ) =>
    ex.read(
      Buffer.from('img'),
      'r.png',
      'image/png',
      cls,
      '2026-10-02',
      null,
      '',
      p,
    );

  it('good OCR: one call on the TEXT model, no image, box dropped', async () => {
    const { chat, ex } = extractor([textReply({})]);
    const [r] = await read(ex, 'image', prepared(true));
    expect(chat).toHaveBeenCalledTimes(1);
    const req = chat.mock.calls[0][0];
    expect(req.model).toBe('gpt-4.1-mini');
    expect(JSON.stringify(req.user)).not.toContain('image_url');
    expect(JSON.stringify(req.user)).toContain('TOTAL 26.85');
    expect(r.box).toBeNull();
    expect(r.pipeline).toMatchObject({ source: 'OCR', model: 'text' });
  });

  it('text that gives no amount or date: the vision model reads the file', async () => {
    const { chat, ex } = extractor([
      textReply({ total: null, date: null }),
      textReply({}),
    ]);
    const [r] = await read(ex, 'image', prepared(true));
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0].model).toBe('gpt-4o');
    expect(JSON.stringify(chat.mock.calls[1][0].user)).toContain('image_url');
    expect(r.pipeline).toMatchObject({
      model: 'vision',
      reason: 'its text was not enough',
    });
  });

  it('OCR unsure: the vision model, with the OCR text as a hint', async () => {
    const { chat, ex } = extractor([textReply({})]);
    const [r] = await read(ex, 'image', prepared(false));
    expect(chat).toHaveBeenCalledTimes(1);
    const user = JSON.stringify(chat.mock.calls[0][0].user);
    expect(user).toContain('image_url');
    expect(user).toContain('may be incomplete or misread');
    expect(r.pipeline).toMatchObject({
      model: 'vision',
      reason: 'low confidence 0.70',
    });
  });

  it('a spreadsheet nobody could open is refused, never sent to the vision model', async () => {
    const { chat, ex } = extractor([]);
    await expect(
      read(ex, 'sheet', { ...prepared(false), source: 'SHEET', text: '' }),
    ).rejects.toBeInstanceOf(UnreadableAttachmentError);
    expect(chat).not.toHaveBeenCalled();
  });

  it('a long spreadsheet is ONE document, never cut at the per-file cap', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      documentType: 'INVOICE',
      summary: `Bill ${i}`,
      kind: 'RECEIPT',
      vendor: 'Hydro',
      date: `2026-10-0${i + 1}`,
      subtotal: null,
      tax: null,
      total: 10 + i,
      items: [],
      checkNumber: null,
      payee: null,
      memo: null,
      category: null,
      box: null,
    }));
    const { ex } = extractor([JSON.stringify({ documents: rows })]);
    const sheet = { ...prepared(true), source: 'SHEET' as const };
    const out = await read(ex, 'sheet', sheet);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ documentType: 'DOCUMENT', total: null });
    expect(out[0].summary).toContain(
      '5 payments from 2026-10-01 to 2026-10-05',
    );
  });

  it('tooThin: only payment documents with neither amount nor date', () => {
    expect(tooThin([reading({ total: null, date: null })])).toBe(true);
    expect(tooThin([reading({ total: null })])).toBe(false);
    expect(
      tooThin([reading({ documentType: 'DOCUMENT', total: null, date: null })]),
    ).toBe(false);
  });
});

describe('step2: a re-read statement re-files its cheque image uncut', () => {
  it('writes the new image to the ORIGINAL key and drops the stale crop', async () => {
    images.mockResolvedValue([{ page: 2, index: 0, png: Buffer.from('new') }]);
    const putBuffer = jest.fn().mockResolvedValue(undefined);
    const del = jest.fn().mockResolvedValue(undefined);
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      transactionAttachment: {
        findUnique: jest.fn().mockResolvedValue({
          storageKey: 'k/crop.png',
          sourceStorageKey: 'k/orig.png',
        }),
        upsert,
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;
    const service = new StatementImagesService(
      prisma,
      { putBuffer, delete: del } as unknown as ObjectStorageService,
      { processSoon: jest.fn() } as unknown as AttachmentProcessorService,
    );
    await service.harvest(
      {
        id: 5,
        customerId: 7,
        bookId: 1,
        companyId: null,
        filename: 's.pdf',
        accountName: 'TD 1234',
        bankName: 'TD',
        periodStart: null,
        periodEnd: null,
      },
      Buffer.from('pdf'),
      [{ page: 2, hasRows: false }],
    );
    expect(putBuffer).toHaveBeenCalledWith(
      'k/orig.png',
      Buffer.from('new'),
      'image/png',
    );
    expect(del).toHaveBeenCalledWith('k/crop.png');
    const update = (
      upsert.mock.calls[0] as [{ update: Record<string, unknown> }]
    )[0].update;
    expect(update).toMatchObject({
      storageKey: 'k/orig.png',
      sourceStorageKey: null,
      mimeType: 'image/png',
      status: AttachmentStatus.PENDING,
    });
  });
});

describe('step2: a statement page is first read from its own text layer', () => {
  async function pdf(n: number): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage();
    return Buffer.from(await doc.save());
  }
  const page = JSON.stringify({
    isBankStatement: true,
    bankName: 'TD',
    accountName: 'TD 1234',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    openingBalance: null,
    closingBalance: null,
    totalDeposits: null,
    totalWithdrawals: null,
    depositCount: null,
    withdrawalCount: null,
    totalsScope: 'none',
    hasItemImages: true,
    transactions: [
      {
        pendingDate: null,
        postingDate: '2026-09-02',
        description: 'CHEQUE 1042',
        amount: -450,
        balanceAfter: null,
        offsetAccount: 'Rent',
      },
    ],
  });
  const textLayer =
    'TD Canada Trust   Business Chequing   Statement period Sep 1 - Sep 30, 2026\n' +
    'Sep 02   CHEQUE 1042          450.00              1,550.00';

  beforeEach(() => {
    texts.mockReset();
    contents.mockReset();
  });

  it('sends the text instead of the PDF; the cheque-image flag comes from code', async () => {
    texts.mockResolvedValue([textLayer, '']);
    contents.mockResolvedValue([
      { text: textLayer, images: [], bounds: [0, 0, 612, 792] },
      // page 2: a cheque image (a quarter of the page wide), no text layer
      { text: '', images: [[40, 100, 572, 330]], bounds: [0, 0, 612, 792] },
    ]);
    const chat = jest.fn<Promise<string>, [ChatRequest]>(() =>
      Promise.resolve(page),
    );
    const ex = new StatementExtractor(
      { chat } as unknown as OpenAiClient,
      config({ STATEMENT_TEXT_PIPELINE: '1' }),
    );
    const out = await ex.extract(await pdf(2), 's.pdf');
    const [first, second] = chat.mock.calls.map((c) => c[0]);
    // Page 1: its text, no PDF part. Page 2 (no text layer): the PDF, as before.
    expect(Array.isArray(first.user) && first.user).toHaveLength(1);
    expect(JSON.stringify(first.user)).toContain('CHEQUE 1042');
    expect(JSON.stringify(second.user)).toContain('application/pdf');
    // The model said page 1 shows images; code says it does not (no image on it).
    expect(out.imagePages.map((p) => p.page)).toEqual([1]);
  });

  it('off by default: every page is the PDF', async () => {
    texts.mockResolvedValue([textLayer]);
    const chat = jest.fn<Promise<string>, [ChatRequest]>(() =>
      Promise.resolve(page),
    );
    const ex = new StatementExtractor(
      { chat } as unknown as OpenAiClient,
      config(),
    );
    await ex.extract(await pdf(1), 's.pdf');
    expect(JSON.stringify(chat.mock.calls[0][0].user)).toContain(
      'application/pdf',
    );
    expect(texts).not.toHaveBeenCalled();
  });

  it('showsItemImages leaves out a background drawn over the whole page', () => {
    const bounds: [number, number, number, number] = [0, 0, 612, 792];
    expect(
      showsItemImages({ text: '', images: [[0, 0, 612, 792]], bounds }),
    ).toBe(false);
    expect(
      showsItemImages({ text: '', images: [[40, 100, 572, 330]], bounds }),
    ).toBe(true);
    expect(
      showsItemImages({ text: '', images: [[40, 100, 100, 130]], bounds }),
    ).toBe(false);
  });
});
