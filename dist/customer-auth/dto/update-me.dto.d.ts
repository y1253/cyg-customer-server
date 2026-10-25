export declare const CONTACT_METHODS: readonly ["EMAIL", "WHATSAPP", "SMS", "CALL"];
export type ContactMethod = (typeof CONTACT_METHODS)[number];
export declare class UpdateMeDto {
    name?: string;
    phone?: string | null;
    preferredContact?: ContactMethod | null;
    transactionAlerts?: boolean;
}
