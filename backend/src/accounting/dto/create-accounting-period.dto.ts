import { Type } from 'class-transformer';
import { IsDate, IsString, MaxLength } from 'class-validator';

export class CreateAccountingPeriodDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @Type(() => Date)
  @IsDate()
  startsAt: Date;

  @Type(() => Date)
  @IsDate()
  endsAt: Date;
}
