"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.answerHtml = answerHtml;
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function answerHtml(text) {
    const body = escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
    return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${body}</div>`;
}
//# sourceMappingURL=answer-html.js.map