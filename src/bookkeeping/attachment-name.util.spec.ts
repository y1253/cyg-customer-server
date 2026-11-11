import { attachmentName, fileBucket, nameKeyOf } from './attachment-name.util';

describe('attachmentName', () => {
  const base = { nameOverride: null, transaction: null, reading: null };

  it("the customer's own choice wins over everything", () => {
    expect(
      attachmentName({
        nameOverride: ' Landlord ',
        transaction: { name: 'Walmart' },
        reading: { vendor: 'Costco' },
      }),
    ).toBe('Landlord');
  });

  it("then the matched transaction's name", () => {
    expect(
      attachmentName({
        ...base,
        transaction: { name: 'Walmart' },
        reading: { vendor: 'WAL-MART #12' },
      }),
    ).toBe('Walmart');
  });

  it('a matched row with no name is Unclarified name, never Unsorted', () => {
    expect(
      attachmentName({ ...base, transaction: { name: null }, reading: null }),
    ).toBe('Unclarified name');
  });

  it('then vendor, payee, party in that order', () => {
    expect(
      attachmentName({ ...base, reading: { vendor: 'Rona', payee: 'Bob' } }),
    ).toBe('Rona');
    expect(
      attachmentName({ ...base, reading: { vendor: ' ', payee: 'Bob' } }),
    ).toBe('Bob');
    expect(
      attachmentName({ ...base, reading: { party: 'CRA' } }),
    ).toBe('CRA');
  });

  it('nothing known = null (Unsorted)', () => {
    expect(attachmentName(base)).toBeNull();
    expect(
      attachmentName({ ...base, reading: { vendor: null, party: '' } }),
    ).toBeNull();
  });
});

describe('nameKeyOf', () => {
  it('folds case and spacing', () => {
    expect(nameKeyOf('  Home  Depot ')).toBe('home depot');
    expect(nameKeyOf('HOME DEPOT')).toBe(nameKeyOf('home depot'));
  });
});

describe('fileBucket', () => {
  it('being read is never counted', () => {
    expect(fileBucket('PENDING', false, true)).toBe('READING');
    expect(fileBucket('PROCESSING', true, false)).toBe('READING');
  });

  it('on a live transaction = related', () => {
    expect(fileBucket('MATCHED', true, false)).toBe('RELATED');
  });

  it('MATCHED but its statement left the ledger = error', () => {
    expect(fileBucket('MATCHED', false, false)).toBe('ERROR');
  });

  it('a document is not a transaction', () => {
    expect(fileBucket('DOCUMENT', false, false)).toBe('DOCUMENT');
  });

  it('unmatched and failed are errors', () => {
    expect(fileBucket('UNMATCHED', false, false)).toBe('ERROR');
    expect(fileBucket('FAILED', false, false)).toBe('ERROR');
  });

  it('anything in Unsorted is an error until filed', () => {
    expect(fileBucket('DOCUMENT', false, true)).toBe('ERROR');
  });
});
