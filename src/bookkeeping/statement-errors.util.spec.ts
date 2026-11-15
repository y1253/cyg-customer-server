import {
  diffErrors,
  orderErrors,
  type OpenError,
} from './statement-errors.util';
import type { StatementProblem } from './statement-problem.util';

const problem = (
  kind: StatementProblem['kind'],
  text = `${kind} text`,
): StatementProblem => ({ kind, title: `${kind} title`, text });

const row = (over: Partial<OpenError>): OpenError => ({
  id: 1,
  statementId: 10,
  kind: 'ENDING',
  title: 'ENDING title',
  text: 'ENDING text',
  source: 'SYSTEM',
  ...over,
});

describe('diffErrors (step9)', () => {
  it('creates a new problem, keeps an unchanged one, resolves a gone one', () => {
    const plan = diffErrors(
      [
        row({ id: 1 }),
        row({
          id: 2,
          kind: 'MISSING',
          title: 'MISSING title',
          text: 'MISSING text',
        }),
      ],
      new Map([[10, [problem('ENDING'), problem('RUNNING')]]]),
    );
    expect(plan.create.map((c) => [c.statementId, c.kind])).toEqual([
      [10, 'RUNNING'],
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.resolve).toEqual([2]);
  });

  it('updates the words of a problem that is still there', () => {
    const plan = diffErrors(
      [row({ id: 1 })],
      new Map([[10, [problem('ENDING', 'off by $5.00')]]]),
    );
    expect(plan.update).toEqual([
      expect.objectContaining({ id: 1, text: 'off by $5.00' }),
    ]);
  });

  it("never touches the AI's own errors", () => {
    const plan = diffErrors(
      [row({ id: 7, kind: 'OTHER', source: 'AI' })],
      new Map(),
    );
    expect(plan).toEqual({ create: [], update: [], resolve: [] });
  });

  it('resolves the errors of a statement no longer checked (deleted / not read)', () => {
    const plan = diffErrors([row({ id: 3, statementId: 99 })], new Map());
    expect(plan.resolve).toEqual([3]);
  });

  it('resolves a duplicate open row of one kind', () => {
    const plan = diffErrors(
      [row({ id: 1 }), row({ id: 2 })],
      new Map([[10, [problem('ENDING')]]]),
    );
    expect(plan.resolve).toEqual([2]);
    expect(plan.create).toEqual([]);
  });
});

describe('orderErrors', () => {
  it('worst first, the AI ones last', () => {
    const list = [
      { id: 1, kind: 'OTHER' },
      { id: 2, kind: 'NO_BALANCES' },
      { id: 3, kind: 'ENDING' },
      { id: 4, kind: 'RUNNING' },
    ];
    expect(orderErrors(list).map((e) => e.id)).toEqual([3, 4, 2, 1]);
  });
});
