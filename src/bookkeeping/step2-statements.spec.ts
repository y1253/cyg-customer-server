import { balanceFit } from './bookkeeping.service';
import { relinkPlan } from './reread-relink.util';
import { failureReason } from './statement-errors';
import { attachmentDoneNote } from '../voice/voice-session';

describe('failureReason (step2)', () => {
  it('names the kind of failure in plain words', () => {
    expect(failureReason('Request timed out after 120000ms')).toContain(
      'took too long',
    );
    expect(failureReason('429 Rate limit reached for gpt-4o')).toContain(
      'busy',
    );
    expect(failureReason('Unexpected token < in JSON at position 0')).toContain(
      'could not make sense',
    );
    expect(failureReason('the file is encrypted')).toContain(
      'password-protected',
    );
  });

  it('falls back to the general message', () => {
    expect(failureReason('something odd')).toBe(
      'We could not read this statement. Please try again, or upload a clearer copy.',
    );
  });
});

describe('relinkPlan (step2)', () => {
  const fresh = [
    {
      id: 10,
      amountCents: -500,
      day: '2026-03-02',
      description: 'TIM HORTONS #12',
    },
    { id: 11, amountCents: -500, day: '2026-03-02', description: 'STARBUCKS' },
    { id: 12, amountCents: -4200, day: '2026-03-05', description: 'COSTCO' },
  ];

  it('puts a receipt back on the same transaction', () => {
    const plan = relinkPlan(
      [
        {
          attachmentId: 1,
          amountCents: -500,
          day: '2026-03-02',
          description: 'starbucks ',
        },
        {
          attachmentId: 2,
          amountCents: -4200,
          day: '2026-03-05',
          description: 'COSTCO WHOLESALE',
        },
      ],
      fresh,
    );
    expect(plan.get(1)).toBe(11);
    // Description read differently, but the only row of that amount and day.
    expect(plan.get(2)).toBe(12);
  });

  it('leaves a receipt out when amount and day fit two rows and the text fits none', () => {
    const plan = relinkPlan(
      [
        {
          attachmentId: 3,
          amountCents: -500,
          day: '2026-03-02',
          description: 'COFFEE',
        },
      ],
      fresh,
    );
    expect(plan.has(3)).toBe(false);
  });
});

describe('balanceFit (step2)', () => {
  it('a bank account: opening + net = closing', () => {
    expect(balanceFit(100, 150, 50, false)).toEqual({
      balancesMatch: true,
      expectedClosing: 150,
    });
    expect(balanceFit(100, 151, 50, false).balancesMatch).toBe(false);
  });

  it('a card prints the balance owed: purchases raise it', () => {
    expect(balanceFit(100, 150, -50, true)).toEqual({
      balancesMatch: true,
      expectedClosing: 150,
    });
  });

  it('cannot tell without an opening or a closing', () => {
    expect(balanceFit(null, 150, 0, false).balancesMatch).toBeNull();
    expect(balanceFit(100, null, 0, false)).toEqual({
      balancesMatch: null,
      expectedClosing: 100,
    });
  });
});

describe('attachmentDoneNote (step2)', () => {
  it('tells the AI on the call how the re-read file came out', () => {
    expect(
      attachmentDoneNote(5, {
        status: 'MATCHED',
        error: null,
        matchNote: null,
        filename: 'r.jpg',
      }),
    ).toContain('attached to a transaction');
    expect(
      attachmentDoneNote(5, {
        status: 'UNMATCHED',
        error: null,
        matchNote: 'no charge of $12.40',
        filename: 'r.jpg',
      }),
    ).toContain('no charge of $12.40');
  });
});
