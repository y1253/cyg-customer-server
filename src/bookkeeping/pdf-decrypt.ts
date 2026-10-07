import { UnreadableStatementError } from './statement-errors';

/**
 * Removes the encryption from a PDF that ANYONE can open — the usual shape of a bank
 * statement: an OWNER (permissions) password that restricts editing/copying, and an empty
 * USER (open) password. The pages are readable without a password, so reading them is
 * what the file allows; we just cannot hand pdf-lib an encrypted file, because pdf-lib
 * cannot decrypt at all (its `ignoreEncryption` flag only stops the throw — the page
 * content stays encrypted and the split pages come out as garbage).
 *
 * mupdf (Artifex's official WASM build) opens the file with the empty user password and
 * re-saves it decrypted. The result is used in memory only, to split and read the pages;
 * the original upload stays untouched in R2.
 *
 * A file that needs a password just to OPEN is refused: nobody can read it without that
 * password, and we never ask a customer for one.
 *
 * ⚠️ `mupdf` is ESM + WASM and this server compiles to CommonJS, so it is loaded with a real
 * dynamic `import()` (kept as-is under `module: nodenext`) — and only on this path, so an
 * unencrypted statement never loads the WASM at all.
 */
export async function decryptForReading(pdf: Buffer): Promise<Buffer> {
  const mupdf = await import('mupdf');
  let doc: InstanceType<typeof mupdf.Document> | null = null;
  try {
    doc = mupdf.Document.openDocument(pdf, 'application/pdf');
  } catch {
    throw new UnreadableStatementError(
      'This file could not be opened as a PDF.',
    );
  }
  try {
    if (doc.needsPassword()) {
      throw new UnreadableStatementError(
        'This PDF needs a password to open. Please upload a copy that opens without one ' +
          '(for example, open it and use Print → Save as PDF).',
      );
    }
    const pdfDoc = doc.asPDF();
    if (!pdfDoc)
      throw new UnreadableStatementError(
        'This file could not be opened as a PDF.',
      );
    return Buffer.from(pdfDoc.saveToBuffer('encrypt=none').asUint8Array());
  } finally {
    doc.destroy();
  }
}
