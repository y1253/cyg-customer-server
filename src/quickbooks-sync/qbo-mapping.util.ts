import { createHash } from 'node:crypto';
import type { AccountType } from '../bookkeeping/chart-of-accounts';

/**
 * step11 (internal, 2026-11-23) — the pure rules of the QuickBooks push: how one bank-feed
 * transaction (with its splits) becomes ONE QuickBooks Purchase or Deposit, and the hash
 * that says whether what was sent is still what the books say.
 */

/** One line of the QuickBooks transaction: a category and its share, in positive cents. */
export interface QboLine {
  category: string;
  cents: number;
  /** The sub-name or split name shown on the line; null = none. */
  description: string | null;
  /** step11 part 3: the line's QuickBooks class (the book's CLASS column); null = none. */
  className?: string | null;
}

/** step11 part 3: a QuickBooks custom field's value (`ref` = its DefinitionId). */
export interface QboFieldValue {
  ref: string;
  value: string;
}

export interface QboFamily {
  rowId: number;
  externalId: string;
  /** YYYY-MM-DD — posted, else pending. */
  date: string;
  /** The bank amount in cents: + = money in, − = money out. */
  cents: number;
  /** The payee; null = no entity on the QuickBooks side. */
  name: string | null;
  description: string;
  kind: 'BANK' | 'CREDIT_CARD';
  /** The `PlaidAccount` its statement belongs to (its QuickBooks bank account). */
  plaidAccountId: number;
  lines: QboLine[];
  /** step11 part 3: the transaction's custom field values (the book's FIELD columns). */
  fields?: QboFieldValue[];
}

export type QboTxnType = 'Purchase' | 'Deposit';

export const UNCATEGORIZED_EXPENSE = 'Uncategorized Expense';
export const UNCATEGORIZED_INCOME = 'Uncategorized Income';

const cents = (n: number): number => Math.round(n * 100);

/**
 * The family's lines: what the transaction keeps after its splits (in its own category),
 * then each split. Every split's amount is its own share (a split of a split stores what is
 * left of it), so the lines add up to the bank amount. Zero lines are dropped.
 */
export function familyLines(
  parent: {
    amount: number;
    category: string;
    description: string | null;
    className?: string | null;
  },
  splits: ReadonlyArray<{
    amount: number;
    category: string;
    description: string | null;
    className?: string | null;
  }>,
): QboLine[] {
  const total = Math.abs(cents(parent.amount));
  // step11 part 3: a split's own class, else its transaction's.
  const withClass = (c: string | null | undefined) =>
    c ? { className: c } : {};
  const parts = splits.map((s) => ({
    category: s.category,
    cents: Math.abs(cents(s.amount)),
    description: s.description,
    ...withClass(s.className || parent.className),
  }));
  const taken = parts.reduce((sum, p) => sum + p.cents, 0);
  const lines: QboLine[] = [];
  if (total - taken > 0) {
    lines.push({
      category: parent.category,
      cents: total - taken,
      description: parent.description,
      ...withClass(parent.className),
    });
  }
  for (const p of parts) if (p.cents > 0) lines.push(p);
  return lines;
}

/**
 * Money out = a Purchase. Money in = a Deposit into a bank account; on a credit card it is a
 * card credit (a Purchase with `Credit: true` — QuickBooks takes no Deposit into a card).
 */
export function qboTypeOf(
  family: Pick<QboFamily, 'cents' | 'kind'>,
): QboTxnType {
  if (family.cents < 0) return 'Purchase';
  return family.kind === 'CREDIT_CARD' ? 'Purchase' : 'Deposit';
}

/** The account a category posts to: Uncategorized goes to QuickBooks' own uncategorized ones. */
export function qboCategoryName(category: string, moneyOut: boolean): string {
  if (category === 'Uncategorized') {
    return moneyOut ? UNCATEGORIZED_EXPENSE : UNCATEGORIZED_INCOME;
  }
  return qboText(category);
}

/** QuickBooks' AccountType for a category of ours (a new account it does not have yet). */
export function qboAccountType(
  name: string,
  type: AccountType,
): { AccountType: string } {
  if (name === UNCATEGORIZED_EXPENSE) return { AccountType: 'Expense' };
  if (name === UNCATEGORIZED_INCOME) return { AccountType: 'Income' };
  switch (type) {
    case 'INCOME':
      return { AccountType: 'Income' };
    case 'ASSET':
      return { AccountType: 'Other Current Asset' };
    case 'LIABILITY':
      return { AccountType: 'Other Current Liability' };
    case 'EQUITY':
      return { AccountType: 'Equity' };
    case 'EXPENSE':
      return { AccountType: 'Expense' };
  }
}

/**
 * A name QuickBooks accepts: no colon (its sub-account separator), no tabs / new lines,
 * at most 100 characters.
 */
