/** Subject + plain-text and HTML bodies of the signup verification email. Pure. */
export function buildSignupCodeEmail(
  code: string,
  minutes: number,
): { subject: string; text: string; html: string } {
  const subject = `${code} is your CYG Finance verification code`;
  const text = [
    'Welcome to CYG Finance!',
    '',
    `Your verification code is: ${code}`,
    '',
    `Enter it on the sign-up page to confirm your email address. It expires in ${minutes} minutes.`,
    '',
    "If you didn't try to create an account, you can ignore this email.",
  ].join('\n');
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>Welcome to CYG Finance!</p>` +
    `<p>Your verification code is:</p>` +
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:8px 0">${code}</p>` +
    `<p>Enter it on the sign-up page to confirm your email address. It expires in ${minutes} minutes.</p>` +
    `<p style="color:#777">If you didn't try to create an account, you can ignore this email.</p>` +
    `</div>`;
  return { subject, text, html };
}

/** step12c: the code that confirms an email added to an account opened by phone. Pure. */
export function buildEmailConfirmCodeEmail(
  code: string,
  minutes: number,
): { subject: string; text: string; html: string } {
  const subject = `${code} is your CYG Finance verification code`;
  const text = [
    `Your verification code is: ${code}`,
    '',
    `Enter it on the My account page to add this email to your CYG Finance account. It expires in ${minutes} minutes.`,
    '',
    "If you didn't ask for this, you can ignore this email.",
  ].join('\n');
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>Your verification code is:</p>` +
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:8px 0">${code}</p>` +
    `<p>Enter it on the My account page to add this email to your CYG Finance account. It expires in ${minutes} minutes.</p>` +
    `<p style="color:#777">If you didn't ask for this, you can ignore this email.</p>` +
    `</div>`;
  return { subject, text, html };
}
