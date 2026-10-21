export declare function waIdOf(e164: string): string;
export declare function asE164(phone: string | null | undefined): string | null;
export declare const MAX_SMS_CHARS = 1500;
export declare const MAX_WHATSAPP_CHARS = 4096;
export declare function fitBody(body: string, max: number): string;
export declare function whatsappTextPayload(to: string, body: string): {
    messaging_product: string;
    recipient_type: string;
    to: string;
    type: string;
    text: {
        preview_url: boolean;
        body: string;
    };
};
export declare function smsForm(from: string, to: string, body: string): {
    From: string;
    To: string;
    Body: string;
};
