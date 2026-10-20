"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRuleTopic = exports.MAX_BLOCK_CHARS = exports.MAX_RULES_IN_PROMPT = exports.MAX_RULE_CHARS = exports.RULE_TOPICS = void 0;
exports.cleanRuleText = cleanRuleText;
exports.ruleKey = ruleKey;
exports.topicApplies = topicApplies;
exports.rulesBlock = rulesBlock;
exports.RULE_TOPICS = [
    'MATCHING',
    'CATEGORY',
    'NAMING',
    'GENERAL',
];
exports.MAX_RULE_CHARS = 200;
exports.MAX_RULES_IN_PROMPT = 40;
exports.MAX_BLOCK_CHARS = 2000;
const isRuleTopic = (t) => typeof t === 'string' && exports.RULE_TOPICS.includes(t);
exports.isRuleTopic = isRuleTopic;
function cleanRuleText(text) {
    if (typeof text !== 'string')
        return null;
    const one = text.replace(/\s+/g, ' ').trim();
    if (!one)
        return null;
    return one.slice(0, exports.MAX_RULE_CHARS);
}
function ruleKey(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
function topicApplies(ruleTopic, topic) {
    return !topic || ruleTopic === topic || ruleTopic === 'GENERAL';
}
function rulesBlock(rules, topic) {
    const seen = new Set();
    const ordered = [
        ...rules.filter((r) => !r.global),
        ...rules.filter((r) => r.global),
    ].filter((r) => topicApplies(r.topic, topic));
    const lines = [];
    let size = 0;
    for (const r of ordered) {
        const text = cleanRuleText(r.text);
        if (!text)
            continue;
        const key = ruleKey(text);
        if (!key || seen.has(key))
            continue;
        const line = `${lines.length + 1}. ${text}`;
        if (lines.length >= exports.MAX_RULES_IN_PROMPT ||
            size + line.length > exports.MAX_BLOCK_CHARS)
            break;
        seen.add(key);
        lines.push(line);
        size += line.length + 1;
    }
    if (!lines.length)
        return '';
    return `\n\nHouse rules learned from this firm's customers (follow them):\n${lines.join('\n')}`;
}
//# sourceMappingURL=rules.util.js.map