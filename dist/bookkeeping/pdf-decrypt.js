"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptForReading = decryptForReading;
const statement_errors_1 = require("./statement-errors");
async function decryptForReading(pdf) {
    const mupdf = await import('mupdf');
    let doc = null;
    try {
        doc = mupdf.Document.openDocument(pdf, 'application/pdf');
    }
    catch {
        throw new statement_errors_1.UnreadableStatementError('This file could not be opened as a PDF.');
    }
    try {
        if (doc.needsPassword()) {
            throw new statement_errors_1.UnreadableStatementError('This PDF needs a password to open. Please upload a copy that opens without one ' +
                '(for example, open it and use Print → Save as PDF).');
        }
        const pdfDoc = doc.asPDF();
        if (!pdfDoc)
            throw new statement_errors_1.UnreadableStatementError('This file could not be opened as a PDF.');
        return Buffer.from(pdfDoc.saveToBuffer('encrypt=none').asUint8Array());
    }
    finally {
        doc.destroy();
    }
}
//# sourceMappingURL=pdf-decrypt.js.map