import { Injectable } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { MovementsService } from '../movements/movements.service';
import { ProductsService } from '../products/products.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { MovementStatus, Prisma, MovementType } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs/promises';

// Helper para convertir Decimal a number
function toNum(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null || value === '') return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

type MovementReportExportParams = {
  startDate: Date;
  endDate: Date;
  currency: string;
  type?: MovementType;
  clientId?: number;
  costCenterId?: number;
  invoiceNumber?: string;
};

type StockForecastPeriod = 'weekly' | 'monthly';
type StockForecastStatusFilter = 'all' | 'AGOTADO' | 'ATENCION' | 'CRITICO' | 'SIN_CONSUMO' | 'OK' | 'PRONTO';
type StockForecastParams = {
  period?: StockForecastPeriod;
  historyMonths?: number;
  status?: StockForecastStatusFilter | StockForecastStatusFilter[];
};

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private movementsService: MovementsService,
    private productsService: ProductsService,
    private currenciesService: CurrenciesService,
  ) {}

  private movementTypeLabel(type?: MovementType | string | null) {
    if (type === 'ENTRADA') return 'Entradas';
    if (type === 'SALIDA') return 'Salidas';
    return 'Entradas y Salidas';
  }

  private formatDate(date?: Date) {
    if (!date) return '';
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy}`;
  }

  private detectProductOrigin(product: { name?: string | null; description?: string | null }) {
    const text = `${product.name || ''} ${product.description || ''}`.toLowerCase();
    const missionPattern = /\b(logos?|logotipo|misi[oó]n|donaci[oó]n|donativo|ayuda)\b/;
    const marketPattern = /\b(mercado|cuba|comprad[oó]|supermercad[oó]|mercader[ií]a)\b/;

    if (missionPattern.test(text)) {
      return { origin: 'LOGOS_MISION', originLabel: 'Logos Misión', canDonate: true };
    }
    if (marketPattern.test(text)) {
      return { origin: 'MERCADO', originLabel: 'Mercado Cuba', canDonate: false };
    }
    return { origin: 'OTRO', originLabel: 'Otro', canDonate: false };
  }

  private formatFileDate(date: Date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  private median(values: number[]): number {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private percentile(values: number[], percentile: number): number {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * percentile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (upper >= sorted.length) return sorted[lower];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  private async resolveExistingTemplatePath(candidates: string[]) {
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        await fs.access(candidate);
        return candidate;
      } catch (e) {
        // noop
      }
    }
    return null;
  }

  private async nextInvoiceNumber(now: Date) {
    const year2 = String(now.getFullYear()).slice(-2);
    const rows = await this.prisma.$queryRaw<Array<{ sequence: number }>>(Prisma.sql`
      INSERT INTO "InvoiceSequence" ("year", "sequence")
      VALUES (${now.getFullYear()}, 1)
      ON CONFLICT ("year") DO UPDATE
      SET "sequence" = "InvoiceSequence"."sequence" + 1
      RETURNING "sequence"
    `);
    return `FCT${year2}${String(rows[0].sequence).padStart(4, '0')}`;
  }

  private async getMovementsReportData(params: MovementReportExportParams) {
    const normalizedType = (params.type === MovementType.ENTRADA || params.type === MovementType.SALIDA)
      ? params.type
      : undefined;
    const normalizedClientId = normalizedType === MovementType.SALIDA ? undefined : params.clientId;
    const normalizedCostCenterId = normalizedType === MovementType.ENTRADA ? undefined : params.costCenterId;

    const report = await this.movementsService.getMovementsReport(
      params.startDate,
      params.endDate,
      params.currency || 'USD',
      normalizedType,
      normalizedClientId,
      normalizedCostCenterId,
    );

    return {
      ...report,
      filters: {
        type: normalizedType || null,
        clientId: normalizedClientId || null,
        costCenterId: normalizedCostCenterId || null,
      },
    };
  }

  private async buildMovementsWorkbook(reportData: any, params: MovementReportExportParams) {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Reporte');
    const details = workbook.addWorksheet('Detalle');
    const summary: any = reportData.summary || {};
    const products = Object.values(summary.products || {}) as any[];

    ws.columns = [
      { width: 34 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 },
    ];

    ws.getCell('A1').value = 'REPORTE CASA OASIS - MOVIMIENTOS';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.mergeCells('A1:E1');

    ws.getCell('A2').value = `Tipo: ${this.movementTypeLabel(params.type)}`;
    ws.getCell('B2').value = `Desde: ${this.formatDate(params.startDate)}`;
    ws.getCell('C2').value = `Hasta: ${this.formatDate(params.endDate)}`;
    ws.getCell('D2').value = `Moneda: ${summary.currency || params.currency || 'USD'}`;
    ws.getCell('E2').value = `Generado: ${this.formatDate(new Date())}`;

    ws.getCell('A4').value = 'Resumen';
    ws.getCell('A4').font = { bold: true };
    ws.getRow(5).values = ['Entradas', 'Salidas', 'Valor Entradas', 'Valor Salidas', 'Tasa USD/CUP'];
    ws.getRow(5).font = { bold: true };
    ws.getRow(6).values = [
      Number(summary.totalEntries || 0),
      Number(summary.totalExits || 0),
      Number(summary.totalEntriesValue || 0),
      Number(summary.totalExitsValue || 0),
      summary.exchangeRateInfo
        ? `1 USD=${Number(summary.exchangeRateInfo.usdToCup || 0).toFixed(4)} CUP | 1 CUP=${Number(summary.exchangeRateInfo.cupToUsd || 0).toFixed(6)} USD`
        : '',
    ];

    ws.getCell('A8').value = 'Movimientos por producto';
    ws.getCell('A8').font = { bold: true };
    ws.getRow(9).values = ['Producto', 'Entradas (Cant.)', 'Entradas (Valor)', 'Salidas (Cant.)', 'Salidas (Valor)'];
    ws.getRow(9).font = { bold: true };
    let rowIndex = 10;
    for (const item of products) {
      ws.getRow(rowIndex).values = [
        item?.product?.name || '',
        Number(item?.entries || 0),
        Number(item?.entriesValue || 0),
        Number(item?.exits || 0),
        Number(item?.exitsValue || 0),
      ];
      rowIndex++;
    }

    details.columns = [
      { header: '#', key: 'idx', width: 6 },
      { header: 'Fecha', key: 'date', width: 16 },
      { header: 'Tipo', key: 'type', width: 12 },
      { header: 'Documento', key: 'document', width: 20 },
      { header: 'Proveedor/Centro', key: 'party', width: 30 },
      { header: 'Productos', key: 'products', width: 54 },
      { header: 'Total', key: 'total', width: 18 },
    ];
    details.getRow(1).font = { bold: true };

    (reportData.movements || []).forEach((m: any, idx: number) => {
      const party = m.type === 'ENTRADA' ? (m.client?.name || '') : (m.costCenter?.name || '');
      const movementTotal = m.reportTotal !== undefined
        ? Number(m.reportTotal)
        : (m.details || []).reduce((sum: number, d: any) => sum + Number(toNum(d.totalCost || 0)), 0);
      const productsText = (m.details || [])
        .map((d: any) => `${d.product?.name || ''} (${Number(toNum(d.quantity || 0)).toFixed(2)} ${d.product?.unit || ''})`)
        .join(', ');

      details.addRow({
        idx: idx + 1,
        date: this.formatDate(m.date),
        type: m.type === 'ENTRADA' ? 'Entrada' : 'Salida',
        document: m.documentNumber || '',
        party,
        products: productsText,
        total: movementTotal,
      });
    });

    const currencyColFormat = '#,##0.00';
    ws.getColumn(3).numFmt = currencyColFormat;
    ws.getColumn(4).numFmt = currencyColFormat;
    details.getColumn(7).numFmt = currencyColFormat;

    return workbook;
  }

  async exportMovementsReportExcel(params: MovementReportExportParams) {
    const reportData = await this.getMovementsReportData(params);
    const reportTemplate = await this.resolveExistingTemplatePath([
      process.env.MOVEMENTS_REPORT_TEMPLATE_PATH || '',
      'd:\\Compartido\\4 CASA OASIS\\1 FREDDY MASTER OASIS\\MODELOS Y REPORTES MASTER\\Reporte COMEDOR MENSUAl 100125.xlsx',
    ]);

    let workbook: ExcelJS.Workbook;
    if (reportTemplate) {
      workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.readFile(reportTemplate);
        const ws = workbook.worksheets[0] || workbook.addWorksheet('Sheet1');
        const summary: any = reportData.summary || {};
        const usdToCup = Number(summary.exchangeRateInfo?.usdToCup || 0);
        const cupToUsd = Number(summary.exchangeRateInfo?.cupToUsd || 0);
        const reportCurrency = String(summary.currency || params.currency || 'USD').toUpperCase();
        const entriesValue = Number(summary.totalEntriesValue || 0);
        const exitsValue = Number(summary.totalExitsValue || 0);

        let usdEntries = entriesValue;
        let usdExits = exitsValue;
        let cupEntries = entriesValue;
        let cupExits = exitsValue;

        if (reportCurrency === 'USD') {
          cupEntries = entriesValue * usdToCup;
          cupExits = exitsValue * usdToCup;
        } else if (reportCurrency === 'CUP') {
          usdEntries = entriesValue * cupToUsd;
          usdExits = exitsValue * cupToUsd;
        }

        ws.getCell('A1').value = 'REPORTE CASA OASIS - MOVIMIENTOS';
        ws.getCell('E3').value = `${this.formatDate(params.startDate)} - ${this.formatDate(params.endDate)}`;
        ws.getCell('B8').value = cupEntries;
        ws.getCell('C8').value = cupExits;
        ws.getCell('D8').value = cupEntries - cupExits;
        ws.getCell('B12').value = usdEntries;
        ws.getCell('C12').value = usdExits;
        ws.getCell('D12').value = usdEntries - usdExits;
        ws.getCell('G3').value = `Tipo: ${this.movementTypeLabel(params.type)}`;
        ws.getCell('G4').value = `Tasa: 1 USD=${usdToCup.toFixed(4)} CUP`;

        ws.getColumn('B').numFmt = '#,##0.00';
        ws.getColumn('C').numFmt = '#,##0.00';
        ws.getColumn('D').numFmt = '#,##0.00';

        const details = workbook.getWorksheet('Detalle') || workbook.addWorksheet('Detalle');
        details.columns = [
          { header: '#', key: 'idx', width: 6 },
          { header: 'Fecha', key: 'date', width: 16 },
          { header: 'Tipo', key: 'type', width: 12 },
          { header: 'Documento', key: 'document', width: 20 },
          { header: 'Proveedor/Centro', key: 'party', width: 30 },
          { header: 'Productos', key: 'products', width: 54 },
          { header: 'Total', key: 'total', width: 18 },
        ];
        details.getRow(1).font = { bold: true };
        (reportData.movements || []).forEach((m: any, idx: number) => {
          const party = m.type === 'ENTRADA' ? (m.client?.name || '') : (m.costCenter?.name || '');
          const movementTotal = m.reportTotal !== undefined
            ? Number(m.reportTotal)
            : (m.details || []).reduce((sum: number, d: any) => sum + Number(toNum(d.totalCost || 0)), 0);
          const productsText = (m.details || [])
            .map((d: any) => `${d.product?.name || ''} (${Number(toNum(d.quantity || 0)).toFixed(2)} ${d.product?.unit || ''})`)
            .join(', ');
          details.addRow({
            idx: idx + 1,
            date: this.formatDate(m.date),
            type: m.type === 'ENTRADA' ? 'Entrada' : 'Salida',
            document: m.documentNumber || '',
            party,
            products: productsText,
            total: movementTotal,
          });
        });
        details.getColumn(7).numFmt = '#,##0.00';
      } catch (e) {
        workbook = await this.buildMovementsWorkbook(reportData, params);
      }
    } else {
      workbook = await this.buildMovementsWorkbook(reportData, params);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer,
      filename: `reporte_movimientos_${this.formatFileDate(new Date())}.xlsx`,
    };
  }

  async exportMovementsInvoiceExcel(params: MovementReportExportParams) {
    const reportData = await this.getMovementsReportData(params);
    const summary: any = reportData.summary || {};
    const movements = reportData.movements || [];

    const invoiceNumber = (params.invoiceNumber || '').trim() || await this.nextInvoiceNumber(new Date());
    const workbook = new ExcelJS.Workbook();

    const invoiceTemplate = await this.resolveExistingTemplatePath([
      process.env.INVOICE_TEMPLATE_PATH || '',
      'd:\\Compartido\\Plantilla de factura de la casa\\Plantilla).xlsm',
    ]);

    if (invoiceTemplate) {
      try {
        await workbook.xlsx.readFile(invoiceTemplate);
      } catch (e) {
        // Si la plantilla no se puede abrir (por ejemplo, macro no compatible), se usa libro en blanco
      }
    }

    const ws = workbook.worksheets[0] || workbook.addWorksheet('Factura');
    const company = await this.prisma.company.findFirst();
    const currency = summary.currency || params.currency || 'USD';
    const totalEntriesValue = Number(summary.totalEntriesValue || 0);
    const totalExitsValue = Number(summary.totalExitsValue || 0);
    const totalFactura = totalEntriesValue + totalExitsValue;

    // Encabezado estilo plantilla (si no coincide exactamente, se mantienen celdas existentes)
    ws.getCell('A1').value = ws.getCell('A1').value || 'FACTURA';
    ws.getCell('I1').value = invoiceNumber;
    ws.getCell('D5').value = company?.address || ws.getCell('D5').value || '';
    ws.getCell('H5').value = this.formatDate(new Date());
    ws.getCell('H6').value = this.movementTypeLabel(params.type);
    ws.getCell('H7').value = `Reporte (${currency})`;
    ws.getCell('D10').value = `Factura generada desde reporte: ${this.formatDate(params.startDate)} - ${this.formatDate(params.endDate)}`;

    let row = 13;
    for (const movement of movements) {
      const total = movement.reportTotal !== undefined
        ? Number(movement.reportTotal)
        : (movement.details || []).reduce((sum: number, d: any) => sum + Number(toNum(d.totalCost || 0)), 0);
      const party = movement.type === 'ENTRADA'
        ? (movement.client?.name || 'N/A')
        : (movement.costCenter?.name || 'N/A');

      ws.getCell(`B${row}`).value = movement.documentNumber || '';
      ws.getCell(`C${row}`).value = `${movement.type === 'ENTRADA' ? 'Entrada' : 'Salida'} - ${party}`;
      ws.getCell(`E${row}`).value = 1;
      ws.getCell(`F${row}`).value = total;
      ws.getCell(`G${row}`).value = total;
      ws.getCell(`H${row}`).value = 0;
      ws.getCell(`I${row}`).value = total;
      row++;
    }

    ws.getCell(`G${row + 1}`).value = 'Total Factura';
    ws.getCell(`I${row + 1}`).value = totalFactura;

    ws.getColumn('F').numFmt = '#,##0.00';
    ws.getColumn('G').numFmt = '#,##0.00';
    ws.getColumn('I').numFmt = '#,##0.00';

    const summarySheet = workbook.getWorksheet('Resumen por Producto') || workbook.addWorksheet('Resumen por Producto');
    const currencyLabel = String(currency || 'USD').toUpperCase();
    const equivalentLabel = currencyLabel === 'USD' ? 'Equivalente CUP' : 'Equivalente USD';
    const rateInfo = summary.exchangeRateInfo || { usdToCup: 0, cupToUsd: 0 };
    const exchangeRate = currencyLabel === 'USD'
      ? Number(rateInfo.usdToCup || 0)
      : Number(rateInfo.cupToUsd || 0);

    summarySheet.columns = [
      { header: 'Producto', key: 'product', width: 36 },
      { header: 'Código', key: 'code', width: 18 },
      { header: 'Salidas (Cantidad)', key: 'quantity', width: 18 },
      { header: `Valor Salidas (${currencyLabel})`, key: 'value', width: 20 },
      { header: equivalentLabel, key: 'equivalent', width: 20 },
    ];
    summarySheet.getRow(1).font = { bold: true };

    let totalQuantity = 0;
    let totalValue = 0;
    let totalEquivalent = 0;

    for (const productId of Object.keys(summary.products || {})) {
      const entry = summary.products[Number(productId)];
      const quantity = Number(entry.exits || 0);
      const value = Number(entry.exitsValue || 0);
      const equivalent = exchangeRate && value ? value * exchangeRate : 0;

      totalQuantity += quantity;
      totalValue += value;
      totalEquivalent += equivalent;

      summarySheet.addRow({
        product: entry.product?.name || '',
        code: entry.product?.code || '',
        quantity,
        value,
        equivalent,
      });
    }

    summarySheet.addRow({});
    summarySheet.addRow({
      product: 'TOTAL',
      code: '',
      quantity: totalQuantity,
      value: totalValue,
      equivalent: totalEquivalent,
    });

    summarySheet.getColumn('D').numFmt = '#,##0.00';
    summarySheet.getColumn('E').numFmt = '#,##0.00';

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer,
      filename: `factura_${invoiceNumber}.xlsx`,
      invoiceNumber,
    };
  }

  private async buildUsdCupRateInfo(at: Date) {
    const cupUsd = await this.currenciesService.getRateAt('CUP', at); // USD por 1 CUP
    const usdCup = cupUsd > 0 ? (1 / cupUsd) : 0; // CUP por 1 USD
    return {
      at,
      usdToCup: usdCup,
      cupToUsd: cupUsd,
    };
  }

  private async convertUsdToTarget(amountUsd: number, targetCurrency: string, at: Date, cache: Map<string, number>) {
    if (targetCurrency === 'USD') return amountUsd;
    const key = `${targetCurrency}|${at.toISOString()}`;
    if (!cache.has(key)) {
      const rate = await this.currenciesService.getRateAt(targetCurrency, at);
      cache.set(key, rate);
    }
    const rate = cache.get(key)!;
    return rate ? amountUsd / rate : amountUsd;
  }

  private async movementAmountInTarget(detailTotal: number, movement: any, targetCurrency: string, cache: Map<string, number>) {
    const amount = toNum(detailTotal);
    if (targetCurrency === movement.currencyCode) return amount;

    const rateAtTransaction = movement.rateAtTransaction !== undefined
      ? toNum(movement.rateAtTransaction)
      : 1;

    const amountUsd = movement.currencyCode === 'USD' ? amount : amount * rateAtTransaction;
    return this.convertUsdToTarget(amountUsd, targetCurrency, movement.date, cache);
  }

  async getStockReport(targetCurrency: string = 'USD') {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { stock: 'asc' },
    });

    const lowStockCount = products.filter(
      p => toNum(p.stock) <= toNum(p.minStock)
    ).length;

    const totalValueUsd = products.reduce(
      (sum, product) => sum + toNum(product.stock) * toNum(product.unitCost),
      0
    );
    const rateCache = new Map<string, number>();
    const now = new Date();
    const totalValue = await this.convertUsdToTarget(totalValueUsd, targetCurrency, now, rateCache);
    const exchangeRateInfo = await this.buildUsdCupRateInfo(now);

    const convertedProducts = await Promise.all(products.map(async product => {
      const unitCostUsd = toNum(product.unitCost);
      const unitCostReport = await this.convertUsdToTarget(unitCostUsd, targetCurrency, now, rateCache);
      const totalValueReport = await this.convertUsdToTarget(toNum(product.stock) * unitCostUsd, targetCurrency, now, rateCache);
      return {
        ...product,
        unitCostReport,
        totalValueReport,
      };
    }));

    return {
      products: convertedProducts,
      summary: {
        totalProducts: products.length,
        lowStockCount,
        totalValue,
        currency: targetCurrency,
        exchangeRateInfo,
      },
    };
  }

  private async buildStockForecastReport(params: StockForecastParams = {}) {
    const period: StockForecastPeriod = params.period === 'weekly' ? 'weekly' : 'monthly';
    const historyMonths = params.historyMonths && Number(params.historyMonths) > 0
      ? Math.min(12, Math.max(1, Math.floor(params.historyMonths)))
      : 3;

    const now = new Date();
    const startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - historyMonths);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const historyDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
    const periodDays = period === 'weekly' ? 7 : 30;
    const periodCount = historyDays / periodDays;

    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const exitDetails = await this.prisma.movementDetail.findMany({
      where: {
        movement: {
          type: MovementType.SALIDA,
          status: MovementStatus.POSTED,
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      include: {
        product: true,
        movement: {
          select: { date: true },
        },
      },
    });

    const exitsByProduct = new Map<number, {
      product: any;
      totalExitQuantity: number;
      dailyQuantities: Map<string, number>;
    }>();

    for (const detail of exitDetails) {
      const current = exitsByProduct.get(detail.productId) || {
        product: detail.product,
        totalExitQuantity: 0,
        dailyQuantities: new Map<string, number>(),
      };

      const quantity = toNum(detail.quantity);
      current.totalExitQuantity += quantity;

      const movementDate = detail.movement?.date ? new Date(detail.movement.date) : null;
      const dayKey = movementDate ? movementDate.toISOString().slice(0, 10) : '';
      if (dayKey) {
        current.dailyQuantities.set(dayKey, (current.dailyQuantities.get(dayKey) || 0) + quantity);
      }

      exitsByProduct.set(detail.productId, current);
    }

    const normalizeStatusFilter = (value: string | null | undefined): StockForecastStatusFilter => {
      if (!value) return 'all';
      const normalized = String(value).trim().toUpperCase();
      if (normalized === 'ALL') return 'all';
      if (['AGOTADO', 'ATENCION', 'CRITICO', 'SIN_CONSUMO', 'OK', 'PRONTO'].includes(normalized)) {
        return normalized as StockForecastStatusFilter;
      }
      return 'all';
    };

    const selectedStatusFilters = Array.isArray(params.status)
      ? params.status.map(status => normalizeStatusFilter(String(status)))
      : String(params.status || 'all')
          .split(',')
          .map(status => normalizeStatusFilter(status));

    const normalizedStatusFilters = selectedStatusFilters.includes('all')
      ? ['all']
      : Array.from(new Set(selectedStatusFilters));

    const productForecasts = products.map(product => {
      const currentStock = toNum(product.stock);
      const minStock = toNum(product.minStock);
      const exitInfo = exitsByProduct.get(product.id);
      const totalExitQuantity = exitInfo?.totalExitQuantity || 0;
      const avgAllDays = historyDays > 0 ? totalExitQuantity / historyDays : 0;

      const dailyTotals: number[] = [];
      const dailyMap = new Map<string, number>(exitInfo?.dailyQuantities || []);
      for (let i = 0; i < historyDays; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const key = date.toISOString().slice(0, 10);
        dailyTotals.push(dailyMap.get(key) || 0);
      }

      const percentile75Daily = this.percentile(dailyTotals, 0.75);
      const medianDaily = this.median(dailyTotals);

      const sumLast = (days: number) => {
        if (dailyTotals.length === 0) return 0;
        const windowDays = Math.min(days, dailyTotals.length);
        const slice = dailyTotals.slice(-windowDays);
        return slice.reduce((sum, value) => sum + value, 0) / days;
      };

      const last7DaysAverage = sumLast(7);
      const last14DaysAverage = sumLast(14);
      const last30DaysAverage = sumLast(30);
      const recentAverage = last30DaysAverage;

      const estimatedDailyUsage = Math.max(
        avgAllDays,
        recentAverage,
        percentile75Daily,
        medianDaily,
      );

      const averagePerDay = estimatedDailyUsage;
      const averagePerPeriod = periodCount > 0 ? averagePerDay * periodDays : 0;
      const forecastDaysLeft = averagePerDay > 0 ? currentStock / averagePerDay : null;
      const forecastPeriodsLeft = averagePerPeriod > 0 ? currentStock / averagePerPeriod : null;
      const daysUntilMinStock = averagePerDay > 0
        ? Math.max(0, (currentStock - minStock) / averagePerDay)
        : null;
      const originInfo = this.detectProductOrigin(product);

      const formatRemaining = (value: number | null) => {
        if (value === null) return null;
        if (value <= 0) return '0';
        if (value < 1) return '<1';
        return String(Math.round(value));
      };

      let status: StockForecastStatusFilter = 'OK';
      if (currentStock <= 0) {
        status = 'AGOTADO';
      } else if (!averagePerDay || averagePerDay <= 0) {
        status = 'SIN_CONSUMO';
      } else if (daysUntilMinStock !== null && daysUntilMinStock <= 7) {
        status = 'CRITICO';
      } else if (daysUntilMinStock !== null && daysUntilMinStock <= 30) {
        status = 'ATENCION';
      } else if (currentStock <= minStock) {
        status = 'ATENCION';
      }

      return {
        ...product,
        currentStock,
        totalExitQuantity,
        averagePerDay: Number(averagePerDay.toFixed(4)),
        averagePerPeriod: Number(averagePerPeriod.toFixed(4)),
        forecastDaysLeft: forecastDaysLeft !== null ? Number(forecastDaysLeft.toFixed(2)) : null,
        forecastPeriodsLeft: forecastPeriodsLeft !== null ? Number(forecastPeriodsLeft.toFixed(2)) : null,
        daysUntilMinStock: daysUntilMinStock !== null ? Number(daysUntilMinStock.toFixed(2)) : null,
        forecastDaysLeftLabel: formatRemaining(forecastDaysLeft),
        forecastPeriodsLeftLabel: formatRemaining(forecastPeriodsLeft),
        daysUntilMinStockLabel: formatRemaining(daysUntilMinStock),
        status,
        forecastPeriod: period,
        historyMonths,
        origin: originInfo.origin,
        originLabel: originInfo.originLabel,
        canDonate: originInfo.canDonate,
      };
    });

    const filteredProducts = normalizedStatusFilters.includes('all')
      ? productForecasts
      : productForecasts.filter(item => {
          return normalizedStatusFilters.some(filter => {
            if (filter === 'PRONTO') {
              return item.status === 'ATENCION' || item.status === 'CRITICO';
            }
            return item.status === filter;
          });
        });

    return {
      period,
      historyMonths,
      status: normalizedStatusFilters,
      startDate,
      endDate,
      summary: {
        totalProducts: filteredProducts.length,
        productsWithConsumption: filteredProducts.filter(item => item.totalExitQuantity > 0).length,
        productsWithoutConsumption: filteredProducts.filter(item => item.totalExitQuantity <= 0).length,
        criticalProducts: filteredProducts.filter(item => item.status === 'CRITICO' || item.status === 'AGOTADO').length,
      },
      products: filteredProducts,
    };
  }

  async getStockForecast(params: StockForecastParams = {}) {
    return this.buildStockForecastReport(params);
  }

  async exportStockForecastExcel(params: StockForecastParams = {}) {
    const reportData = await this.buildStockForecastReport(params);
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Stock Forecast');

    ws.columns = [
      { header: 'Código', key: 'code', width: 18 },
      { header: 'Producto', key: 'name', width: 32 },
      { header: 'Origen', key: 'originLabel', width: 18 },
      { header: 'Unidad', key: 'unit', width: 12 },
      { header: 'Stock', key: 'currentStock', width: 12 },
      { header: 'Mínimo', key: 'minStock', width: 12 },
      { header: 'Total Salidas', key: 'totalExitQuantity', width: 16 },
      { header: `Promedio por ${reportData.period}`, key: 'averagePerPeriod', width: 18 },
      { header: `Períodos restantes (${reportData.period})`, key: 'forecastPeriodsLeftLabel', width: 20 },
      { header: 'Días restantes', key: 'forecastDaysLeftLabel', width: 16 },
      { header: 'Días hasta mínimo', key: 'daysUntilMinStockLabel', width: 18 },
      { header: 'Estado', key: 'status', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };

    for (const item of reportData.products) {
      ws.addRow({
        code: item.code,
        name: item.name,
        unit: item.unit,
        currentStock: item.currentStock,
        minStock: toNum(item.minStock),
        totalExitQuantity: item.totalExitQuantity,
        averagePerPeriod: item.averagePerPeriod,
        forecastPeriodsLeftLabel: item.forecastPeriodsLeftLabel || '',
        forecastDaysLeftLabel: item.forecastDaysLeftLabel || '',
        daysUntilMinStockLabel: item.daysUntilMinStockLabel || '',
        status: item.status,
      });
    }

    ws.getColumn('D').numFmt = '#,##0.00';
    ws.getColumn('E').numFmt = '#,##0.00';
    ws.getColumn('F').numFmt = '#,##0.00';
    ws.getColumn('G').numFmt = '#,##0.00';
    ws.getColumn('H').numFmt = '@';
    ws.getColumn('I').numFmt = '@';
    ws.getColumn('J').numFmt = '@';

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer,
      filename: `stock_forecast_${reportData.period}_${this.formatFileDate(new Date())}.xlsx`,
    };
  }

  async getClientReport(clientId: number, startDate?: Date, endDate?: Date, targetCurrency: string = 'USD') {
    const movements = await this.prisma.movement.findMany({
      where: {
        clientId,
        status: MovementStatus.POSTED,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        details: {
          include: { product: true },
        },
      },
      orderBy: { date: 'asc' },
    });

    const summary = {
      totalMovements: movements.length,
      totalEntries: 0,
      totalExits: 0,
      totalValue: 0,
      products: {},
      currency: targetCurrency,
      exchangeRateInfo: await this.buildUsdCupRateInfo(endDate || new Date()),
    };

    const rateCache = new Map<string, number>();
    const movementTotals = new Map<number, number>();
    for (const movement of movements) {
      for (const detail of movement.details) {
        const productId = detail.productId;
        const value = await this.movementAmountInTarget(
          toNum(detail.totalCost),
          movement,
          targetCurrency,
          rateCache
        );

        if (movement.type === 'ENTRADA') {
          summary.totalEntries++;
        } else {
          summary.totalExits++;
        }

        summary.totalValue += value;

        if (!summary.products[productId]) {
          summary.products[productId] = {
            product: detail.product,
            totalQuantity: 0,
            totalValue: 0,
          };
        }

        summary.products[productId].totalQuantity += toNum(detail.quantity);
        summary.products[productId].totalValue += value;
        movementTotals.set(movement.id, (movementTotals.get(movement.id) || 0) + value);
      }
    }

    const movementsWithTotals = movements.map(m => ({
      ...m,
      reportTotal: movementTotals.get(m.id) || 0,
      reportCurrency: targetCurrency,
    }));

    return { movements: movementsWithTotals, summary };
  }

  async getCostCenterReport(costCenterId: number, startDate?: Date, endDate?: Date, targetCurrency: string = 'USD') {
    const movements = await this.prisma.movement.findMany({
      where: {
        costCenterId,
        status: MovementStatus.POSTED,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        details: {
          include: { product: true },
        },
      },
      orderBy: { date: 'asc' },
    });

    const summary = {
      totalMovements: movements.length,
      totalEntries: 0,
      totalExits: 0,
      totalValue: 0,
      products: {},
      currency: targetCurrency,
      exchangeRateInfo: await this.buildUsdCupRateInfo(endDate || new Date()),
    };

    const rateCache = new Map<string, number>();
    const movementTotals = new Map<number, number>();
    for (const movement of movements) {
      for (const detail of movement.details) {
        const productId = detail.productId;
        const value = await this.movementAmountInTarget(
          toNum(detail.totalCost),
          movement,
          targetCurrency,
          rateCache
        );

        if (movement.type === 'ENTRADA') {
          summary.totalEntries++;
        } else {
          summary.totalExits++;
        }

        summary.totalValue += value;

        if (!summary.products[productId]) {
          summary.products[productId] = {
            product: detail.product,
            totalQuantity: 0,
            totalValue: 0,
          };
        }

        summary.products[productId].totalQuantity += toNum(detail.quantity);
        summary.products[productId].totalValue += value;
        movementTotals.set(movement.id, (movementTotals.get(movement.id) || 0) + value);
      }
    }

    const movementsWithTotals = movements.map(m => ({
      ...m,
      reportTotal: movementTotals.get(m.id) || 0,
      reportCurrency: targetCurrency,
    }));

    return { movements: movementsWithTotals, summary };
  }

  async getProductMovementHistory(productId: number, startDate?: Date, endDate?: Date) {
    const details = await this.prisma.movementDetail.findMany({
      where: {
        productId,
        movement: {
          status: MovementStatus.POSTED,
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      include: {
        movement: {
          include: {
            client: true,
            costCenter: true,
            user: { select: { name: true } },
          },
        },
      },
      orderBy: { movement: { date: 'desc' } },
    });

    const product = await this.prisma.product.findUnique({ where: { id: productId } });

    return { product, movements: details };
  }
}
