/**
 * The words of a book's scheduled messages (step11b) — pure, so what a customer receives
 * is tested without sending anything.
 */

/** What is still open in a book, for the weekly Account Status Overview. */
export interface AccountStatus {
  /** Files (receipts, cheques…) we could not match to a transaction, or could not read. */
  unmatchedFiles: number;
  /** Letters / requests / screenshots kept as documents since the last overview. */
  newDocuments: number;
  /** Transactions still filed under Uncategorized. */
  uncategorized: number;
  /** Payee descriptions with no recognised name (the Names tab's "Unrecognized"). */
  unrecognizedNames: number;
  /** Statements we could not read, or whose figures did not add up. */
  statementsToReview: number;
  /** Statements uploaded but not generated yet. */
  statementsWaiting: number;
}

/** Nothing for the customer to do? Then no overview is sent. */
export const nothingOpen = (s: AccountStatus): boolean =>
  !s.unmatchedFiles &&
  !s.newDocuments &&
  !s.uncategorized &&
  !s.unrecognizedNames &&
  !s.statementsToReview &&
  !s.statementsWaiting;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** One line per open item, most actionable first. */
export function statusLines(s: AccountStatus): string[] {
  const lines: string[] = [];
  if (s.statementsToReview)
    lines.push(
      `${plural(s.statementsToReview, 'statement', 'statements')} we couldn't read or that need a look`,
    );
  if (s.statementsWaiting)
    lines.push(
      `${plural(s.statementsWaiting, 'statement is', 'statements are')} uploaded but not generated yet`,
    );
  if (s.unmatchedFiles)
    lines.push(
      `${plural(s.unmatchedFiles, 'attachment', 'attachments')} (receipts, cheques…) not matched to a transaction yet`,
    );
  if (s.uncategorized)
    lines.push(
      `${plural(s.uncategorized, 'transaction is', 'transactions are')} still Uncategorized`,
    );
  if (s.unrecognizedNames)
    lines.push(
      `${plural(s.unrecognizedNames, 'description has', 'descriptions have')} no recognized payee name`,
    );
  if (s.newDocuments)
    lines.push(
      `${plural(s.newDocuments, 'document', 'documents')} (letters, requests) you sent us`,
    );
  return lines;
}

export interface StatusMessage {
  subject: string;
  /** Plain text (email text part and the text message). */
  text: string;
  html: string;
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** The weekly Account Status Overview. `sms` = the short form for a text message. */
export function accountStatusMessage(input: {
  firstName: string;
  book: string;
  status: AccountStatus;
  link: string;
  sms: boolean;
  /** step12c: calling our number reaches the AI right now — the email says so. */
  canCall?: boolean;
}): StatusMessage {
  const lines = statusLines(input.status);
  const reply = `Reply to this email, text us${input.canCall ? ', call us' : ''}, or ask the assistant on the website and we’ll help you sort them out.`;
  const hi = `Hi ${input.firstName || 'there'},`;
  if (input.sms) {
    const text = [
      `${hi} your weekly account status (${input.book}):`,
      ...lines.map((l) => `• ${l}`),
      'Reply here and I’ll help you sort them out, or open:',
      input.link,
    ].join('\n');
    return { subject: '', text, html: '' };
  }
  const subject = `Your account status — ${lines.length} item${lines.length === 1 ? '' : 's'} to review (${input.book})`;
  const text = [
    hi,
    '',
    `Here is this week's account status for ${input.book}:`,
    '',
    ...lines.map((l) => `• ${l}`),
    '',
    reply,
    `Open your books: ${input.link}`,
    '',
    '— CYG Finance',
  ].join('\n');
  const html = `<p>${esc(hi)}</p><p>Here is this week's account status for <b>${esc(input.book)}</b>:</p><ul>${lines
    .map((l) => `<li>${esc(l)}</li>`)
    .join(
      '',
    )}</ul><p>${esc(reply)}</p><p><a href="${esc(input.link)}">Open your books</a></p><p>— CYG Finance</p>`;
  return { subject, text, html };
}

const MONEY = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });

/** The monthly Financial Report (the PDF rides on the email; a text gets the link). */
export function financialReportMessage(input: {
  firstName: string;
  book: string;
  period: string;
  income: number;
  expenses: number;
  net: number;
  uncategorized: number;
  link: string;
  sms: boolean;
}): StatusMessage {
  const hi = `Hi ${input.firstName || 'there'},`;
  const figures = `Income ${MONEY(input.income)}, expenses ${MONEY(input.expenses)}, ${input.net >= 0 ? 'net income' : 'net loss'} ${MONEY(Math.abs(input.net))}.`;
  const caveat = input.uncategorized
    ? ` ${plural(input.uncategorized, 'transaction is', 'transactions are')} still Uncategorized, so it is not final.`
    : '';
  if (input.sms) {
    return {
      subject: '',
      text: `${hi} your financial report for ${input.period} (${input.book}): ${figures}${caveat}\nFull report: ${input.link}`,
      html: '',
    };
  }
  const subject = `Your financial report — ${input.period} (${input.book})`;
  const text = [
    hi,
    '',
    `Your financial report for ${input.period} (${input.book}) is attached.`,
    '',
    figures + caveat,
    '',
    `You can also open it here (the link works for 7 days): ${input.link}`,
    '',
    '— CYG Finance',
  ].join('\n');
  const html = `<p>${esc(hi)}</p><p>Your financial report for <b>${esc(input.period)}</b> (${esc(input.book)}) is attached.</p><p>${esc(figures + caveat)}</p><p><a href="${esc(input.link)}">Open the report</a> (the link works for 7 days)</p><p>— CYG Finance</p>`;
  return { subject, text, html };
}
