/**
 * The plan for the one-time 2026-10 backfill that gives every existing company a
 * customer account (`scripts/backfill-company-customers.ts`). Pure, so the grouping
 * rules are tested rather than eyeballed in a dry run.
 *
 * Rules (user's decision 2026-10-15):
 * - the owner email is `ContactInfo.privateEmail`, trimmed and lower-cased (Customer
 *   emails are stored lower-cased);
 * - companies sharing an email share ONE account;
 * - an email that already has a live account is LINKED to it, and that account's
 *   password is never touched;
 * - a company with no usable email is skipped and listed for a person to fix.
 */

export interface BackfillCompany {
  id: number;
  businessName: string;
  privateEmail: string | null;
  personalName: string | null;
}

export interface BackfillPlan {
  /** New accounts to create, each with every company to link to it. */
  create: { email: string; name: string; companyIds: number[] }[];
  /** Companies to link to an account that already exists. */
  link: { customerId: number; email: string; companyIds: number[] }[];
  /** Companies left alone, and why. */
  skipped: { companyId: number; businessName: string; reason: string }[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null): string | null {
  const e = raw?.trim().toLowerCase() ?? '';
  return EMAIL.test(e) ? e : null;
}

export function planBackfill(
  companies: BackfillCompany[],
  existing: Map<string, number>,
): BackfillPlan {
  const created = new Map<string, BackfillPlan['create'][number]>();
  const linked = new Map<string, BackfillPlan['link'][number]>();
  const skipped: BackfillPlan['skipped'] = [];

  for (const c of companies) {
    const email = normalizeEmail(c.privateEmail);
    if (!email) {
      skipped.push({
        companyId: c.id,
        businessName: c.businessName,
        reason: c.privateEmail?.trim()
          ? `not an email: "${c.privateEmail}"`
          : 'no owner email',
      });
      continue;
    }
    const customerId = existing.get(email);
    if (customerId !== undefined) {
      const row = linked.get(email) ?? { customerId, email, companyIds: [] };
      row.companyIds.push(c.id);
      linked.set(email, row);
      continue;
    }
    const row = created.get(email) ?? {
      email,
      // The first company's owner name, else its business name: Customer.name is required.
      name: c.personalName?.trim() || c.businessName,
      companyIds: [],
    };
    row.companyIds.push(c.id);
    created.set(email, row);
  }
  return {
    create: [...created.values()],
    link: [...linked.values()],
    skipped,
  };
}
