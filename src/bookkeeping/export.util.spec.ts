import { netOf } from './export.service';

describe('netOf', () => {
  it('adds in whole cents', () => {
    expect(netOf([{ amount: 90.91 }, { amount: 9.09 }])).toBe(100);
    expect(netOf([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
  });
});
