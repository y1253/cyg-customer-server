export declare function buildSignupCodeEmail(code: string, minutes: number): {
    subject: string;
    text: string;
    html: string;
};
export declare function buildEmailConfirmCodeEmail(code: string, minutes: number): {
    subject: string;
    text: string;
    html: string;
};
