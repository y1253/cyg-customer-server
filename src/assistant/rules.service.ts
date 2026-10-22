import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { scopeWhere, type BookScope } from '../bookkeeping/scope';
import { InstructionsService } from './instructions.service';
import type { InstructionTarget } from './instructions.util';
import {
  cleanRuleText,
  isRuleTopic,
  ruleKey,
  rulesBlock,
  type RuleTopic,
} from './rules.util';

export interface CustomerRuleView {
  id: number;
  text: string;
  topic: string;
  createdAt: string;
}

/**
 * What the AI has learned (step11), and the block every AI step reads before it answers.
 *
 * - `AiRule` is firm-wide. One proposed from a customer's chat is PENDING until a staff
 *   member approves it in the internal app; only ACTIVE ones reach a prompt.
 * - `CustomerAiRule` is private to one book and applies at once.
 */
@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly instructions?: InstructionsService,
  ) {}

  /**
   * The "house rules" for this book's AI steps ('' when none). Never throws: a rules
   * outage must not stop a statement or a receipt from being read. step12: `target` puts
   * that AI step's extra instructions (`AiInstruction` rows the strong AI or staff wrote)
   * before the rules.
   */
  async promptBlock(
    scope: BookScope,
    topic?: RuleTopic,
    target?: InstructionTarget,
  ): Promise<string> {
    const extra =
      target && this.instructions ? await this.instructions.block(target) : '';
    return extra + (await this.rulesOnly(scope, topic));
  }

  private async rulesOnly(
    scope: BookScope,
    topic?: RuleTopic,
  ): Promise<string> {
    try {
      const [global, own] = await Promise.all([
        this.prisma.aiRule.findMany({
          where: { status: 'ACTIVE', deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 200,
          select: { text: true, topic: true },
        }),
        this.prisma.customerAiRule.findMany({
          where: { ...scopeWhere(scope), deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { text: true, topic: true },
        }),
      ]);
      return rulesBlock(
        [
          ...own.map((r) => ({ ...r, global: false })),
          ...global.map((r) => ({ ...r, global: true })),
        ],
        topic,
      );
    } catch (err) {
      this.logger.warn(
        `rules block failed: ${err instanceof Error ? err.message : err}`,
      );
      return '';
    }
  }

  /** A rule private to this book; returns false when it already has it. */
  async saveCustomerRule(
    scope: BookScope,
    text: string,
    topic: unknown,
    sourceMessageId: number | null = null,
  ): Promise<boolean> {
    const clean = cleanRuleText(text);
    if (!clean) return false;
    const existing = await this.prisma.customerAiRule.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      select: { text: true },
    });
    if (existing.some((r) => ruleKey(r.text) === ruleKey(clean))) return false;
    await this.prisma.customerAiRule.create({
      data: {
        ...scopeWhere(scope),
        text: clean,
        topic: isRuleTopic(topic) ? topic : 'GENERAL',
        sourceMessageId,
      },
    });
    return true;
  }

  /** A firm-wide rule, PENDING until staff approve it. False when it is already known. */
  async proposeGlobalRule(
    text: string,
    topic: unknown,
    sourceCustomerId: number,
    sourceMessageId: number | null = null,
  ): Promise<boolean> {
    const clean = cleanRuleText(text);
    if (!clean) return false;
    const existing = await this.prisma.aiRule.findMany({
      where: { deletedAt: null, status: { in: ['PENDING', 'ACTIVE'] } },
      select: { text: true },
    });
    if (existing.some((r) => ruleKey(r.text) === ruleKey(clean))) return false;
    await this.prisma.aiRule.create({
      data: {
        text: clean,
        topic: isRuleTopic(topic) ? topic : 'GENERAL',
        status: 'PENDING',
        sourceCustomerId,
        sourceMessageId,
      },
    });
    return true;
  }

  async listCustomerRules(scope: BookScope): Promise<CustomerRuleView[]> {
    const rows = await this.prisma.customerAiRule.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      topic: r.topic,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Soft delete; only a rule of this book. */
  async deleteCustomerRule(scope: BookScope, id: number): Promise<void> {
    const res = await this.prisma.customerAiRule.updateMany({
      where: { id, ...scopeWhere(scope), deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!res.count) throw new NotFoundException('Rule not found');
  }
}
