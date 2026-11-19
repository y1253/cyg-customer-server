import { defaultFor, type NameDefault } from './custom-column-defaults';

const d = (over: Partial<NameDefault>): NameDefault => ({
  columnId: 1,
  nameKey: null,
  subNameId: null,
  value: 'x',
  dropDownId: null,
  ...over,
});

describe('defaultFor (step9 2026-11-19)', () => {
  const defaults = [
    d({ nameKey: 'walmart', value: 'name' }),
    d({ subNameId: 7, value: 'sub' }),
    d({ columnId: 2, nameKey: 'walmart', value: 'other column' }),
  ];

  it("takes the row's sub-name default first", () => {
    expect(
      defaultFor(defaults, 1, { name: 'Walmart', subNameId: 7 })?.value,
    ).toBe('sub');
  });

  it("falls back to the name's default (any case)", () => {
    expect(
      defaultFor(defaults, 1, { name: 'WALMART', subNameId: 8 })?.value,
    ).toBe('name');
    expect(
      defaultFor(defaults, 2, { name: 'walmart', subNameId: null })?.value,
    ).toBe('other column');
  });

  it('gives nothing to a row with no default in that column', () => {
    expect(defaultFor(defaults, 1, { name: 'Costco', subNameId: null })).toBe(
      null,
    );
    expect(defaultFor(defaults, 3, { name: 'Walmart', subNameId: 7 })).toBe(
      null,
    );
    expect(defaultFor(defaults, 1, { name: null, subNameId: null })).toBe(null);
  });
});
