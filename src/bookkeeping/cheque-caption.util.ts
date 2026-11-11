/**
 * step8 (2026-11-11): cheque CAPTIONS read as rows.
 *
 * TD prints "CHEQUE # 00034   $983.28" above every cheque image at the end of a statement.
 * Since the text layer goes along with each page (`STATEMENT_TEXT_PIPELINE`), the model
 * listed those captions as transactions next to the real "CHQ#00034-0142429574 −983.28"
 * row — book 2's TD 4496 statements of 2026-11-10/11 had 4–8 such rows each and were still
 * VERIFIED (TD prints no closing line, and the captions come after the last running
 * balance, so no check saw them): every one of those cheques was in the books twice, and
 * the cut cheques could no longer be matched by number (two rows printed it).
 *
 * A cheque number is printed on ONE real row of a statement, so a later row on a page that
 * shows item images, with the same cheque number AND amount as an earlier row, is the
 * caption of that cheque's image. PURE.
 */

/** The cheque number a description prints after "cheque / check / chq / chk", leading zeros dropped. */
export function chequeNumberOf(description: string): string | null {
  const m =
    /(?<![\p{L}\p{N}])(?:cheque|check|chq|chk)\.?\s*(?:no\.?|n°|#)?\s*:?\s*(\d{1,12})/iu.exec(
      description,
    );
  if (!m) return null;
  const n = m[1].replace(/^0+/, '');
  return n || null;
}

interface CaptionPage<T> {
  hasItemImages?: boolean;
  transactions: T[];
}

/**
 * The pages with the caption rows left out, and how many were. Rows are judged in page
 * order: the first row printing a cheque number + amount is the real one; a later one on an
 * image page is its caption. Pages that lose nothing are returned as they are.
 */
export function dropChequeCaptions<
  T extends { description: string; amount: number },
  P extends CaptionPage<T>,
>(pages: readonly P[]): { pages: P[]; dropped: number } {
  const seen = new Set<string>();
  let dropped = 0;
  const out = pages.map((p) => {
    const keep: T[] = [];
    for (const t of p.transactions) {
      const n = chequeNumberOf(t.description ?? '');
      const key =
        n && Number.isFinite(t.amount)
          ? `${n}:${Math.abs(Math.round(t.amount * 100))}`
          : null;
      if (key && p.hasItemImages && seen.has(key)) {
        dropped++;
        continue;
      }
      if (key) seen.add(key);
      keep.push(t);
    }
    return keep.length === p.transactions.length
      ? p
      : { ...p, transactions: keep };
  });
  return { pages: out, dropped };
}
