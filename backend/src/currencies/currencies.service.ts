import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Currency as PrismaCurrency } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

declare const fetch: any;

export interface CurrencyEntry {
  code: string;
  name: string;
  rate: number;
  effectiveFrom?: Date;
  isDefault?: boolean;
}

@Injectable()
export class CurrenciesService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeCode(code: string): string {
    return String(code || '').trim().toUpperCase();
  }

  private async latestRates(codes: string[]) {
    if (!codes.length) return new Map<string, { rate: number; effectiveFrom: Date }>();
    const rows = await this.prisma.currencyRate.findMany({
      where: { code: { in: codes } },
      orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }],
    });
    const latest = new Map<string, { rate: number; effectiveFrom: Date }>();
    for (const row of rows) {
      if (!latest.has(row.code)) {
        latest.set(row.code, { rate: row.rate.toNumber(), effectiveFrom: row.effectiveFrom });
      }
    }
    return latest;
  }

  private requireRate(row: { rate: number; effectiveFrom?: Date } | undefined, code: string): CurrencyEntry {
    if (!row || !Number.isFinite(row.rate) || row.rate <= 0) {
      throw new BadRequestException(`No existe una tasa positiva registrada para ${code}`);
    }
    return { code, name: '', rate: row.rate, effectiveFrom: row.effectiveFrom };
  }

  async getAll(): Promise<CurrencyEntry[]> {
    const currencies = await this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    });
    const rates = await this.latestRates(currencies.map(currency => currency.code));
    return currencies.map(currency => ({
      code: currency.code,
      name: currency.name,
      isDefault: currency.isDefault,
      ...this.requireRate(rates.get(currency.code), currency.code),
    }));
  }

  async get(code: string): Promise<CurrencyEntry | null> {
    const normalized = this.normalizeCode(code);
    const currency: PrismaCurrency | null = await this.prisma.currency.findFirst({
      where: { code: normalized, isActive: true },
    });
    if (!currency) return null;
    const latest = (await this.latestRates([normalized])).get(normalized);
    return {
      ...this.requireRate(latest, normalized),
      name: currency.name,
      isDefault: currency.isDefault,
    };
  }

  async updateRate(code: string, rate: number) {
    const normalized = this.normalizeCode(code);
    if (normalized === 'EUR') {
      throw new BadRequestException('EUR está deshabilitada temporalmente');
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException('La tasa debe ser un número finito mayor que cero');
    }
    const currency = await this.prisma.currency.findFirst({
      where: { code: normalized, isActive: true },
      select: { code: true },
    });
    if (!currency) throw new NotFoundException('Currency not found');

    await this.prisma.currencyRate.create({
      data: { code: normalized, rate, effectiveFrom: new Date() },
    });
    return this.get(normalized);
  }

  private normalizeExternalNumber(value: string): number {
    let normalized = String(value || '').trim();
    if (normalized.includes('.') && normalized.includes(',')) {
      normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
    } else {
      normalized = normalized.replace(/,/g, '.');
    }
    const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException('No se pudo parsear la tasa externa');
    }
    return parsed;
  }

  async fetchExternalRate(code: string): Promise<number> {
    const normalizedCode = this.normalizeCode(code);
    if (normalizedCode !== 'CUP') {
      throw new NotFoundException('Solo CUP se puede obtener de la fuente externa');
    }

    const response = await fetch('https://www.eltoque.com');
    if (!response.ok) {
      throw new BadRequestException('No se pudo obtener datos de la fuente externa');
    }
    const html = await response.text();
    const match = html.match(/<tr[^>]*>\s*<td[^>]*>\s*<span[^>]*>\s*1\s*(?:<!--.*?-->)?\s*USD\s*<\/span>.*?<span[^>]*>\s*([0-9.,]+)\s*(?:<!--.*?-->)?\s*(?:&nbsp;|\s*)CUP\s*<\/span>/is);
    if (!match) {
      throw new BadRequestException('No se encontró la tasa CUP en el contenido externo');
    }

    const cupPerUsd = this.normalizeExternalNumber(match[1]);
    if (cupPerUsd <= 0) {
      throw new BadRequestException('La tasa CUP obtenida no es válida');
    }
    return 1 / cupPerUsd;
  }

  async updateRateFromExternal(code: string) {
    return this.updateRate(code, await this.fetchExternalRate(code));
  }

  async setDefault(code: string) {
    const normalized = this.normalizeCode(code);
    if (normalized === 'EUR') {
      throw new BadRequestException('EUR está deshabilitada temporalmente');
    }

    return this.prisma.$transaction(async tx => {
      const currency = await tx.currency.findFirst({
        where: { code: normalized, isActive: true },
      });
      if (!currency) throw new NotFoundException('Currency not found');

      await tx.currency.updateMany({ data: { isDefault: false } });
      await tx.currency.update({ where: { code: normalized }, data: { isDefault: true } });
      return currency;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createCurrency(input: { code: string; name: string; rate?: number; isDefault?: boolean }) {
    const code = this.normalizeCode(input.code);
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new BadRequestException('Código de moneda inválido');
    }
    if (code === 'EUR') {
      throw new BadRequestException('EUR está deshabilitada temporalmente');
    }
    const name = String(input.name || '').trim();
    if (!name) throw new BadRequestException('Nombre de moneda requerido');
    const rate = code === 'USD' ? 1 : Number(input.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException('La tasa debe ser mayor que 0');
    }

    try {
      await this.prisma.$transaction(async tx => {
        if (input.isDefault) await tx.currency.updateMany({ data: { isDefault: false } });
        await tx.currency.create({
          data: { code, name, isDefault: !!input.isDefault },
        });
        await tx.currencyRate.create({
          data: { code, rate, effectiveFrom: new Date() },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('La moneda ya existe');
      }
      throw error;
    }
    return this.get(code);
  }

  async getRateAt(code: string, at: Date): Promise<number> {
    const normalized = this.normalizeCode(code);
    if (normalized === 'USD') return 1;
    const currency = await this.prisma.currency.findFirst({
      where: { code: normalized, isActive: true },
      select: { code: true },
    });
    if (!currency) throw new NotFoundException(`La moneda ${normalized} no está configurada`);

    const row = await this.prisma.currencyRate.findFirst({
      where: { code: normalized, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
      select: { rate: true },
    });
    if (!row || !row.rate.gt(0)) {
      throw new BadRequestException(`No existe una tasa histórica de ${normalized} para la fecha indicada`);
    }
    return row.rate.toNumber();
  }
}
