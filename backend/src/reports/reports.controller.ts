import { Controller, Get, Query, Param, UseGuards, Res, BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { Response } from 'express';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  private parseRequiredDate(value?: string, fieldName: string = 'date') {
    if (!value) {
      throw new BadRequestException(`${fieldName} es obligatorio`);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${fieldName} no es una fecha valida`);
    }
    return d;
  }

  @Get('stock')
  getStockReport(@Query('currency') currency?: string) {
    return this.reportsService.getStockReport(currency || 'USD');
  }

  private parseForecastPeriod(value?: string) {
    if (!value) return 'monthly';
    const normalized = String(value).toLowerCase();
    if (normalized === 'weekly' || normalized === 'monthly') {
      return normalized as 'weekly' | 'monthly';
    }
    throw new BadRequestException('period debe ser weekly o monthly');
  }

  private parsePositiveInteger(value?: string, defaultValue: number = 3) {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new BadRequestException('historyMonths debe ser un número entero mayor a cero');
    }
    return Math.min(12, parsed);
  }

  private parseStockForecastStatus(value?: string) {
    if (!value) return ['all'];
    const statuses = String(value)
      .split(',')
      .map(item => String(item || '').trim().toUpperCase())
      .filter(Boolean);

    const normalized = statuses
      .map(status => {
        if (status === 'ALL') return 'all';
        if (['AGOTADO', 'ATENCION', 'CRITICO', 'SIN_CONSUMO', 'OK', 'PRONTO'].includes(status)) {
          return status;
        }
        return null;
      })
      .filter(Boolean) as any[];

    if (normalized.includes('all') || normalized.length === 0) {
      return ['all'];
    }
    return Array.from(new Set(normalized));
  }

  @Get('stock-forecast')
  getStockForecast(
    @Query('period') period?: string,
    @Query('historyMonths') historyMonths?: string,
    @Query('status') status?: string,
  ) {
    return this.reportsService.getStockForecast({
      period: this.parseForecastPeriod(period),
      historyMonths: this.parsePositiveInteger(historyMonths, 3),
      status: this.parseStockForecastStatus(status) as any,
    });
  }

  @Get('stock-forecast/export')
  async exportStockForecastExcel(
    @Res() res: Response,
    @Query('period') period?: string,
    @Query('historyMonths') historyMonths?: string,
    @Query('status') status?: string,
  ) {
    const exportFile = await this.reportsService.exportStockForecastExcel({
      period: this.parseForecastPeriod(period),
      historyMonths: this.parsePositiveInteger(historyMonths, 3),
      status: this.parseStockForecastStatus(status) as any,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFile.filename}"`);
    res.send(exportFile.buffer);
  }

  @Get('client/:id')
  getClientReport(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('currency') currency?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    
    return this.reportsService.getClientReport(+id, start, end, currency || 'USD');
  }

  @Get('cost-center/:id')
  getCostCenterReport(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('currency') currency?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    
    return this.reportsService.getCostCenterReport(+id, start, end, currency || 'USD');
  }

  @Get('product/:id/history')
  getProductMovementHistory(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    
    return this.reportsService.getProductMovementHistory(+id, start, end);
  }

  @Get('movements/export')
  async exportMovementsReportExcel(
    @Res() res: Response,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('currency') currency?: string,
    @Query('type') type?: string,
    @Query('clientId') clientId?: string,
    @Query('costCenterId') costCenterId?: string,
  ) {
    const start = this.parseRequiredDate(startDate, 'startDate');
    const end = this.parseRequiredDate(endDate, 'endDate');
    end.setHours(23, 59, 59, 999);

    const exportFile = await this.reportsService.exportMovementsReportExcel({
      startDate: start,
      endDate: end,
      currency: currency || 'USD',
      type: type as any,
      clientId: clientId ? parseInt(clientId, 10) : undefined,
      costCenterId: costCenterId ? parseInt(costCenterId, 10) : undefined,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFile.filename}"`);
    res.send(exportFile.buffer);
  }

  @Get('movements/invoice-export')
  async exportMovementsInvoiceExcel(
    @Res() res: Response,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('currency') currency?: string,
    @Query('type') type?: string,
    @Query('clientId') clientId?: string,
    @Query('costCenterId') costCenterId?: string,
    @Query('invoiceNumber') invoiceNumber?: string,
  ) {
    const start = this.parseRequiredDate(startDate, 'startDate');
    const end = this.parseRequiredDate(endDate, 'endDate');
    end.setHours(23, 59, 59, 999);

    const exportFile = await this.reportsService.exportMovementsInvoiceExcel({
      startDate: start,
      endDate: end,
      currency: currency || 'USD',
      type: type as any,
      clientId: clientId ? parseInt(clientId, 10) : undefined,
      costCenterId: costCenterId ? parseInt(costCenterId, 10) : undefined,
      invoiceNumber,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFile.filename}"`);
    res.send(exportFile.buffer);
  }
}
