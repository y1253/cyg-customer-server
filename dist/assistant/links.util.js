"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRESH_LINK_HINT = void 0;
exports.addLink = addLink;
exports.fillLinks = fillLinks;
exports.FRESH_LINK_HINT = '(ask me for a fresh link)';
const PLACEHOLDER = /\[\[\s*link\s*:\s*(\d+)\s*\]\]/gi;
const FILE_URL = /(?:https?:\/\/[^\s/()<>"']+)?\/api\/f\/[A-Za-z0-9._~-]+/g;
function addLink(book, url) {
    for (const [key, value] of book)
        if (value === url)
            return key;
    const key = `[[link:${book.size + 1}]]`;
    book.set(key, url);
    return key;
}
function fillLinks(text, book) {
    const issued = new Set(book?.values() ?? []);
    const cleaned = text.replace(FILE_URL, (url) => issued.has(url) ? url : exports.FRESH_LINK_HINT);
    return cleaned.replace(PLACEHOLDER, (_m, n) => book?.get(`[[link:${Number(n)}]]`) ?? exports.FRESH_LINK_HINT);
}
//# sourceMappingURL=links.util.js.map