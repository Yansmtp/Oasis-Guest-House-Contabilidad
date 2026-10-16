import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { MovementsService } from './movements.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';

@Controller('movements')
@UseGuards(JwtAuthGuard)
export class MovementsController {
  constructor(private readonly movementsService: MovementsService) {}

  @Post()
  create(@Request() req, @Body() createMovementDto: CreateMovementDto) {
    return this.movementsService.create(req.user.userId, createMovementDto);
  }

  @Get()
  findAll(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('clientId') clientId?: string,
    @Query('costCenterId') costCenterId?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    return this.movementsService.findAll(
      parseInt(page),
      parseInt(limit),
      type as any,
      start,
      end,
      clientId ? parseInt(clientId) : undefined,
      costCenterId ? parseInt(costCenterId) : undefined,
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

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Asegurar que el 'end' incluya todo el día (hasta 23:59:59.999)
    end.setHours(23, 59, 59, 999);

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

  @Get(':id/voucher')
  generateVoucher(@Param('id') id: string) {
    return this.movementsService.generateVoucher(+id);
  }
}
