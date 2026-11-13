import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AttachmentsService } from './attachments.service';

/** step2 (2026-11-13): a picture is stored cleaned up, with the original kept beside it. */
describe('AttachmentsService.upload — the picture clean-up pass', () => {
  const scope = { customerId: 5, bookId: 9, companyId: null } as never;
  const dir = mkdtempSync(join(tmpdir(), 'pic-upload-'));
  const staged = (name: string, bytes: string) => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return { originalname: name, path, size: bytes.length } as Express.Multer.File;
  };

  function setup(clean: Buffer | null) {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      transactionAttachment: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: created.length };
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const storage = {
      configured: true,
      putFile: jest.fn().mockResolvedValue(undefined),
      putBuffer: jest.fn().mockResolvedValue(undefined),
    };
    const pictures = {
      handles: (mime: string) => mime.startsWith('image/'),
      enhance: jest.fn().mockResolvedValue(clean),
    };
    const svc = new AttachmentsService(
      prisma as never,
      storage as never,
      { configured: true } as never,
      { processSoon: jest.fn() } as never,
      undefined,
      undefined,
      pictures as never,
    );
    return { svc, storage, created };
  }

  it('stores the cleaned picture at the key and the original beside it', async () => {
    const { svc, storage, created } = setup(Buffer.from('clean!'));
    await svc.upload(scope, [staged('receipt.jpg', 'raw-bytes')], null).catch(() => undefined);
    const keys = storage.putBuffer.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(keys).toHaveLength(2);
    const [originalKey, key] = keys;
    expect(originalKey).toBe(key.replace(/\.jpg$/, '-original.jpg'));
    expect(storage.putBuffer.mock.calls[0][1].toString()).toBe('raw-bytes');
    expect(storage.putBuffer.mock.calls[1][1].toString()).toBe('clean!');
    expect(storage.putFile).not.toHaveBeenCalled();
    expect(created[0]).toMatchObject({ storageKey: key, originalStorageKey: originalKey, size: 6 });
  });

  it('a PDF — or a picture the pass could not handle — is stored as sent', async () => {
    const { svc, storage, created } = setup(null);
    await svc
      .upload(scope, [staged('statement.pdf', '%PDF'), staged('photo.png', 'png')], null)
      .catch(() => undefined);
    expect(storage.putBuffer).not.toHaveBeenCalled();
    expect(storage.putFile).toHaveBeenCalledTimes(2);
    expect(created.map((c) => c.originalStorageKey)).toEqual([null, null]);
  });
});
