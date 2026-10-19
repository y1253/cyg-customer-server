import { attachmentFolder } from './attachment-folders.util';

const tx = (
  accountName: string | null,
  accountNameByCustomer: string | null,
) => ({
  statement: { accountName, accountNameByCustomer },
});

describe('attachmentFolder', () => {
  it('is null for an unmatched attachment', () => {
    expect(attachmentFolder(null)).toBeNull();
  });

  it("is the statement's account as the AI read it", () => {
    expect(attachmentFolder(tx('Chase 4362', null))).toBe('Chase 4362');
  });

  it('prefers the folder the customer filed the statement under', () => {
    expect(attachmentFolder(tx('Chase 4362', 'Business Visa'))).toBe(
      'Business Visa',
    );
  });

  it('is null when the statement has no account yet', () => {
    expect(attachmentFolder(tx(null, null))).toBeNull();
    expect(attachmentFolder(tx('  ', ''))).toBeNull();
  });
});
