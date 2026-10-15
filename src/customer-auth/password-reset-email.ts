/** Subject + plain-text and HTML bodies of the password reset / set email. Pure. */
export function buildPasswordCodeEmail(
  code: string,
  minutes: number,
): { subject: string; text: string; html: string } {
  const subject = `${code} is your CYG Finance password code`;
  const text = [
    'Someone asked to set a new password for your CYG Finance account.',
    '',
    `Your code is: ${code}`,
    '',
    `Enter it to choose your new password. It expires in ${minutes} minutes.`,
    '',
    "If this wasn't you, you can ignore this email — your password has not changed.",
  ].join('\n');
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>Someone asked to set a new password for your CYG Finance account.</p>` +
    `<p>Your code is:</p>` +
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:8px 0">${code}</p>` +
    `<p>Enter it to choose your new password. It expires in ${minutes} minutes.</p>` +
    `<p style="color:#777">If this wasn't you, you can ignore this email — your password has not changed.</p>` +
    `</div>`;
  return { subject, text, html };
}
