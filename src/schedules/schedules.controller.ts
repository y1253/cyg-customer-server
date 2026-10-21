import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Book, BookScopeGuard } from '../bookkeeping/book-scope.guard';
import type { BookScope } from '../bookkeeping/scope';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import { FREQUENCIES, type Frequency } from './next-run.util';
import { SchedulesService, type ScheduleView } from './schedules.service';

export class UpdateScheduleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(FREQUENCIES)
  frequency?: Frequency;

  /** 0 = Sunday … 6 = Saturday (weekly). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number | null;

  /** 1–28, or 0 = the last day of the month (monthly). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(28)
  monthDay?: number | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Choose a time like 14:00' })
  time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

/**
 * `/api/bookkeeping/schedules` (step11b) — the Schedules tab: a book's weekly Account
 * Status Overview and monthly Financial Report, sent to the customer by the minute cron.
 */
@Controller('bookkeeping/schedules')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  list(@Book() scope: BookScope): Promise<ScheduleView[]> {
    return this.schedules.list(scope);
  }

  @Put(':type')
  update(
    @Book() scope: BookScope,
    @Param('type') type: string,
    @Body() dto: UpdateScheduleDto,
  ): Promise<ScheduleView> {
    return this.schedules.update(scope, SchedulesService.typeOf(type), dto);
  }

  @Post(':type/send-now')
  @HttpCode(200)
  sendNow(
    @Book() scope: BookScope,
    @Param('type') type: string,
  ): Promise<ScheduleView> {
    return this.schedules.sendNow(scope, SchedulesService.typeOf(type));
  }
}
