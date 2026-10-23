import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export declare const INTAKE_SYSTEM_TOKEN_TYPE = "intake-system";
export declare class IntakeSystemGuard implements CanActivate {
    private readonly jwt;
    constructor(config: ConfigService);
    canActivate(ctx: ExecutionContext): boolean;
}
