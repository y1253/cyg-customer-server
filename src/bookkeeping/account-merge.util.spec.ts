import { mergeRefusal, type MergeSide } from './account-merge.util';

const category = (name: string): MergeSide => ({
  name,
  agency: false,
  folder: null,
});
const folder = (
  name: string,
  kind: 'BANK' | 'CREDIT_CARD' = 'BANK',
  currency: string | null = null,
): MergeSide => ({ name, agency: false, folder: { kind, currency } });

describe('mergeRefusal', () => {
  it('merges two plain categories', () => {
    expect(
      mergeRefusal(category('Office'), category('Office Expense')),
    ).toBeNull();
  });

  it('merges two bank folders of the same kind and currency', () => {
    expect(
      mergeRefusal(folder('Chase 4362'), folder('Chase Checking')),
    ).toBeNull();
    expect(
      mergeRefusal(
        folder('Amex', 'CREDIT_CARD', 'USD'),
        folder('AMEX Gold', 'CREDIT_CARD', 'USD'),
      ),
    ).toBeNull();
  });

  it('never merges a folder account with one that has no folder — either way round', () => {
    expect(mergeRefusal(folder('Chase 4362'), category('Office'))).toMatch(
      /folder/,
    );
    expect(mergeRefusal(category('Office'), folder('Chase 4362'))).toMatch(
      /"Chase 4362" has its own folder/,
    );
  });

  it('refuses a bank account into a card, and different currencies', () => {
    expect(
      mergeRefusal(folder('Chase'), folder('Amex', 'CREDIT_CARD')),
    ).toMatch(/credit card/);
    expect(
      mergeRefusal(
        folder('Chase', 'BANK', 'CAD'),
        folder('Chase US', 'BANK', 'USD'),
      ),
    ).toMatch(/currencies/);
    // An unknown currency (nothing printed = the home one) never blocks the merge.
    expect(
      mergeRefusal(folder('Chase'), folder('Chase Plaid', 'BANK', 'CAD')),
    ).toBeNull();
  });

  it('refuses tax agencies, the same account, and figures that are not accounts', () => {
    expect(
      mergeRefusal({ ...category('GST'), agency: true }, category('Taxes')),
    ).toMatch(/tax agency/);
    expect(mergeRefusal(category('Office'), category('office'))).toMatch(
      /same/,
    );
    expect(mergeRefusal(category('Uncategorized'), category('Office'))).toMatch(
      /cannot be merged/,
    );
    expect(
      mergeRefusal(category('Office'), category('Retained Earnings')),
    ).toMatch(/cannot be merged/);
  });
});
