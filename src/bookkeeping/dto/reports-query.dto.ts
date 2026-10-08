import { IsOptional, Matches } from 'class-validator';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /api/bookkeeping/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` — both optional (all time). */
export class ReportsQueryDto {
  @IsOptional()
  @Matches(ISO_DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
