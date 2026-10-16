import { Module } from '@nestjs/common';
import { MovementsService } from './movements.service';
import { MovementsController } from './movements.controller';
import { ProductsModule } from '../products/products.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [ProductsModule, CurrenciesModule, AccountingModule],
  controllers: [MovementsController],
  providers: [MovementsService],
  exports: [MovementsService],
})
export class MovementsModule {}
