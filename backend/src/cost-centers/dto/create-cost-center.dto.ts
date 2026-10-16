import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateCostCenterDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
