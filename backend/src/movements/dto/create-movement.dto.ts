import { IsEnum, IsOptional, IsString, IsNumber, IsArray, ValidateNested, IsDate, IsInt, Min, IsBoolean, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { MovementType } from '@prisma/client';
import { MovementDetailDto } from './movement-detail.dto';

export class CreateMovementDto {
  @IsEnum(MovementType)
  type: MovementType;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  date?: Date;

  @IsString()
  @IsOptional()
  documentNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsBoolean()
  @IsOptional()
  isAdjustment?: boolean;

  @IsNumber()
  @IsOptional()
  clientId?: number;

  @IsNumber()
  @IsOptional()
  costCenterId?: number;

  @IsString()
  @IsOptional()
  currencyCode?: string;

  @IsNumber()
  @IsOptional()
  rateAtTransaction?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  counterpartAccountId?: number;

  @IsString()
  @IsOptional()
  adminPassword?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MovementDetailDto)
  details: MovementDetailDto[];
}
