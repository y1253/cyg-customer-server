import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
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
import {
  AiSchedulesService,
  type AiScheduleView,
} from './ai-schedules.service';
import {
  AI_SCHEDULE_CHANNELS,
  type AiScheduleChannel,
} from './ai-schedules.store';
import { AI_FREQUENCIES, FREQUENCIES, type Frequency } from './next-run.util';
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

/** step12: a change to a schedule the AI made (the Schedules tab's custom rows). */
export class UpdateAiScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  task?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(AI_FREQUENCIES)
  frequency?: Frequency;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(28)
  monthDay?: number | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Choose a time like 06:00' })
  time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  /** EMAIL | SMS; null = the customer's preferred contact. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(AI_SCHEDULE_CHANNELS)
  channel?: AiScheduleChannel | null;
}

/**
 * `/api/bookkeeping/schedules` (step11b) — the Schedules tab: a book's weekly Account
 * Status Overview and monthly Financial Report, sent to the customer by the minute cron.
 */
@Controller('bookkeeping/schedules')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class SchedulesController {
  constructor(
    private readonly schedules: SchedulesService,
    private readonly aiSchedules: AiSchedulesService,
  ) {}

  // ---- step12: the schedules the customer asked the AI for ----------------------------
  // (two-segment paths, so they never meet `:type`)

  @Get('custom')
  listCustom(@Book() scope: BookScope): Promise<AiScheduleView[]> {
    return this.aiSchedules.list(scope);
  }

  @Put('custom/:id')
  updateCustom(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAiScheduleDto,
  ): Promise<AiScheduleView> {
    return this.aiSchedules.update(scope, id, dto);
  }

  @Delete('custom/:id')
  @HttpCode(204)
  removeCustom(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.aiSchedules.remove(scope, id);
  }

  @Post('custom/:id/send-now')
  @HttpCode(200)
  sendNowCustom(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AiScheduleView> {
    return this.aiSchedules.sendNow(scope, id);
  }

  // ---- the two built-ins ---------------------------------------------------------------

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
