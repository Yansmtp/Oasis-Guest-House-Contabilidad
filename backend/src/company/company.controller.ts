import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CompanyService } from './company.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';

@Controller('company')
@UseGuards(JwtAuthGuard)
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  findOne() {
    return this.companyService.findOne();
  }

  @Put(':id')
  @UseGuards(AdminRoleGuard)
  update(@Param('id') id: string, @Body() updateCompanyDto: UpdateCompanyDto) {
    return this.companyService.update(+id, updateCompanyDto);
  }
}
