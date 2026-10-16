import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { MaintenanceService } from './maintenance.service';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';

@Controller('maintenance')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get('config')
  getConfig() {
    return this.maintenanceService.getConfig();
  }

  @Post('backup')
  backup(@Body() body: { outputDir?: string }) {
    return this.maintenanceService.backup(body?.outputDir);
  }

  @Post('restore')
  restore(@Body() body: { backupDir?: string }) {
    return this.maintenanceService.restore(body?.backupDir || '');
  }

  @Post('reset')
  reset(@Body() body: { confirm?: string; ackBackupWarning?: boolean }) {
    if (body?.confirm !== 'RESET') {
      return { ok: false, message: 'Confirmación requerida' };
    }
    if (body?.ackBackupWarning !== true) {
      return { ok: false, message: 'Debe confirmar que ya realizó un respaldo previo' };
    }
    return this.maintenanceService.reset();
  }
}
