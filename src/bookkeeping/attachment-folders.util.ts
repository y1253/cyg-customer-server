/**
 * Which bank-account folder an attachment is filed under on the Attachments tab (step8):
 * the account of the statement its transaction is on — the customer's own filing
 * (`accountNameByCustomer`, set by dragging a statement to a folder) over the AI's reading
 * (`accountName`). Null = not matched to a transaction yet ("Not matched yet").
 *
 * ⚠️ Twin: `internal/server/src/company-files/company-files.util.ts` applies the same rule
 * for the staff app's Attachments folder. The two must agree, or a file sits in a different
 * folder for the firm than for the customer.
 */
export function attachmentFolder(
  transaction: {
    statement: {
      accountName: string | null;
      accountNameByCustomer: string | null;
    };
  } | null,
): string | null {
  if (!transaction) return null;
  const s = transaction.statement;
  return s.accountNameByCustomer?.trim() || s.accountName?.trim() || null;
}
