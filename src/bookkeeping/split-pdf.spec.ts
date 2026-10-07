import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import { splitPdf, UnreadableStatementError } from './statement-extractor';

/** Encrypted with mupdf: owner password only (opens freely) / an open password too. */
const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name));

async function plainPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

describe('splitPdf and encrypted statements', () => {
  it('does not decrypt an ordinary PDF', async () => {
    const decrypt = jest.fn();
    const chunks = await splitPdf(await plainPdf(3), 1, decrypt);
    expect(chunks).toHaveLength(3);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('decrypts a statement with only an editing password, then splits it (the reported bug)', async () => {
    const decrypted = await plainPdf(2);
    const decrypt = jest.fn().mockResolvedValue(decrypted);
    const chunks = await splitPdf(fixture('owner-only.pdf'), 1, decrypt);
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveLength(2);
  });

  it('passes on the "needs a password to open" refusal', async () => {
    const decrypt = jest
      .fn()
      .mockRejectedValue(
        new UnreadableStatementError('This PDF needs a password to open.'),
      );
    await expect(
      splitPdf(fixture('open-password.pdf'), 1, decrypt),
    ).rejects.toThrow('needs a password to open');
  });

  it('calls a non-PDF unreadable without trying to decrypt', async () => {
    const decrypt = jest.fn();
    await expect(
      splitPdf(Buffer.from('not a pdf'), 1, decrypt),
    ).rejects.toBeInstanceOf(UnreadableStatementError);
    expect(decrypt).not.toHaveBeenCalled();
  });
});
