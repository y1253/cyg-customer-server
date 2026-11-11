import { attachmentDoneNote, promisedAction } from './voice-session';

describe('promisedAction (step8, the Logistics call)', () => {
  it.each([
    "You've got it. I'm going to look up the transaction for cheque number 00011 now, so we can get that matched up as well.",
    "Let's go ahead and find the right transaction for cheque 00011 now.",
    'Let me find those now.',
    'One moment.',
    "I'll attach it now.",
  ])('a promise: %s', (said) => expect(promisedAction(said)).toBe(true));

  it.each([
    'Do you know which TD account this cheque came from?',
    'All set — cheque 00015 is attached to the right transaction.',
    'You are welcome, have a great day!',
    '',
  ])('not a promise: %s', (said) => expect(promisedAction(said)).toBe(false));
});

describe('attachmentDoneNote with the cut documents', () => {
  const row = {
    status: 'MATCHED',
    error: null,
    matchNote: null,
    filename: 'p4 #1.png',
  };

  it('lists every file and what it is on, and says not to move them', () => {
    const note = attachmentDoneNote(23, row, [
      {
        id: 23,
        status: 'MATCHED',
        chequeNumber: '00016',
        amount: 1448.8,
        transaction: 'CHQ#00016-4143006117 -1448.80',
      },
      {
        id: 298,
        status: 'MATCHED',
        chequeNumber: '00015',
        amount: 1448.8,
        transaction: 'CHQ#00015-4143006120 -1448.80',
      },
    ]);
    expect(note).toContain('2 documents');
    expect(note).toContain('#298 cheque 00015 $1448.80: attached to CHQ#00015');
    expect(note).toContain('never move them');
  });

  it('a single file keeps the old wording', () => {
    expect(attachmentDoneNote(5, row)).toContain('attached to a transaction');
  });
});
