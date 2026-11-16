import {
  answerProblem,
  cleanColumn,
  storedAnswerFit,
} from './custom-column.util';

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

describe('storedAnswerFit (step9 part 3: new rules vs answers already entered)', () => {
  const col = (
    type: 'TEXT' | 'LETTERS' | 'NUMBER' | 'DROPDOWN',
    options: Array<{ id?: number; label: string }> = [],
    minChars: number | null = null,
  ) => ({ type, minChars, maxChars: null, options });
  const live = new Set([1, 2]);

  it('switched to Number: a text answer breaks it, a number fits', () => {
    expect(
      storedAnswerFit(col('NUMBER'), { value: 'abc', dropDownId: null }, live),
    ).toEqual({ problem: 'Numbers only' });
    expect(
      storedAnswerFit(col('NUMBER'), { value: '12.5', dropDownId: null }, live)
        .problem,
    ).toBeNull();
  });

  it('a new minimum breaks a shorter answer', () => {
    expect(
      storedAnswerFit(
        col('TEXT', [], 4),
        { value: 'ab', dropDownId: null },
        live,
      ).problem,
    ).toBe('At least 4 characters');
  });

  it('a dropdown option removed while used breaks it; a kept one fits', () => {
    const c = col('DROPDOWN', [{ id: 2, label: 'B' }]);
    expect(
      storedAnswerFit(c, { value: 'A', dropDownId: 1 }, live).problem,
    ).toBe('Not one of the options');
    expect(
      storedAnswerFit(c, { value: 'B', dropDownId: 2 }, live).problem,
    ).toBeNull();
  });

  it('text → dropdown: an answer naming a new option is re-pointed', () => {
    const c = col('DROPDOWN', [{ label: 'Yes' }, { label: 'No' }]);
    expect(
      storedAnswerFit(c, { value: ' yes ', dropDownId: null }, live),
    ).toEqual({
      problem: null,
      label: 'Yes',
    });
    expect(
      storedAnswerFit(c, { value: 'maybe', dropDownId: null }, live).problem,
    ).toBe('Not one of the options');
  });

  it('an answer whose option was already gone never blocks', () => {
    expect(
      storedAnswerFit(col('NUMBER'), { value: 'old', dropDownId: 9 }, live)
        .problem,
    ).toBeNull();
  });
});
