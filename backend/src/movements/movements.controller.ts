import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { MovementsService } from './movements.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';
import { InventoryWriteGuard } from '../shared/guards/inventory-write.guard';
import { parseBusinessDate } from '../shared/utils/business-date';

@Controller('movements')
@UseGuards(JwtAuthGuard)
export class MovementsController {
  constructor(private readonly movementsService: MovementsService) {}

  @Post()
  @UseGuards(InventoryWriteGuard)
  create(@Request() req, @Body() createMovementDto: CreateMovementDto) {
    return this.movementsService.create(req.user.userId, req.user.role, createMovementDto);
  }

  @Get()
  findAll(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('clientId') clientId?: string,
    @Query('costCenterId') costCenterId?: string,
  ) {
    const start = parseBusinessDate(startDate);
    const end = parseBusinessDate(endDate, true);

    return this.movementsService.findAll(
      parseInt(page),
      parseInt(limit),
      search,
      start,
      end,
      clientId ? parseInt(clientId) : undefined,
      costCenterId ? parseInt(costCenterId) : undefined,
      type as any,
      status as any,
    );
  }

  @Get('inventory-report')
  getInventoryReport() {
    return this.movementsService.getInventoryReport();
  }

  @Get('movements-report')
  getMovementsReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('currency') currency?: string,
    @Query('type') type?: string,
    @Query('clientId') clientId?: string,
    @Query('costCenterId') costCenterId?: string,
  ) {
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }

    const start = parseBusinessDate(startDate);
    const end = parseBusinessDate(endDate, true);

    return this.movementsService.getMovementsReport(
      start,
      end,
      currency || 'USD',
      type as any,
      clientId ? parseInt(clientId) : undefined,
      costCenterId ? parseInt(costCenterId) : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.movementsService.findOne(+id);
  }

  @Post(':id/reverse')
  @UseGuards(AdminRoleGuard)
  reverse(@Param('id') id: string, @Request() req) {
    return this.movementsService.reverse(+id, req.user.userId);
  }

  @Post(':id/approve')
  @UseGuards(AdminRoleGuard)
  approve(@Param('id') id: string, @Request() req) {
    return this.movementsService.approve(+id, req.user.userId);
  }

  @Post(':id/reject')
  @UseGuards(AdminRoleGuard)
  reject(@Param('id') id: string, @Request() req, @Body('reason') reason?: string) {
    return this.movementsService.reject(+id, req.user.userId, reason);
  }

  @Get(':id/voucher')
  generateVoucher(@Param('id') id: string) {
    return this.movementsService.generateVoucher(+id);
  }
}
