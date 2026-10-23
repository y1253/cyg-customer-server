export interface AccountStatus {
    unmatchedFiles: number;
    newDocuments: number;
    uncategorized: number;
    unrecognizedNames: number;
    statementsToReview: number;
    statementsWaiting: number;
}
export declare const nothingOpen: (s: AccountStatus) => boolean;
export declare function statusLines(s: AccountStatus): string[];
export interface StatusMessage {
    subject: string;
    text: string;
    html: string;
}
export declare function accountStatusMessage(input: {
    firstName: string;
    book: string;
    status: AccountStatus;
    link: string;
    sms: boolean;
    canCall?: boolean;
}): StatusMessage;
export declare function financialReportMessage(input: {
    firstName: string;
    book: string;
    period: string;
    income: number;
    expenses: number;
    net: number;
    uncategorized: number;
    link: string;
    sms: boolean;
}): StatusMessage;
