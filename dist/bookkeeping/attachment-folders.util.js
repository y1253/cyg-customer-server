"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachmentFolder = attachmentFolder;
function attachmentFolder(transaction) {
    if (!transaction)
        return null;
    const s = transaction.statement;
    return s.accountNameByCustomer?.trim() || s.accountName?.trim() || null;
}
//# sourceMappingURL=attachment-folders.util.js.map