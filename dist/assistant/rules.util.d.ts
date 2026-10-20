export declare const RULE_TOPICS: readonly ["MATCHING", "CATEGORY", "NAMING", "GENERAL"];
export type RuleTopic = (typeof RULE_TOPICS)[number];
export declare const MAX_RULE_CHARS = 200;
export declare const MAX_RULES_IN_PROMPT = 40;
export declare const MAX_BLOCK_CHARS = 2000;
export interface PromptRule {
    text: string;
    topic: string;
    global: boolean;
}
export declare const isRuleTopic: (t: unknown) => t is RuleTopic;
export declare function cleanRuleText(text: unknown): string | null;
export declare function ruleKey(text: string): string;
export declare function topicApplies(ruleTopic: string, topic?: RuleTopic): boolean;
export declare function rulesBlock(rules: readonly PromptRule[], topic?: RuleTopic): string;
