import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
export declare const INTAKE_AGENT_TOKEN_TYPE = "intake-agent";
export declare class IntakeAgentGuard implements CanActivate {
    private readonly prisma;
    private readonly jwt;
    constructor(config: ConfigService, prisma: PrismaService);
    canActivate(ctx: ExecutionContext): Promise<boolean>;
}
export declare const IntakeCustomer: (...dataOrPipes: unknown[]) => ParameterDecorator;
