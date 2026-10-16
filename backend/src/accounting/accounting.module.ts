import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [AccountingController],
  providers: [AccountingService, AdminRoleGuard],
  exports: [AccountingService],
})
export class AccountingModule {}
