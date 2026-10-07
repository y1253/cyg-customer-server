/**
 * Fixes amounts whose SIGN the model got wrong, using the bank's own running balance.
 *
 * Why: a PDF's text layer loses the columns. On a "Cheque/Debit | Deposit/Credit" layout
 * (TD and most Canadian banks) the model has to guess the column from the page image, and
 * gpt-4o flipped about a third of a real TD statement — the same "INTUIT … PAY" was money
 * in on one day and out on the next. But wherever the bank prints a balance (often only on
 * the last row of each day), the rows since the previous balance MUST add up to the
 * difference, to the cent. With a handful of rows per segment there is usually exactly
 * one way to choose the signs that does — so the code picks it, not the model.
 *
 * PURE, integer cents. A segment is changed only when ONE sign choice with the fewest
 * flips hits the printed balance exactly; anything ambiguous is left for the checks and
 * re-reads. Balances are tried as printed and negated (a credit card prints what is OWED),
 * and rows oldest-first and newest-first; the reading that needs the fewest flips wins.
 */

export interface SignRow {
  /** Signed, as the model read it. */
  amount: number;
  balanceAfter: number | null;
}

export interface SignRepair {
  /** The amounts to use (same order as the input), signs repaired. */
  amounts: number[];
  /** How many rows had their sign flipped. */
  flips: number;
}

/** Brute force is 2^n per segment; past this a segment is left alone. */
const MAX_SEGMENT = 18;

const cents = (n: number): number => Math.round(n * 100);

export function repairSigns(
  rows: SignRow[],
  openingBalance: number | null,
): SignRepair {
  const unchanged: SignRepair = {
    amounts: rows.map((r) => r.amount),
    flips: 0,
  };
  if (!rows.some((r) => r.balanceAfter !== null)) return unchanged;

  let best: { links: number; flips: number; amounts: number[] } | null = null;
  for (const sign of [1, -1] as const) {
    for (const reversed of [false, true]) {
      const order = rows.map((_, i) => i);
      if (reversed) order.reverse();
      const pass = walk(
        order.map((i) => rows[i]),
        openingBalance,
        sign,
      );
      const amounts = new Array<number>(rows.length);
      order.forEach((i, k) => (amounts[i] = pass.amounts[k]));
      // More balance links that hold, then fewer flips: the model is right more often
      // than not, so the reading that needs the least correcting is the true layout.
      if (
        !best ||
        pass.links > best.links ||
        (pass.links === best.links && pass.flips < best.flips)
      ) {
        best = { links: pass.links, flips: pass.flips, amounts };
      }
    }
  }
  return best && best.flips > 0
    ? { amounts: best.amounts, flips: best.flips }
    : unchanged;
}

/** One pass in one order with balances read as `sign`: repair each segment it can. */
function walk(
  rows: SignRow[],
  openingBalance: number | null,
  sign: 1 | -1,
): { amounts: number[]; links: number; flips: number } {
  const amounts = rows.map((r) => cents(r.amount));
  let prev = openingBalance === null ? null : sign * cents(openingBalance);
  let start = 0;
  let links = 0;
  let flips = 0;
  rows.forEach((r, i) => {
    if (r.balanceAfter === null) return;
    const printed = sign * cents(r.balanceAfter);
    if (prev !== null) {
      const segment = amounts.slice(start, i + 1);
      const target = printed - prev;
      const fixed = segmentSigns(segment, target);
      if (fixed) {
        links++;
        fixed.forEach((a, k) => {
          if (a !== amounts[start + k]) flips++;
          amounts[start + k] = a;
        });
      }
    }
    prev = printed;
    start = i + 1;
  });
  return { amounts: amounts.map((a) => a / 100), links, flips };
}

/**
 * The signs for one segment that sum to `target`: the model's own if they already do,
 * else the UNIQUE assignment with the fewest flips. Null = can't be made to fit, or more
 * than one equally-good way (never guess).
 */
export function segmentSigns(
  segment: number[],
  target: number,
): number[] | null {
  const sum = segment.reduce((s, a) => s + a, 0);
  if (sum === target) return segment;
  // Only rows with an amount can be flipped; a zero row has no sign.
  const idx = segment.map((a, i) => (a !== 0 ? i : -1)).filter((i) => i >= 0);
  if (!idx.length || idx.length > MAX_SEGMENT) return null;
  const abs = idx.map((i) => Math.abs(segment[i]));
  const modelNegative = idx.map((i) => segment[i] < 0);

  let bestFlips = Infinity;
  let bestMask = -1;
  let ties = 0;
  for (let mask = 0; mask < 1 << idx.length; mask++) {
    // bit k set = row k is negative
    let s = 0;
    let f = 0;
    for (let k = 0; k < idx.length; k++) {
      const negative = (mask & (1 << k)) !== 0;
      s += negative ? -abs[k] : abs[k];
      if (negative !== modelNegative[k]) f++;
    }
    if (s !== target) continue;
    if (f < bestFlips) {
      bestFlips = f;
      bestMask = mask;
      ties = 1;
    } else if (f === bestFlips) {
      ties++;
    }
  }
  if (bestMask < 0 || ties > 1) return null;
  const out = [...segment];
  idx.forEach((i, k) => {
    out[i] = (bestMask & (1 << k)) !== 0 ? -abs[k] : abs[k];
  });
  return out;
}
