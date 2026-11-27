import { BadRequestException } from '@nestjs/common';
import { SubNamesService } from './sub-names.service';

jest.mock('./sub-name-parents', () => ({
  ...jest.requireActual<Record<string, unknown>>('./sub-name-parents'),
  ledgerNameId: jest.fn((_p: unknown, _s: unknown, name: string) =>
    Promise.resolve(name === 'Gusto' ? 5 : 4),
  ),
}));

const scope = { customerId: 9, bookId: 5, companyId: null };

/** 2026-11-27: a name with sub-names (a wrapper) merges into another name, sub by sub. */
describe('SubNamesService.merge — a wrapper name as the source', () => {
  const gustoSubs = [
    { id: 26, name: 'Gusto - Payroll', category: 'Payroll', splitKey: '' },
    { id: 28, name: 'Gusto - Bank Fees', category: 'Bank Fees', splitKey: '' },
  ];
  let prisma: {
    subName: { findMany: jest.Mock; findFirst: jest.Mock };
    taxAgency: { findMany: jest.Mock };
  };
  let names: {
    isWrapper: jest.Mock;
    mergeNames: jest.Mock;
    mergeSubName: jest.Mock;
    mergeIntoSubName: jest.Mock;
  };
  let service: SubNamesService;
  let setParent: jest.SpyInstance;

  beforeEach(() => {
    prisma = {
      subName: {
        findMany: jest.fn().mockResolvedValue(gustoSubs),
        // Staples has a Bank Fees sub-name (27), no Payroll one; no sub-name is named "Staples".
        findFirst: jest.fn(({ where }: { where: { category?: string } }) =>
          Promise.resolve(where.category === 'Bank Fees' ? { id: 27 } : null),
        ),
      },
      taxAgency: { findMany: jest.fn().mockResolvedValue([]) },
    };
    names = {
      isWrapper: jest.fn((_s: unknown, name: string) =>
        Promise.resolve(name === 'Gusto'),
      ),
      mergeNames: jest.fn().mockResolvedValue(undefined),
      mergeSubName: jest.fn().mockResolvedValue(undefined),
      mergeIntoSubName: jest.fn().mockResolvedValue(undefined),
    };
    service = new SubNamesService(
      prisma as never,
      names as never,
      {} as never,
      {} as never,
    );
    setParent = jest.spyOn(service, 'setParent').mockResolvedValue(undefined);
  });

  it('joins a sub-name of the same category, moves the others under the target, then merges the name', async () => {
    await service.merge(scope, { from: 'Gusto', into: 'Staples' });
    expect(names.mergeSubName).toHaveBeenCalledWith(scope, 28, {
      subNameId: 27,
    });
    expect(setParent).toHaveBeenCalledWith(scope, 26, 'Staples');
    expect(names.mergeNames).toHaveBeenCalledWith(scope, 'Gusto', 'Staples');
  });

  it('onto a sub-name, every sub-name merges into it', async () => {
    prisma.subName.findFirst.mockResolvedValue({
      id: 24,
      name: 'Staples - Office',
      category: 'Office',
    });
    await service.merge(scope, { from: 'Gusto', intoSubNameId: 24 });
    expect(names.mergeSubName).toHaveBeenCalledTimes(2);
    expect(names.mergeSubName).toHaveBeenCalledWith(scope, 26, {
      subNameId: 24,
    });
    expect(names.mergeIntoSubName).toHaveBeenCalledWith(scope, 'Gusto', 24);
    expect(setParent).not.toHaveBeenCalled();
  });

  it('refuses its own sub-name and the same name', async () => {
    prisma.subName.findFirst.mockResolvedValue({ ...gustoSubs[0] });
    await expect(
      service.merge(scope, { from: 'Gusto', intoSubNameId: 26 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.merge(scope, { from: 'Gusto', into: 'gusto' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(names.mergeSubName).not.toHaveBeenCalled();
  });

  it('a plain name still takes the old path', async () => {
    await service.merge(scope, { from: 'Hydro', into: 'Staples' });
    expect(names.mergeNames).toHaveBeenCalledWith(scope, 'Hydro', 'Staples');
    expect(prisma.subName.findMany).not.toHaveBeenCalled();
  });
});
