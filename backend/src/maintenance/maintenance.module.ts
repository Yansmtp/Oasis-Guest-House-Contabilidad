import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';

@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService, AdminRoleGuard],
})
export class MaintenanceModule {}
