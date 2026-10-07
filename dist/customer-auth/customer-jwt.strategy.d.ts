import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import { CustomerAuthService, type CustomerJwtPayload } from './customer-auth.service';
export interface CustomerRequestUser {
    customerId: number;
}
declare const CustomerJwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class CustomerJwtStrategy extends CustomerJwtStrategy_base {
    private readonly auth;
    constructor(config: ConfigService, auth: CustomerAuthService);
    validate(payload: Partial<CustomerJwtPayload>): Promise<CustomerRequestUser>;
}
export {};
