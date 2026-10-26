import { type OnModuleInit } from '@nestjs/common';
import type { AiInstruction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type AssistantTexts, type InstructionTarget } from './instructions.util';
export interface ChangeBy {
    by: 'STRONG_AI' | 'STAFF' | 'SEED';
    reason: string;
    escalationId?: number | null;
    staffUserId?: number | null;
}
export declare class InstructionsService implements OnModuleInit {
    private readonly prisma;
    private readonly logger;
    private cache;
    constructor(prisma: PrismaService);
    onModuleInit(): void;
    syncBuiltins(): Promise<{
        created: number;
        updated: number;
    }>;
    private rows;
    assistant(): Promise<AssistantTexts>;
    block(target: InstructionTarget): Promise<string>;
    sales(): Promise<{
        pitch: string | null;
        extras: string;
    }>;
    strong(): Promise<AiInstruction[]>;
    regular(): Promise<AiInstruction[]>;
    history(instructionId: number, take?: number): Promise<{
        id: number;
        createdAt: Date;
        reason: string | null;
        instructionId: number;
        action: string;
        beforeText: string | null;
        afterText: string | null;
        by: string;
        staffUserId: number | null;
        escalationId: number | null;
        revertedAt: Date | null;
    }[]>;
    private editable;
    update(key: string, text: unknown, who: ChangeBy, currentText?: string): Promise<AiInstruction>;
    create(input: {
        title: unknown;
        text: unknown;
        target?: unknown;
    }, who: ChangeBy): Promise<AiInstruction>;
    remove(key: string, who: ChangeBy): Promise<void>;
    private changeData;
}
