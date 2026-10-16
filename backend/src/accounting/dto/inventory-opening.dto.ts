import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class InventoryOpeningItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  countedQuantity: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  unitCost: number;
}

export class InventoryOpeningDto {
  @Type(() => Date)
  @IsDate()
  date: Date;

  @IsString()
  @MaxLength(500)
  description: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  inventoryAccountId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  openingEquityAccountId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InventoryOpeningItemDto)
  items: InventoryOpeningItemDto[];
}
