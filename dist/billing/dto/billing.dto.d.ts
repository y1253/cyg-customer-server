export declare class QuoteDto {
    promoCode?: string;
}
export declare class CheckoutDto extends QuoteDto {
    paymentMethodId?: string;
}
export declare class CompleteDto {
    paymentIntentId: string;
}
