import { Controller, Get, Patch, Param, Body, UseGuards, Post } from '@nestjs/common';
import { CurrenciesService } from './currencies.service';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';

@Controller('currencies')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Get()
  async findAll() {
    const list = await this.currenciesService.getAll();
    return { data: list };
  }

  @Post()
  async create(@Body() body: { code?: string; name?: string; rate?: number; isDefault?: boolean }) {
    const created = await this.currenciesService.createCurrency({
      code: body.code || '',
      name: body.name || '',
      rate: body.rate,
      isDefault: !!body.isDefault,
    });
    return { data: created };
  }

  @Patch(':code')
  async update(@Param('code') code: string, @Body() body: { rate?: number; isDefault?: boolean }) {
    let updated: any = null;
    if (typeof body.rate === 'number') {
      updated = await this.currenciesService.updateRate(code, body.rate);
    }
    if (body.isDefault === true) {
      updated = await this.currenciesService.setDefault(code);
    }
    return { data: updated };
  }

  @Post('external/:code')
  async refreshExternalRate(@Param('code') code: string) {
    const updated = await this.currenciesService.updateRateFromExternal(code);
    return { data: updated };
  }
}
