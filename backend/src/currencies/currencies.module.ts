import { Module } from '@nestjs/common';
import { CurrenciesService } from './currencies.service';
import { CurrenciesController } from './currencies.controller';
import { SharedModule } from '../shared/shared.module';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';

@Module({
  imports: [SharedModule],
  providers: [CurrenciesService, AdminRoleGuard],
  controllers: [CurrenciesController],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
