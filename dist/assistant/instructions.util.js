"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_PITCH_KEY = exports.NO_TEXTS = exports.isExtraKey = exports.MAX_INSTRUCTION_CHARS = exports.STRONG_KEYS = exports.LOCKED_KEYS = exports.isFixedKey = exports.FIXED_ASSISTANT_KEYS = exports.TARGET_DESCRIPTIONS = exports.isInstructionTarget = exports.INSTRUCTION_TARGETS = void 0;
exports.extraKeyFor = extraKeyFor;
exports.cleanInstructionText = cleanInstructionText;
exports.assistantTexts = assistantTexts;
exports.extrasBlock = extrasBlock;
exports.salesTexts = salesTexts;
exports.fillPlaceholders = fillPlaceholders;
exports.INSTRUCTION_TARGETS = [
    'ASSISTANT',
    'ATTACHMENT_READER',
    'MATCHER',
    'STATEMENT_READER',
    'PRODUCT_CATEGORIZER',
    'BANK_FEED_CATEGORIZER',
    'SALES',
];
const isInstructionTarget = (t) => typeof t === 'string' &&
    exports.INSTRUCTION_TARGETS.includes(t);
exports.isInstructionTarget = isInstructionTarget;
exports.TARGET_DESCRIPTIONS = {
    ASSISTANT: 'the chat / text / WhatsApp / email / phone assistant that talks to the customer',
    ATTACHMENT_READER: 'the vision step that reads an uploaded or texted file (receipt, invoice, cheque, deposit slip, letter…): what kind of document it is, vendor, date, amounts, items',
    MATCHER: 'the step that chooses which bank transaction a read receipt / cheque belongs to, among candidates the code already narrowed by amount and date',
    STATEMENT_READER: 'the step that reads every row of a bank / credit-card statement PDF',
    PRODUCT_CATEGORIZER: 'the step that picks a category for each item on a receipt',
    BANK_FEED_CATEGORIZER: 'the step that names and categorizes bank-feed (Plaid) rows the rules and memories did not know',
    SALES: 'the AI salesperson that talks (text, WhatsApp, phone call) to people who have NO account yet and tries to get them to sign up',
};
exports.FIXED_ASSISTANT_KEYS = [
    'core',
    'core.safety',
    'core.answers',
    'core.issues',
    'core.channels',
    'channel.BOT',
    'channel.SMS',
    'channel.WHATSAPP',
    'channel.EMAIL',
    'channel.VOICE',
    'contact',
    'ask_ai',
    'files',
    'core.requests',
];
const isFixedKey = (k) => exports.FIXED_ASSISTANT_KEYS.includes(k);
exports.isFixedKey = isFixedKey;
exports.LOCKED_KEYS = ['core.safety'];
exports.STRONG_KEYS = ['strong.role', 'strong.app_guide'];
exports.MAX_INSTRUCTION_CHARS = 8000;
const isExtraKey = (k) => /^extra\.[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(k) && k.length <= 64;
exports.isExtraKey = isExtraKey;
function extraKeyFor(title) {
    const slug = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50)
        .replace(/-+$/g, '');
    return `extra.${slug || 'note'}`;
}
function cleanInstructionText(text) {
    if (typeof text !== 'string')
        return null;
    const t = text.replace(/\r\n/g, '\n').trim();
    return t ? t.slice(0, exports.MAX_INSTRUCTION_CHARS) : null;
}
exports.NO_TEXTS = { byKey: {}, extras: [] };
function assistantTexts(rows) {
    const out = { byKey: {}, extras: [] };
    const sorted = [...rows]
        .filter((r) => !r.isStrong && r.target === 'ASSISTANT')
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    for (const r of sorted) {
        if ((0, exports.isFixedKey)(r.key))
            out.byKey[r.key] = r.text;
        else if (r.text.trim())
            out.extras.push(r.text.trim());
    }
    return out;
}
function extrasBlock(rows, target) {
    const texts = [...rows]
        .filter((r) => !r.isStrong && r.target === target && r.text.trim())
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
        .map((r) => `- ${r.text.trim()}`);
    return texts.length
        ? `\n\nAdditional instructions from CYG Finance (follow them):\n${texts.join('\n')}`
        : '';
}
exports.SALES_PITCH_KEY = 'sales.pitch';
function salesTexts(rows) {
    const pitch = rows.find((r) => !r.isStrong && r.target === 'SALES' && r.key === exports.SALES_PITCH_KEY);
    return {
        pitch: pitch?.text.trim() || null,
        extras: extrasBlock(rows.filter((r) => r.key !== exports.SALES_PITCH_KEY), 'SALES'),
    };
}
function fillPlaceholders(text, values) {
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) => name in values ? values[name] : m);
}
//# sourceMappingURL=instructions.util.js.map