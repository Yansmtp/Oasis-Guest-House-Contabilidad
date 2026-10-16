import { IsString, IsOptional, IsNumber, Min, IsUrl, Length, Matches } from 'class-validator';

export class UpdateCompanyDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  taxId?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsUrl()
  @IsOptional()
  website?: string;

  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Za-z]{3}$/)
  @IsOptional()
  functionalCurrencyCode?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  lowStockThreshold?: number;
}