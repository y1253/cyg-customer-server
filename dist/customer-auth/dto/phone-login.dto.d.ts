export declare class PhoneLoginDto {
    phone: string;
    turnstileToken?: string;
}
export declare class PhoneLoginVerifyDto {
    phone: string;
    code: string;
}
export declare class PhoneSignupDto {
    phone: string;
    createdWith: 'SMS' | 'WHATSAPP' | 'CALL';
}
