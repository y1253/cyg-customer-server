import { answerProblem, cleanColumn } from './custom-column.util';

describe('cleanColumn', () => {
  it('a dropdown keeps its options in order, trimmed, no blanks', () => {
    expect(
      cleanColumn({
        name: '  Business ',
        type: 'DROPDOWN',
        minChars: 3,
        options: [{ label: ' 1 ' }, { label: '' }, { id: 4, label: '2' }],
      }),
    ).toEqual({
      name: 'Business',
      type: 'DROPDOWN',
      minChars: null,
      maxChars: null,
      required: false,
      options: [{ label: '1' }, { id: 4, label: '2' }],
    });
  });

  it.each([
    [{ name: '', type: 'TEXT' }, 'Give the column a name'],
    [{ name: 'X', type: 'DATE' }, 'Pick what the column holds'],
    [
      { name: 'X', type: 'TEXT', minChars: 5, maxChars: 2 },
      'The minimum is more than the maximum',
    ],
    [
      { name: 'X', type: 'TEXT', minChars: 1.5 },
      'Characters must be a whole number from 0 to 1000',
    ],
    [
      { name: 'X', type: 'DROPDOWN', options: [] },
      'A dropdown needs at least one option',
    ],
    [
      {
        name: 'X',
        type: 'DROPDOWN',
        options: [{ label: 'A' }, { label: 'a' }],
      },
      '“a” is in the list twice',
    ],
  ])('%j → %s', (input, problem) => expect(cleanColumn(input)).toBe(problem));
});

describe('answerProblem', () => {
  const rules = (
    type: 'TEXT' | 'LETTERS' | 'NUMBER',
    minChars: number | null = null,
    maxChars: number | null = null,
  ) => ({
    type,
    minChars,
    maxChars,
  });

  it('empty always clears', () =>
    expect(answerProblem(rules('NUMBER', 3), '  ')).toBeNull());
  it('number only', () => {
    expect(answerProblem(rules('NUMBER'), '-12.50')).toBeNull();
    expect(answerProblem(rules('NUMBER'), '12a')).toBe('Numbers only');
  });
  it('text only', () => {
    expect(answerProblem(rules('LETTERS'), 'Job A')).toBeNull();
    expect(answerProblem(rules('LETTERS'), 'Job 2')).toBe(
      'Text only — no digits',
    );
  });
  it('min / max characters', () => {
    expect(answerProblem(rules('TEXT', 3, 5), 'ab')).toBe(
      'At least 3 characters',
    );
    expect(answerProblem(rules('TEXT', 3, 5), 'abcdef')).toBe(
      'At most 5 characters',
    );
    expect(answerProblem(rules('TEXT', 3, 5), 'abcd')).toBeNull();
  });
});
