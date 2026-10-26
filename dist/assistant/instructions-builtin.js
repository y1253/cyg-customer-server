"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_INSTRUCTIONS = void 0;
exports.planSync = planSync;
const assistant_prompt_1 = require("./assistant-prompt");
const sales_prompt_1 = require("../sales/sales-prompt");
const instructions_util_1 = require("./instructions.util");
const strong_ai_guide_1 = require("./strong-ai-guide");
const TITLES = {
    core: 'Who the assistant is and how it works',
    'core.safety': 'Safety (staff only)',
    'core.answers': 'Answering',
    'core.issues': 'When the customer says we got it wrong',
    'core.requests': "When the customer asks for something we can't do yet",
    'core.channels': 'Every channel: history, sending elsewhere, calls',
    contact: 'Preferred contact method',
    ask_ai: '"Ask AI" about one unfiled file',
    files: 'Files the customer just sent',
};
exports.BUILTIN_INSTRUCTIONS = [
    ...instructions_util_1.FIXED_ASSISTANT_KEYS.map((key, i) => ({
        key,
        title: TITLES[key] ?? `Channel style — ${key.slice('channel.'.length)}`,
        text: assistant_prompt_1.DEFAULT_INSTRUCTIONS[key],
        isStrong: false,
        locked: instructions_util_1.LOCKED_KEYS.includes(key),
        sortOrder: (i + 1) * 10,
    })),
    ...strong_ai_guide_1.STRONG_INSTRUCTIONS.map((s) => ({ ...s, isStrong: true, locked: true })),
    {
        key: instructions_util_1.SALES_PITCH_KEY,
        title: 'How the salesperson sells',
        text: sales_prompt_1.SALES_PITCH_DEFAULT,
        isStrong: false,
        locked: false,
        sortOrder: 10,
        target: 'SALES',
    },
];
function planSync(existing, builtins = exports.BUILTIN_INSTRUCTIONS) {
    const byKey = new Map(existing.map((r) => [r.key, r]));
    const plan = { create: [], update: [] };
    for (const b of builtins) {
        const row = byKey.get(b.key);
        if (!row)
            plan.create.push(b);
        else if (row.text !== b.text && row.lastChangeBy === 'SEED') {
            plan.update.push({ row, to: b });
        }
    }
    return plan;
}
//# sourceMappingURL=instructions-builtin.js.map