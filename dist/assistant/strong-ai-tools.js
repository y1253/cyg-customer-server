"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRITE_NAMES = exports.STRONG_TOOLS = exports.SHARED_READ_TOOL_NAMES = exports.VERDICTS = void 0;
exports.parseFinish = parseFinish;
exports.settleVerdict = settleVerdict;
exports.regularOutcome = regularOutcome;
exports.caseMessage = caseMessage;
const assistant_tools_1 = require("./assistant-tools");
const instructions_util_1 = require("./instructions.util");
const rules_util_1 = require("./rules.util");
exports.VERDICTS = ['FIXED', 'NOT_AN_ISSUE', 'UNSURE'];
const str = { type: 'string' };
const int = { type: 'integer' };
const obj = (properties, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});
exports.SHARED_READ_TOOL_NAMES = new Set(assistant_tools_1.READ_TOOLS.map((t) => t.name));
const OWN_TOOLS = [
    {
        name: 'get_attachment_full',
        description: 'Everything stored about one attachment of this book: the full reading (every document, items, totals, transcript), status, match note / error, the words sent with it, its channel, and the transaction it is attached to.',
        parameters: obj({ attachmentId: int }, ['attachmentId']),
    },
    {
        name: 'get_transaction',
        description: 'One transaction of this book with its statement, name, category, splits and attachments.',
        parameters: obj({ transactionId: int }, ['transactionId']),
    },
    {
        name: 'list_instructions',
        description: "Every instruction block of the regular AI steps: key, target, title, locked, and the full text. Blocks with no row yet show the built-in text (source 'default').",
        parameters: obj({}),
    },
    {
        name: 'get_instruction_history',
        description: 'The last changes to one instruction block (who, why, before / after).',
        parameters: obj({ key: str }, ['key']),
    },
    {
        name: 'update_instruction',
        description: 'Replace the WHOLE text of one instruction block (by key). Keep everything that is still right. Locked blocks are refused.',
        parameters: obj({ key: str, text: str, reason: str }, [
            'key',
            'text',
            'reason',
        ]),
    },
    {
        name: 'create_instruction',
        description: `Add a new instruction block to one AI step. Targets: ${instructions_util_1.INSTRUCTION_TARGETS.map((t) => `${t} = ${instructions_util_1.TARGET_DESCRIPTIONS[t]}`).join('; ')}.`,
        parameters: obj({
            target: { type: 'string', enum: [...instructions_util_1.INSTRUCTION_TARGETS] },
            title: str,
            text: str,
            reason: str,
        }, ['target', 'title', 'text', 'reason']),
    },
    {
        name: 'delete_instruction',
        description: 'Delete an added block (key extra.*). Fixed blocks can only be rewritten with update_instruction.',
        parameters: obj({ key: str, reason: str }, ['key', 'reason']),
    },
    {
        name: 'save_customer_rule',
        description: "A short rule (max 200 characters) private to THIS customer's book, live at once — for their own names, accounts or habits.",
        parameters: obj({ text: str, topic: { type: 'string', enum: [...rules_util_1.RULE_TOPICS] } }, ['text', 'topic']),
    },
    {
        name: 'delete_customer_rule',
        description: "Delete one of this book's learned rules (id from list_rules).",
        parameters: obj({ ruleId: int, reason: str }, ['ruleId', 'reason']),
    },
    {
        name: 'propose_global_rule',
        description: 'A short firm-wide rule (max 200 characters) — PENDING until staff approve it.',
        parameters: obj({ text: str, topic: { type: 'string', enum: [...rules_util_1.RULE_TOPICS] } }, ['text', 'topic']),
    },
    {
        name: 'finish',
        description: 'Your conclusion — call it once, at the end. summary = one or two plain sentences for staff. redo = what the regular assistant should now do for the customer with its own tools ("" when nothing).',
        parameters: obj({
            verdict: { type: 'string', enum: [...exports.VERDICTS] },
            summary: str,
            redo: str,
        }, ['verdict', 'summary', 'redo']),
    },
];
exports.STRONG_TOOLS = [
    ...assistant_tools_1.READ_TOOLS.filter((t) => t.name !== 'get_link'),
    ...OWN_TOOLS,
];
exports.WRITE_NAMES = new Set([
    'update_instruction',
    'create_instruction',
    'delete_instruction',
    'save_customer_rule',
    'delete_customer_rule',
    'propose_global_rule',
]);
function parseFinish(raw) {
    let a = {};
    try {
        a = (JSON.parse(raw || '{}') ?? {});
    }
    catch {
    }
    const verdict = exports.VERDICTS.includes(a.verdict)
        ? a.verdict
        : 'UNSURE';
    const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
    return {
        verdict,
        summary: text(a.summary, 2000) || 'No summary given.',
        redo: text(a.redo, 2000),
    };
}
function settleVerdict(f, changes) {
    return f.verdict === 'FIXED' && changes === 0
        ? { ...f, verdict: 'UNSURE' }
        : f;
}
function regularOutcome(f) {
    const redo = f.redo
        ? ` Now fix the customer's data with your tools: ${f.redo}`
        : '';
    switch (f.verdict) {
        case 'FIXED':
            return {
                instructions: `Our specialist checked and found the cause: ${f.summary} It has been fixed so it will not happen again. Apologise briefly and tell the customer it is fixed for next time.${redo}`,
                summary: 'Problem checked and fixed for next time',
                ok: true,
            };
        case 'NOT_AN_ISSUE':
            return {
                instructions: `Our specialist checked: no mistake in how we work (${f.summary}). Continue as you normally would — answer the customer and do what they ask.${redo}`,
                summary: 'Problem checked — no mistake found',
                ok: true,
            };
        default:
            return {
                instructions: `Our specialist could not confirm a mistake in how we work (${f.summary}). Continue as you normally would — answer the customer and do what they ask.${redo}`,
                summary: 'Problem checked',
                ok: true,
            };
    }
}
function caseMessage(m) {
    const actions = Array.isArray(m.actions) ? m.actions : [];
    const did = actions.length
        ? `\n  [AI did: ${actions.map((a) => `${a.ok ? '' : 'FAILED '}${a.tool}: ${a.summary}`).join('; ')}]`
        : '';
    const warn = m.warning ? `\n  [warning: ${m.warning}]` : '';
    return `#${m.id} ${m.createdAt.toISOString().slice(0, 16)} ${m.role}: ${m.text.slice(0, 2000)}${did}${warn}`;
}
//# sourceMappingURL=strong-ai-tools.js.map