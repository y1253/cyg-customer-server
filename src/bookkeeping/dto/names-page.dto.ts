import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const INT = /^\d+$/;

/**
 * step11 (2026-11-23): `GET bookkeeping/names/page` — one page of the Names tab's list.
 * `filter` = ALL or a group key (CUSTOMER / SUPPLIER / OTHER / g<id>); `q` = the search.
 */
export class NamesPageDto {
  @IsOptional() @Matches(INT) offset?: string;
  @IsOptional() @Matches(INT) limit?: string;
  @IsOptional()
  @Matches(/^(ALL|CUSTOMER|SUPPLIER|OTHER|g\d+)$/)
  filter?: string;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}

const MAX_PAGE = 200;

/** The DTO as a query + the page asked for (40 names by default). */
export function namesPageOf(dto: NamesPageDto): {
  filter: string;
  q: string;
  offset: number;
  limit: number;
} {
  return {
    filter: dto.filter ?? 'ALL',
    q: dto.q ?? '',
    offset: Number(dto.offset ?? 0),
    limit: Math.min(Math.max(Number(dto.limit ?? 40), 1), MAX_PAGE),
  };
}

/** `GET bookkeeping/names/unrecognized` — the nameless descriptions the search keeps. */
export class NamesSearchDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}
