import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
export declare const SYSTEM_PROMPT = "You are a bookkeeper for a small business. Each row below is one transaction from the business's bank or credit-card feed. For each row give:\n- name: the merchant, payee or payer in the description, as a short clean company or person name \u2014 e.g. \"WALMART SUPERCENTER #1234 TORONTO\" -> \"Walmart\", \"STRIPE TRANSFER ST-X9Y8\" -> \"Stripe\", \"GOOGLE *WORKSPACE\" -> \"Google Workspace\". Leave out store numbers, card digits, dates, cities and reference codes. null when no name can be identified (e.g. \"SERVICE CHARGE\", \"TRANSFER 0042\", \"INTEREST\").\n- category: the account it belongs in, from the allowed list only. Money in (amount > 0) is usually income or a transfer; money out (amount < 0) usually an expense. A payment to a credit card or a transfer between the owner's own accounts is \"Transfer Between Accounts\" or \"Credit Card Payment\" when those are in the list. \"hint\" is the bank's own category and only a hint. Answer \"Uncategorized\" when you truly cannot tell.\nReturn every key you were given, exactly as given.";
export interface RowToCategorize {
    key: string;
    description: string;
    merchant: string | null;
    amount: number;
    hint: string | null;
}
export declare class BankRowCategorizer {
    private readonly openai;
    private readonly config;
    constructor(openai: OpenAiClient, config: ConfigService);
    get configured(): boolean;
    private model;
    categorize(rows: readonly RowToCategorize[], rules?: string): Promise<Map<string, {
        name: string | null;
        category: string;
    }>>;
}
