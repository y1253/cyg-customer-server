import { descriptionKey, rowNameConflicts } from './name-memory.util';

const rows = [
  {
    description: 'AGENCE DE MOBILITE DUR MONTREAL QC',
    name: 'Agence de Mobilite',
  },
  {
    description: 'AGENCE DE MOBILITE DUR MONTREAL QC',
    name: 'Agence de Mobilite',
  },
  { description: 'AG TRAVEL PLAZA 3601501', name: 'AG Travel Plaza' },
  {
    description: 'AGENCE DE MOBILITE DUR LAVAL QC',
    name: 'Agence Laval',
    manualEdit: true,
  },
  { description: 'SERVICE CHARGE', name: null },
];

describe('rowNameConflicts (step8, check1.png)', () => {
  it('a contains-text reaching rows another name carries is a conflict, once per name', () => {
    const c = rowNameConflicts({
      matchType: 'CONTAINS',
      key: 'agence de mobilite dur',
      name: 'AG Travel Plaza',
      rows,
    });
    expect(c).toEqual([
      {
        matchType: 'DESCRIPTION',
        text: 'AGENCE DE MOBILITE DUR MONTREAL QC',
        name: 'Agence de Mobilite',
        remove: false,
      },
    ]);
  });

  it('an exact description named by the AI (no rule) is a conflict too', () => {
    const c = rowNameConflicts({
      matchType: 'DESCRIPTION',
      key: descriptionKey('AG TRAVEL PLAZA 3601501'),
      name: 'Agence de Mobilite',
      rows,
    });
    expect(c.map((x) => x.name)).toEqual(['AG Travel Plaza']);
  });

  it('the same name, one-time edits, nameless rows and ignored names never conflict', () => {
    expect(
      rowNameConflicts({
        matchType: 'CONTAINS',
        key: 'agence de mobilite',
        name: 'agence de mobilite',
        rows,
      }),
    ).toEqual([]);
    expect(
      rowNameConflicts({
        matchType: 'DESCRIPTION',
        key: descriptionKey('SERVICE CHARGE'),
        name: 'TD Bank',
        rows,
        ignore: ['Unclarified name'],
      }),
    ).toEqual([]);
  });
});
