import { BadRequestException } from '@nestjs/common';
import { ProductMemoryService } from './product-memory.service';

const scope = { customerId: 9, bookId: 5, companyId: null };

/** 2026-11-27: a receipt item dragged onto another (internal Rules tab) becomes it. */
describe('ProductMemoryService.mergeItems', () => {
  let prisma: {
    customerItemRule: {
      findMany: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    bankTransaction: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: ProductMemoryService;
  let writeRows: jest.SpyInstance;

  beforeEach(() => {
    prisma = {
      customerItemRule: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, itemKey: 'diapers', name: 'Pampers' }, // merged into "pampers" before
        ]),
        update: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      bankTransaction: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new ProductMemoryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'products').mockResolvedValue([
      { itemKey: 'pampers', name: 'Pampers', category: 'Supplies' },
      { itemKey: 'huggies', name: 'Huggies', category: 'Baby' },
    ] as never);
    const rows = [
      { id: 10, itemName: 'Pampers', offsetAccount: 'Supplies' },
      { id: 11, itemName: 'PAMPERS', offsetAccount: 'Supplies' },
      { id: 12, itemName: 'Huggies', offsetAccount: 'Baby' },
    ];
    jest
      .spyOn(service as never, 'itemRows')
      .mockResolvedValue(rows as never);
    writeRows = jest
      .spyOn(service as never, 'writeRows')
      .mockResolvedValue(undefined as never);
  });

  it('renames the lines, moves the splits and saves a rule that renames later lines', async () => {
    await service.mergeItems(scope, 'Pampers', 'Huggies');
    expect(prisma.customerItemRule.create).toHaveBeenCalledWith({
      data: {
        customerId: 9,
        bookId: 5,
        companyId: null,
        itemKey: 'pampers',
        name: 'Huggies',
        category: 'Baby',
      },
    });
    // "diapers" was merged into "pampers": it now leads to Huggies.
    expect(prisma.customerItemRule.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { name: 'Huggies', category: 'Baby' },
    });
    expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [10, 11] } },
      data: { itemName: 'Huggies' },
    });
    const [, moved, to] = writeRows.mock.calls[0] as [
      unknown,
      Array<{ id: number }>,
      () => string,
    ];
    expect(moved.map((r) => r.id)).toEqual([10, 11]);
    expect(to()).toBe('Baby');
  });

  it('refuses the same item', async () => {
    await expect(
      service.mergeItems(scope, 'Pampers', 'pampers'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
