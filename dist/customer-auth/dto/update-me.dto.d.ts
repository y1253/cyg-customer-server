export declare const CONTACT_METHODS: readonly ["EMAIL", "WHATSAPP", "SMS"];
export type ContactMethod = (typeof CONTACT_METHODS)[number];
export declare class UpdateMeDto {
    name?: string;
    phone?: string | null;
    preferredContact?: ContactMethod | null;
}
