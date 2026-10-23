import type { Request } from 'express';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { FeatureRequestsService, type FeatureRequestView } from './feature-requests.service';
type AuthedRequest = Request & {
    user: CustomerRequestUser;
};
export declare class FeatureRequestsController {
    private readonly requests;
    constructor(requests: FeatureRequestsService);
    list(req: AuthedRequest): Promise<FeatureRequestView[]>;
}
export {};
