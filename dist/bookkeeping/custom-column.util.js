"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ANSWER_CHARS = exports.MAX_OPTIONS = exports.MAX_CUSTOM_COLUMNS = exports.CUSTOM_COLUMN_TYPES = void 0;
exports.cleanColumn = cleanColumn;
exports.answerProblem = answerProblem;
exports.CUSTOM_COLUMN_TYPES = [
    'TEXT',
    'LETTERS',
    'NUMBER',
    'DROPDOWN',
];
exports.MAX_CUSTOM_COLUMNS = 20;
exports.MAX_OPTIONS = 100;
exports.MAX_ANSWER_CHARS = 1000;
function cleanColumn(input) {
    const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name)
        return 'Give the column a name';
    if (name.length > 64)
        return 'A column name is at most 64 characters';
    const type = exports.CUSTOM_COLUMN_TYPES.find((t) => t === input.type);
    if (!type)
        return 'Pick what the column holds';
    const int = (v) => v === null || v === undefined || Number.isNaN(v) ? null : v;
    let minChars = type === 'DROPDOWN' ? null : int(input.minChars);
    let maxChars = type === 'DROPDOWN' ? null : int(input.maxChars);
    for (const v of [minChars, maxChars]) {
        if (v !== null && (!Number.isInteger(v) || v < 0 || v > exports.MAX_ANSWER_CHARS)) {
            return `Characters must be a whole number from 0 to ${exports.MAX_ANSWER_CHARS}`;
        }
    }
    if (minChars === 0)
        minChars = null;
    if (maxChars === 0)
        maxChars = null;
    if (minChars !== null && maxChars !== null && minChars > maxChars) {
        return 'The minimum is more than the maximum';
    }
    let options = [];
    if (type === 'DROPDOWN') {
        const seen = new Set();
        for (const o of input.options ?? []) {
            const label = (o.label ?? '').trim().replace(/\s+/g, ' ');
            if (!label)
                continue;
            if (label.length > 120)
                return 'An option is at most 120 characters';
            const k = label.toLowerCase();
            if (seen.has(k))
                return `“${label}” is in the list twice`;
            seen.add(k);
            options.push(o.id ? { id: o.id, label } : { label });
        }
        if (!options.length)
            return 'A dropdown needs at least one option';
        if (options.length > exports.MAX_OPTIONS) {
            return `A dropdown has at most ${exports.MAX_OPTIONS} options`;
        }
    }
    else {
        options = [];
    }
    return {
        name,
        type,
        minChars,
        maxChars,
        required: input.required === true,
        options,
    };
}
function answerProblem(rules, raw) {
    const v = raw.trim();
    if (!v)
        return null;
    if (v.length > exports.MAX_ANSWER_CHARS) {
        return `At most ${exports.MAX_ANSWER_CHARS} characters`;
    }
    if (rules.type === 'NUMBER' && !/^-?\d+(?:[.,]\d+)?$/.test(v)) {
        return 'Numbers only';
    }
    if (rules.type === 'LETTERS' && /\d/.test(v)) {
        return 'Text only — no digits';
    }
    if (rules.minChars !== null && v.length < rules.minChars) {
        return `At least ${rules.minChars} character${rules.minChars === 1 ? '' : 's'}`;
    }
    if (rules.maxChars !== null && v.length > rules.maxChars) {
        return `At most ${rules.maxChars} character${rules.maxChars === 1 ? '' : 's'}`;
    }
    return null;
}
//# sourceMappingURL=custom-column.util.js.map