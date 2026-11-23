import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import type {
  ColumnFilter,
  LedgerQuery,
  SortState,
} from '../ledger-query.util';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const INT = /^\d+$/;
const INT_LIST = /^\d+(,\d+)*$/;

/**
 * step11 (2026-11-23): `GET bookkeeping/transactions/page` and `…/summary` — what the ledger
 * is narrowed to. Query strings, so numbers come as text; `filters` / `sort` are JSON.
 */
export class LedgerQueryDto {
  @IsOptional() @Matches(INT) offset?: string;
  @IsOptional() @Matches(INT) limit?: string;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @Matches(INT_LIST) statementIds?: string;
  @IsOptional() @IsString() @MaxLength(191) account?: string;
  @IsOptional() @Matches(INT) focusId?: string;
  @IsOptional() @IsString() @MaxLength(191) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @Matches(INT) subNameId?: string;
  @IsOptional() @Matches(ISO_DAY) from?: string;
  @IsOptional() @Matches(ISO_DAY) to?: string;
  @IsOptional() @IsString() @MaxLength(4000) filters?: string;
  @IsOptional() @IsString() @MaxLength(200) sort?: string;
  @IsOptional() @Matches(/^[01]$/) folded?: string;
  /** "Choose the transaction": closest to this amount / day first. */
  @IsOptional() @Matches(/^-?\d+(\.\d+)?$/) nearAmount?: string;
  @IsOptional() @Matches(ISO_DAY) nearDate?: string;
  /** Rank by `nearAmount` / `nearDate` (either may be absent). */
  @IsOptional() @Matches(/^1$/) near?: string;
}

const MAX_PAGE = 500;

function json<T>(text: string | undefined, what: string): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BadRequestException(`${what} must be JSON`);
  }
}

/** The DTO as a `LedgerQuery`, plus the page asked for (100 families by default). */
export function ledgerQueryOf(dto: LedgerQueryDto): {
  query: LedgerQuery;
  offset: number;
  limit: number;
} {
  const filters = json<Record<string, ColumnFilter>>(dto.filters, 'filters');
  if (
    filters !== undefined &&
    (typeof filters !== 'object' || filters === null)
  )
    throw new BadRequestException('filters must be an object');
  const sort = json<SortState | null>(dto.sort, 'sort');
  if (
    sort &&
    (typeof sort.key !== 'string' ||
      (sort.dir !== 'asc' && sort.dir !== 'desc'))
  )
    throw new BadRequestException('sort must be {key, dir: asc | desc}');
  return {
    query: {
      q: dto.q,
      statementIds: dto.statementIds?.split(',').map(Number),
      account: dto.account,
      focusId: dto.focusId ? Number(dto.focusId) : undefined,
      name: dto.name,
      description: dto.description,
      subNameId: dto.subNameId ? Number(dto.subNameId) : undefined,
      from: dto.from,
      to: dto.to,
      filters,
      sort: sort ?? null,
      folded: dto.folded === '1',
      near:
        dto.near === '1'
          ? {
              amount: dto.nearAmount ? Number(dto.nearAmount) : null,
              date: dto.nearDate ?? null,
            }
          : undefined,
    },
    offset: dto.offset ? Number(dto.offset) : 0,
    limit: Math.min(MAX_PAGE, Math.max(1, dto.limit ? Number(dto.limit) : 100)),
  };
}