export function qboText(value: string, max = 100): string {
  return value
    .replace(/[:\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** step11.md (2026-11-25): what a payee of several categories is called in QuickBooks. */
export const MIX_SUFFIX = '-mix';

/**
 * The payee as QuickBooks shows it. A name whose transactions sit under sub-names of two or
 * more categories ("Walmart - Office", "Walmart - Meals") has no one category, and QuickBooks
 * has no sub-names for a payee — so it is pushed as "Walmart-mix" (user's decision, step11.md).
 */
export function qboPayeeName(name: string, mixed: boolean): string {
  if (!mixed) return qboText(name);
  return `${qboText(name, 100 - MIX_SUFFIX.length)}${MIX_SUFFIX}`;
}

/** A QuickBooks payee (Vendor / Customer / Employee) as a reference. */
export interface QboPayeeRef {
  id: string;
  type: string;
}

type RefLike = { value?: unknown } | undefined;
const refId = (ref: unknown): string | null => {
  const v = (ref as RefLike)?.value;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
};

/**
 * step11 part 2 (2026-11-26): a QuickBooks Purchase / Deposit, as read, moved from payee
 * `fromId` to `to` (a name merge). Returns the sparse-update body, or null when the
 * transaction does not name that payee. A Deposit names its payee per LINE, and a sparse
 * update replaces the whole `Line` array, so every line is sent back (only the matching
 * ones changed).
 */
export function repointEntity(
  type: QboTxnType,
  txn: Record<string, unknown>,
  fromId: string,
  to: QboPayeeRef,
): Record<string, unknown> | null {
  const syncToken =
    typeof txn.SyncToken === 'string' ? { SyncToken: txn.SyncToken } : {};
  const ref = { value: to.id, type: to.type };
  if (type === 'Purchase') {
    if (refId(txn.EntityRef) !== fromId) return null;
    return { ...syncToken, EntityRef: ref };
  }
  const lines = Array.isArray(txn.Line)
    ? (txn.Line as Array<Record<string, unknown>>)
    : [];
  let changed = false;
  const Line = lines.map((line) => {
    const detail = line.DepositLineDetail as
      | Record<string, unknown>
      | undefined;
    if (!detail || refId(detail.Entity) !== fromId) return line;
    changed = true;
    return { ...line, DepositLineDetail: { ...detail, Entity: ref } };
  });
  return changed ? { ...syncToken, Line } : null;
}

/** A string literal in a QuickBooks query (`'Owner\'s Loan'`). */
export function qboQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** What was sent, as a hash: a different hash = the transaction is updated in QuickBooks. */
export function familyHash(family: QboFamily): string {
  const key = {
    type: qboTypeOf(family),
    date: family.date,
    cents: family.cents,
    name: family.name,
    account: family.plaidAccountId,
    lines: family.lines.map((l) =>
      // step11 part 3: a class joins the key only when there is one, so books without
      // classes keep their old hashes (nothing re-pushed for them).
      l.className
        ? [l.category, l.cents, l.description, l.className]
        : [l.category, l.cents, l.description],
    ),
    ...(family.fields?.length
      ? { fields: family.fields.map((f) => [f.ref, f.value]) }
      : {}),
  };
  return createHash('sha256').update(JSON.stringify(key)).digest('hex');
}

export interface QboRefs {
  bankAccountId: string;
  entity: { id: string; type: 'Vendor' | 'Customer' | 'Employee' } | null;
  /** Category → QuickBooks account id (already resolved, by `qboCategoryName`). */
  accountIds: ReadonlyMap<string, string>;
  /** step11 part 3: class name → QuickBooks Class id (a name missing = no ClassRef). */
  classIds?: ReadonlyMap<string, string>;
}

/** step11 part 3: what to leave out of the body (QuickBooks refused it on this file). */
export interface QboBodyOmit {
  classes?: boolean;
  fields?: boolean;
}

const money = (c: number): number => Number((c / 100).toFixed(2));

/** The Purchase / Deposit body (create, or the fields of a sparse update). */
export function qboBody(
  family: QboFamily,
  refs: QboRefs,
  omit: QboBodyOmit = {},
): Record<string, unknown> {
  const moneyOut = family.cents < 0;
  const note = qboText(
    `${family.description} · bank feed ${family.externalId}`,
    4000,
  );
  const accountOf = (category: string): string => {
    const id = refs.accountIds.get(qboCategoryName(category, moneyOut));
    if (!id) throw new Error(`No QuickBooks account for "${category}"`);
    return id;
  };
  const classRef = (l: QboLine): Record<string, unknown> => {
    const id =
      !omit.classes && l.className
        ? refs.classIds?.get(l.className)
        : undefined;
    return id ? { ClassRef: { value: id } } : {};
  };
  const custom =
    !omit.fields && family.fields?.length
      ? {
          CustomField: family.fields.map((f) => ({
            DefinitionId: f.ref,
            Type: 'StringType',
            StringValue: f.value.slice(0, 255),
          })),
        }
      : {};
  if (qboTypeOf(family) === 'Deposit') {
    return {
      DepositToAccountRef: { value: refs.bankAccountId },
      TxnDate: family.date,
      PrivateNote: note,
      ...custom,
      Line: family.lines.map((l) => ({
        DetailType: 'DepositLineDetail',
        Amount: money(l.cents),
        ...(l.description ? { Description: qboText(l.description, 4000) } : {}),
        DepositLineDetail: {
          AccountRef: { value: accountOf(l.category) },
          ...(refs.entity
            ? { Entity: { value: refs.entity.id, type: refs.entity.type } }
            : {}),
          ...classRef(l),
        },
      })),
    };
  }
  return {
    PaymentType: family.kind === 'CREDIT_CARD' ? 'CreditCard' : 'Cash',
    AccountRef: { value: refs.bankAccountId },
    TxnDate: family.date,
    PrivateNote: note,
    ...(!moneyOut ? { Credit: true } : {}),
    ...(refs.entity
      ? { EntityRef: { value: refs.entity.id, type: refs.entity.type } }
      : {}),
    ...custom,
    Line: family.lines.map((l) => ({
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: money(l.cents),
      ...(l.description ? { Description: qboText(l.description, 4000) } : {}),
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: accountOf(l.category) },
        ...classRef(l),
      },
    })),
  };
}
