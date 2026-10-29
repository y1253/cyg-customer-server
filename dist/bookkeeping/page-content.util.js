"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageHasNothingToRead = pageHasNothingToRead;
exports.pagesToSkip = pagesToSkip;
exports.pageContents = pageContents;
const MONEY = /\d[\d,]*[.,]\d{2}(?!\d)/;
const PAGE_FOOTER = /\bpage\s+\d+(\s+of\s+\d+)?\b/gi;
const MIN_IMAGE_AREA_SHARE = 0.08;
const TEXT_PAGE_CHARS = 400;
function pageHasNothingToRead(content) {
    const text = content.text.replace(PAGE_FOOTER, ' ');
    if (MONEY.test(text))
        return false;
    if (text.replace(/\s/g, '').length >= TEXT_PAGE_CHARS)
        return true;
    const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const pageArea = area(content.bounds);
    const bigImage = content.images.some((b) => area(b) >= pageArea * MIN_IMAGE_AREA_SHARE);
    return !bigImage;
}
function pagesToSkip(contents) {
    const skip = new Set();
    contents.forEach((c, i) => {
        if (i > 0 && pageHasNothingToRead(c))
            skip.add(i);
    });
    return skip;
}
async function pageContents(pdf) {
    try {
        const mupdf = await import('mupdf');
        const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
        try {
            if (doc.needsPassword())
                return null;
            const out = [];
            const count = doc.countPages();
            for (let i = 0; i < count; i++) {
                const page = doc.loadPage(i);
                try {
                    const images = [];
                    const st = page.toStructuredText('preserve-images');
                    try {
                        st.walk({ onImageBlock: (bbox) => images.push([...bbox]) });
                        out.push({
                            text: st.asText(),
                            images,
                            bounds: page.getBounds(),
                        });
                    }
                    finally {
                        st.destroy();
                    }
                }
                finally {
                    page.destroy();
                }
            }
            return out;
        }
        finally {
            doc.destroy();
        }
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=page-content.util.js.map