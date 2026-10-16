import { Module } from '@nestjs/common';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';

@Module({
  controllers: [CompanyController],
  providers: [CompanyService, AdminRoleGuard],
  exports: [CompanyService],
})
export class CompanyModule {}
