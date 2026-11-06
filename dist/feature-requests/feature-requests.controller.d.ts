import type { Request } from 'express';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { CreateFeatureRequestDto } from './dto/create-feature-request.dto';
import { FeatureRequestsService, type FeatureRequestView } from './feature-requests.service';
type AuthedRequest = Request & {
    user: CustomerRequestUser;
};
export declare class FeatureRequestsController {
    private readonly requests;
    constructor(requests: FeatureRequestsService);
    list(req: AuthedRequest): Promise<FeatureRequestView[]>;
    create(req: AuthedRequest, dto: CreateFeatureRequestDto): Promise<FeatureRequestView>;
}
export {};
