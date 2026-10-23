function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A plain-text AI answer as a simple HTML email: line breaks kept, links clickable. */
export function answerHtml(text: string): string {
  const body = escapeHtml(text).replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${body}</div>`;
}
