import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { AiInstruction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { planSync } from './instructions-builtin';
import {
  assistantTexts,
  cleanInstructionText,
  extrasBlock,
  extraKeyFor,
  isExtraKey,
  isFixedKey,
  isInstructionTarget,
  LOCKED_KEYS,
  NO_TEXTS,
  type AssistantTexts,
  type InstructionTarget,
} from './instructions.util';

/** How long the rows are cached — also how soon an edit made in the internal app shows. */
const CACHE_MS = 60_000;

/** Who changed a row, written to `AiInstructionChange`. */
export interface ChangeBy {
  by: 'STRONG_AI' | 'STAFF' | 'SEED';
  reason: string;
  escalationId?: number | null;
  staffUserId?: number | null;
}

/**
 * The AI's instructions as rows (step12, `AiInstruction`): the regular assistant's prompt
 * blocks, the extra instructions of the other AI steps, and the strong AI's own prompt.
 * Reads are cached for a minute and never throw (the code's defaults stand in); every write
 * leaves an `AiInstructionChange` (the internal app shows and reverts them). At start the
 * built-in rows are synced from the code (`planSync`).
 */
@Injectable()
export class InstructionsService implements OnModuleInit {
  private readonly logger = new Logger(InstructionsService.name);
  private cache: { at: number; rows: AiInstruction[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Not awaited: a slow or missing table must never hold up the API's start.
    void this.syncBuiltins().catch((err) =>
      this.logger.warn(
        `instruction sync failed: ${err instanceof Error ? err.message : err}`,
      ),
    );
  }

  /**
   * Inserts the built-in rows that are missing and refreshes the ones nobody edited since the
   * last sync (`planSync`), each with a SEED change. This is how a change to
   * `DEFAULT_INSTRUCTIONS` or the strong AI's guide reaches the database on deploy.
   */
  async syncBuiltins(): Promise<{ created: number; updated: number }> {
    const rows = await this.prisma.aiInstruction.findMany({
      select: {
        id: true,
        key: true,
        text: true,
        changes: { orderBy: { id: 'desc' }, take: 1, select: { by: true } },
      },
    });
    const plan = planSync(
      rows.map((r) => ({
        id: r.id,
        key: r.key,
        text: r.text,
        lastChangeBy: r.changes[0]?.by ?? null,
      })),
    );
    for (const b of plan.create) {
      await this.prisma.aiInstruction
        .create({
          data: {
            key: b.key,
            target: 'ASSISTANT',
            title: b.title,
            text: b.text,
            isStrong: b.isStrong,
            locked: b.locked,
            sortOrder: b.sortOrder,
            changes: {
              create: {
                action: 'CREATE',
                afterText: b.text,
                by: 'SEED',
                reason: 'Built-in instruction',
              },
            },
          },
        })
        // Another start won the race for this key: nothing to do.
        .catch(() => undefined);
    }
    for (const { row, to } of plan.update) {
      await this.prisma.aiInstruction.update({
        where: { id: row.id },
        data: {
          text: to.text,
          title: to.title,
          changes: {
            create: {
              action: 'UPDATE',
              beforeText: row.text,
              afterText: to.text,
              by: 'SEED',
              reason: 'Built-in instruction updated in the code',
            },
          },
        },
      });
    }
    if (plan.create.length || plan.update.length) {
      this.cache = null;
      this.logger.log(
        `instructions synced: ${plan.create.length} added, ${plan.update.length} updated`,
      );
    }
    return { created: plan.create.length, updated: plan.update.length };
  }

  private async rows(): Promise<AiInstruction[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.rows;
    }
    try {
      const rows = await this.prisma.aiInstruction.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
      this.cache = { at: Date.now(), rows };
      return rows;
    } catch (err) {
      this.logger.warn(
        `instructions read failed: ${err instanceof Error ? err.message : err}`,
      );
      return this.cache?.rows ?? [];
    }
  }

  /** The regular assistant's blocks ({} = the built-in prompt). Never throws. */
  async assistant(): Promise<AssistantTexts> {
    const rows = await this.rows();
    return rows.length ? assistantTexts(rows) : NO_TEXTS;
  }

  /** The extra instructions of another AI step ('' when none). Never throws. */
  async block(target: InstructionTarget): Promise<string> {
    return extrasBlock(await this.rows(), target);
  }

  /** The strong AI's own rows, in order. */
  async strong(): Promise<AiInstruction[]> {
    return (await this.rows()).filter((r) => r.isStrong);
  }

  /** Every live regular row (what the strong AI may read). */
  async regular(): Promise<AiInstruction[]> {
    return (await this.rows()).filter((r) => !r.isStrong);
  }

  async history(instructionId: number, take = 20) {
    return this.prisma.aiInstructionChange.findMany({
      where: { instructionId },
      orderBy: { id: 'desc' },
      take,
    });
  }

  // ---- writes (the strong AI) ---------------------------------------------------------

  /**
   * A row the strong AI may change: live, regular, not locked. Fixed keys come into
   * existence on their first edit (the seed may not have run yet).
   */
  private async editable(key: string): Promise<AiInstruction | null> {
    if (LOCKED_KEYS.includes(key) || key.startsWith('strong.')) {
      throw new ForbiddenException(`"${key}" can only be changed by staff`);
    }
    const row = await this.prisma.aiInstruction.findUnique({ where: { key } });
    if (row && (row.locked || row.isStrong)) {
      throw new ForbiddenException(`"${key}" can only be changed by staff`);
    }
    return row && !row.deletedAt ? row : null;
  }

  /**
   * Replace a block's text. A fixed key with no row yet starts from `currentText` (the
   * built-in default the caller passes), so the change log shows what it was.
   */
  async update(
    key: string,
    text: unknown,
    who: ChangeBy,
    currentText?: string,
  ): Promise<AiInstruction> {
    const clean = cleanInstructionText(text);
    if (clean === null) throw new BadRequestException('Text is empty');
    const row = await this.editable(key);
    if (!row && !isFixedKey(key)) {
      throw new NotFoundException(`No instruction "${key}"`);
    }
    const saved = await this.prisma.$transaction(async (tx) => {
      const next = row
        ? await tx.aiInstruction.update({
            where: { id: row.id },
            data: { text: clean },
          })
        : await tx.aiInstruction.upsert({
            // A soft-deleted fixed row comes back.
            where: { key },
            update: { text: clean, deletedAt: null },
            create: {
              key,
              target: 'ASSISTANT',
              title: key,
              text: clean,
              sortOrder: 10,
            },
          });
      await tx.aiInstructionChange.create({
        data: {
          instructionId: next.id,
          action: 'UPDATE',
          beforeText: row?.text ?? currentText ?? null,
          afterText: clean,
          ...this.changeData(who),
        },
      });
      return next;
    });
    this.cache = null;
    return saved;
  }

  /** A new `extra.*` block for a target. */
  async create(
    input: { title: unknown; text: unknown; target?: unknown },
    who: ChangeBy,
  ): Promise<AiInstruction> {
    const title =
      typeof input.title === 'string' ? input.title.trim().slice(0, 120) : '';
    const text = cleanInstructionText(input.text);
    if (!title || text === null) {
      throw new BadRequestException('Title and text are required');
    }
    const target = isInstructionTarget(input.target)
      ? input.target
      : 'ASSISTANT';
    let key = extraKeyFor(title);
    const taken = await this.prisma.aiInstruction.findUnique({
      where: { key },
    });
    if (taken) key = `${key.slice(0, 54)}-${Date.now().toString(36)}`;
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.aiInstruction.create({
        data: { key, target, title, text, sortOrder: 200 },
      });
      await tx.aiInstructionChange.create({
        data: {
          instructionId: row.id,
          action: 'CREATE',
          afterText: text,
          ...this.changeData(who),
        },
      });
      return row;
    });
    this.cache = null;
    return saved;
  }

  /** Soft-deletes an `extra.*` block (a fixed block can only be rewritten). */
  async remove(key: string, who: ChangeBy): Promise<void> {
    if (!isExtraKey(key)) {
      throw new ForbiddenException(
        `"${key}" is a fixed block — rewrite it with update_instruction instead`,
      );
    }
    const row = await this.editable(key);
    if (!row) throw new NotFoundException(`No instruction "${key}"`);
    await this.prisma.$transaction([
      this.prisma.aiInstruction.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.aiInstructionChange.create({
        data: {
          instructionId: row.id,
          action: 'DELETE',
          beforeText: row.text,
          ...this.changeData(who),
        },
      }),
    ]);
    this.cache = null;
  }

  private changeData(who: ChangeBy) {
    return {
      by: who.by,
      reason: who.reason.slice(0, 2000),
      escalationId: who.escalationId ?? null,
      staffUserId: who.staffUserId ?? null,
    };
  }
}
