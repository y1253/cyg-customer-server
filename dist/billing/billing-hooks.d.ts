export declare const billingHooks: {
    allowText?: (customerId: number, purpose: string) => Promise<boolean>;
    usageChanged?: (customerId: number) => void;
};
