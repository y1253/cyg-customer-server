import { isHallucinatedTranscript } from './transcript-hygiene.util';

describe('isHallucinatedTranscript — the reported artefact', () => {
  it.each([
    'Thank you for watching.',
    'thank you for watching',
    'THANK YOU FOR WATCHING!',
    '  Thank you for watching!!  ',
    'Thanks for watching.',
    'Thank you.',
    'You',
    'Bye.',
  ])('rejects %j', (text) => {
    expect(isHallucinatedTranscript(text)).toBe(true);
  });

  it('rejects the French twin, with or without accents', () => {
    expect(
      isHallucinatedTranscript(
        "Sous-titres réalisés par la communauté d'Amara.org",
      ),
    ).toBe(true);
    expect(
      isHallucinatedTranscript(
        "Sous-titres realises par la communaute d'Amara.org",
      ),
    ).toBe(true);
  });

  it('rejects bracketed stage directions', () => {
    expect(isHallucinatedTranscript('[MUSIC]')).toBe(true);
    expect(isHallucinatedTranscript('(Applause)')).toBe(true);
    expect(isHallucinatedTranscript('[BLANK_AUDIO]')).toBe(true);
  });
});

describe('isHallucinatedTranscript — silence', () => {
  it.each(['', '   ', '\n\t', '...', '♪♪♪'])(
    'treats %j as nothing heard',
    (text) => {
      expect(isHallucinatedTranscript(text)).toBe(true);
    },
  );
});

/**
 * The half that matters most. A denylist applied as a SUBSTRING would delete every one of
 * these, and the user would never learn why their sentence vanished.
 */
describe('isHallucinatedTranscript — real speech is never touched', () => {
  it.each([
    'hi what’s doing',
    'Thanks for watching the video I sent you yesterday.',
    'Thank you for the invoice, I will pay it on Friday.',
    'Tell them thank you and that we are closed Monday.',
    'You should call the accountant back before five.',
    'Merci beaucoup pour les documents, je les envoie demain.',
    'Bye for now, talk tomorrow.',
    'The music licence renewal is due in March.',
  ])('keeps %j', (text) => {
    expect(isHallucinatedTranscript(text)).toBe(false);
  });

  it('keeps a one-word answer that is not an artefact', () => {
    expect(isHallucinatedTranscript('Yes')).toBe(false);
    expect(isHallucinatedTranscript('Approved.')).toBe(false);
  });
});
