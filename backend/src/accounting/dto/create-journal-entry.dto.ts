import { JournalEntryKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateJournalLineDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  accountId: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  debit: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  credit: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  costCenterId?: number;

  @IsString()
  @IsOptional()
  @MaxLength(3)
  currencyCode?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @IsOptional()
  originalDebit?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @IsOptional()
  originalCredit?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0)
  @IsOptional()
  exchangeRate?: number;
}

export class CreateJournalEntryDto {
  @Type(() => Date)
  @IsDate()
  date: Date;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  reference?: string;

  @IsEnum(JournalEntryKind)
  @IsOptional()
  kind?: JournalEntryKind;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateJournalLineDto)
  lines: CreateJournalLineDto[];
}
