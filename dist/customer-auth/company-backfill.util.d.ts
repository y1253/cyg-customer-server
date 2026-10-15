export interface BackfillCompany {
    id: number;
    businessName: string;
    privateEmail: string | null;
    personalName: string | null;
}
export interface BackfillPlan {
    create: {
        email: string;
        name: string;
        companyIds: number[];
    }[];
    link: {
        customerId: number;
        email: string;
        companyIds: number[];
    }[];
    skipped: {
        companyId: number;
        businessName: string;
        reason: string;
    }[];
}
export declare function normalizeEmail(raw: string | null): string | null;
export declare function planBackfill(companies: BackfillCompany[], existing: Map<string, number>): BackfillPlan;
