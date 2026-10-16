import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../shared/prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementDetailDto } from './dto/movement-detail.dto';
import { MovementStatus, MovementType, Prisma } from '@prisma/client';
import { AccountingService } from '../accounting/accounting.service';

// Helper para convertir Decimal a number
function toNum(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null || value === '') return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class MovementsService {
  constructor(
    private prisma: PrismaService,
    private productsService: ProductsService,
    private currenciesService: CurrenciesService,
    private accountingService: AccountingService,
  ) {}

  private formatYmd(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  // ---------------------------
  // Métodos requeridos por el controller
  // ---------------------------

  // Normaliza tipos numéricos de detalles y productos para que el frontend reciba numbers
  private normalizeMovement(movement: any) {
    if (!movement) return movement;
    const m: any = { ...movement };

    if (m.details && Array.isArray(m.details)) {
      m.details = m.details.map((d: any) => ({
        ...d,
        quantity: toNum(d.quantity),
        unitCost: toNum(d.unitCost),
        totalCost: toNum(d.totalCost),
        product: d.product ? {
          ...d.product,
          stock: toNum(d.product.stock),
          unitCost: toNum(d.product.unitCost),
        } : d.product,
      }));
    }

    // Normalizar producto en caso de que exista en la raíz (compatibilidad)
    if (m.product) {
      m.product = {
        ...m.product,
        stock: toNum(m.product.stock),
        unitCost: toNum(m.product.unitCost),
      };
    }

    // Normalizar tasa almacenada
    if (m.rateAtTransaction !== undefined) {
      m.rateAtTransaction = toNum(m.rateAtTransaction);
    }

    return m;
  }

  private isProductFromLogosMission(product: { name?: string | null; description?: string | null }): boolean {
    const text = `${product.name || ''} ${product.description || ''}`.toLowerCase();
    return /\b(logos?|logotipo|misi[oó]n|donaci[oó]n|donativo|ayuda)\b/.test(text);
  }

  private isHelpCostCenter(costCenter: { name?: string | null; description?: string | null }): boolean {
    const text = `${costCenter.name || ''} ${costCenter.description || ''}`.toLowerCase();
    return /\bayuda\b/.test(text);
  }

  private async validateAdminPassword(password: string) {
    if (!password || !password.trim()) {
      throw new BadRequestException('Se requiere contraseña de administrador para forzar esta salida');
    }

    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { password: true },
    });

    if (!admins || admins.length === 0) {
      throw new BadRequestException('No hay un administrador configurado para validar la contraseña');
    }

    const validResults = await Promise.all(
      admins.map(admin => bcrypt.compare(password, admin.password)),
    );

    if (!validResults.some(Boolean)) {
      throw new BadRequestException('Contraseña de administrador incorrecta');
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    search?: string,
    startDate?: Date,
    endDate?: Date,
    clientId?: number,
    costCenterId?: number
  ) {
    const skip = (page - 1) * limit;

    const where: any = {
      AND: [
        search ? {
          OR: [
            { documentNumber: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ]
        } : undefined,
        startDate || endDate ? {
          date: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {}),
          }
        } : undefined,
        clientId ? { clientId } : undefined,
        costCenterId ? { costCenterId } : undefined,
      ].filter(Boolean),
    };

    const [movements, total] = await Promise.all([
      this.prisma.movement.findMany({
        where,
        skip,
        take: limit,
        include: { client: true, costCenter: true, details: { include: { product: true } } },
        orderBy: { date: 'desc' },
      }),
      this.prisma.movement.count({ where }),
    ]);

    const normalized = movements.map(m => this.normalizeMovement(m));

    return {
      data: normalized,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const movement = await this.prisma.movement.findUnique({
      where: { id },
      include: {
        client: true,
        costCenter: true,
        user: { select: { id: true, name: true, email: true } },
        details: { include: { product: true } },
      },
    });

    if (!movement) {
      throw new NotFoundException('Movimiento no encontrado');
    }

    return this.normalizeMovement(movement);
  }

  // ---------------------------
  // Crear un movimiento
  // ---------------------------
  async create(userId: number, createMovementDto: CreateMovementDto) {
    if (!createMovementDto.clientId && !createMovementDto.costCenterId) {
      throw new BadRequestException('Debe especificar un cliente o un centro de costo');
    }

    if (!createMovementDto.details || createMovementDto.details.length === 0) {
      throw new BadRequestException('Debe agregar al menos un producto');
    }

    return await this.prisma.$transaction(async (tx) => {
      const movementDate = createMovementDto.date || new Date();
      const company = await tx.company.findFirst({
        orderBy: { id: 'asc' },
        select: { accountingCutoverAt: true },
      });
      if (company?.accountingCutoverAt && !createMovementDto.counterpartAccountId) {
        throw new BadRequestException('Seleccione la cuenta contable de contrapartida para este movimiento');
      }
      // Determinar moneda y tasa al momento de la transacción
      let currencyCode = createMovementDto.currencyCode
        || (await this.currenciesService.getAll()).find(c => c.isDefault)?.code
        || 'USD';
      currencyCode = String(currencyCode).toUpperCase();

      if (createMovementDto.type === MovementType.SALIDA) {
        currencyCode = 'USD';
      }

      if (currencyCode === 'EUR') {
        throw new BadRequestException('EUR está deshabilitada temporalmente');
      }
      const currencyEntry = await this.currenciesService.get(currencyCode);
      if (!currencyEntry) {
        throw new BadRequestException(`La moneda ${currencyCode} no está configurada`);
      }
      const rateAtTransaction = await this.currenciesService.getRateAt(currencyCode, movementDate);
      if (!Number.isFinite(rateAtTransaction) || rateAtTransaction <= 0) {
        throw new BadRequestException(`No existe una tasa válida para ${currencyCode} en la fecha del movimiento`);
      }
      const providedRate = Number(createMovementDto.rateAtTransaction);
      if (
        createMovementDto.rateAtTransaction !== undefined &&
        Number.isFinite(providedRate) &&
        Math.abs(providedRate - rateAtTransaction) > Math.max(1e-10, rateAtTransaction * 1e-8)
      ) {
        throw new BadRequestException('La tasa de cambio la determina la tasa archivada del sistema y no puede alterarse al crear el movimiento');
      }
      const requestedDocumentNumber = (createMovementDto.documentNumber || '').trim();

      const costCenter = createMovementDto.costCenterId
        ? await tx.costCenter.findUnique({ where: { id: createMovementDto.costCenterId } })
        : null;
      if (createMovementDto.costCenterId && !costCenter) {
        throw new NotFoundException('Centro de costo no encontrado');
      }
      const isHelpCenter = createMovementDto.type === MovementType.SALIDA && costCenter
        ? this.isHelpCostCenter(costCenter)
        : false;

      const movement = await tx.movement.create({
        data: {
          type: createMovementDto.type,
          date: movementDate,
          documentNumber: requestedDocumentNumber || null,
          description: createMovementDto.description,
          clientId: createMovementDto.clientId,
          costCenterId: createMovementDto.costCenterId,
          counterpartAccountId: createMovementDto.counterpartAccountId,
          userId: userId,
          currencyCode,
          rateAtTransaction,
        },
      });
      const documentNumber = requestedDocumentNumber || `${
        createMovementDto.type === MovementType.ENTRADA ? 'ENT' : 'SAL'
      }-${this.formatYmd(movementDate)}-${String(movement.id).padStart(8, '0')}`;
      const numberedMovement = requestedDocumentNumber
        ? movement
        : await tx.movement.update({
            where: { id: movement.id },
            data: { documentNumber },
          });

      const details = [];
      let totalMovement = 0;

      for (const detailDto of createMovementDto.details) {
        const product = await tx.product.findUnique({
          where: { id: detailDto.productId },
        });

        if (!product) {
          throw new NotFoundException(`Producto con ID ${detailDto.productId} no encontrado`);
        }
        if (!product.isActive) {
          throw new BadRequestException(`El producto ${product.name} está inactivo`);
        }

        if (isHelpCenter && !this.isProductFromLogosMission(product)) {
          if (!createMovementDto.adminPassword) {
            throw new BadRequestException(
              `El producto ${product.name} no proviene de Logos Misión y requiere contraseña de administrador para forzar la salida.`
            );
          }
          await this.validateAdminPassword(createMovementDto.adminPassword);
        }

        // Validar stock para salidas
        const unitCostInput = toNum(detailDto.unitCost);
        const unitCostToUse = createMovementDto.type === MovementType.SALIDA
          ? toNum(product.unitCost)
          : unitCostInput;

        const totalCost = detailDto.quantity * unitCostToUse;
        totalMovement += totalCost;

        const detail = await tx.movementDetail.create({
          data: {
            movementId: movement.id,
            productId: detailDto.productId,
            quantity: detailDto.quantity,
            unitCost: unitCostToUse,
            totalCost: totalCost,
          },
        });

        // Actualizar stock del producto
        if (createMovementDto.type === MovementType.ENTRADA) {
          const currentStock = toNum(product.stock);
          const currentCost = toNum(product.unitCost);
          const qty = detailDto.quantity;
          const unitCost = toNum(detailDto.unitCost);
          const unitCostUsd = currencyCode === 'USD' ? unitCost : unitCost * rateAtTransaction;
          const newStock = currentStock + qty;
          const newCost =
            newStock > 0 ? ((currentStock * currentCost) + (qty * unitCostUsd)) / newStock : unitCostUsd;

          await tx.product.update({
            where: { id: detailDto.productId },
            data: {
              stock: { increment: qty },
              unitCost: newCost,
            },
          });
        } else {
          const stockUpdate = await tx.product.updateMany({
            where: { id: detailDto.productId, isActive: true, stock: { gte: detailDto.quantity } },
            data: {
              stock: { decrement: detailDto.quantity },
            },
          });
          if (stockUpdate.count !== 1) {
            throw new BadRequestException(
              `Stock insuficiente para ${product.name}. Stock actual: ${toNum(product.stock)}, requerido: ${detailDto.quantity}`
            );
          }
        }

        details.push(detail);
      }

      if (company?.accountingCutoverAt) {
        await this.accountingService.postInventoryMovement(tx, {
          movementId: movement.id,
          actorId: userId,
          date: movementDate,
          description: createMovementDto.description,
          documentNumber,
          type: createMovementDto.type,
          currencyCode,
          rateAtTransaction: new Prisma.Decimal(rateAtTransaction),
          counterpartAccountId: createMovementDto.counterpartAccountId,
          costCenterId: createMovementDto.costCenterId,
          details,
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'CREATE',
          table: 'Movement',
          recordId: movement.id,
          newData: {
            type: movement.type,
            date: movement.date.toISOString(),
            documentNumber,
            currencyCode,
            rateAtTransaction,
            details: details.map(detail => ({
              productId: detail.productId,
              quantity: toNum(detail.quantity),
              unitCost: toNum(detail.unitCost),
              totalCost: toNum(detail.totalCost),
            })),
          },
        },
      });

      return {
        ...numberedMovement,
        details,
        total: totalMovement,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ---------------------------
  // Reportes
  // ---------------------------
  async getInventoryReport() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const totalValue = products.reduce((sum, product) => {
      return sum + toNum(product.stock) * toNum(product.unitCost);
    }, 0);

    const lowStockProducts = products.filter(
      product => toNum(product.stock) <= toNum(product.minStock)
    );

    return {
      products,
      summary: {
        totalProducts: products.length,
        totalValue,
        lowStockCount: lowStockProducts.length,
      },
      lowStockProducts,
    };
  }

  async getMovementsReport(
    startDate: Date,
    endDate: Date,
    targetCurrency: string = 'USD',
    type?: MovementType,
    clientId?: number,
    costCenterId?: number,
  ) {
    const where: any = {
      date: {
        gte: startDate,
        lte: endDate,
      },
    };
    if (type === MovementType.ENTRADA || type === MovementType.SALIDA) {
      where.type = type;
    }
    if (clientId) where.clientId = clientId;
    if (costCenterId) where.costCenterId = costCenterId;

    const movements = await this.prisma.movement.findMany({
      where: { ...where, status: MovementStatus.POSTED },
      include: {
        client: true,
        costCenter: true,
        details: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    const summary = {
      totalEntries: 0,
      totalExits: 0,
      totalEntriesValue: 0,
      totalExitsValue: 0,
      products: {} as Record<number, any>,
      currency: targetCurrency,
      exchangeRateInfo: null as any,
      filters: {
        type: type || null,
        clientId: clientId || null,
        costCenterId: costCenterId || null,
      },
    };

    const cupUsd = await this.currenciesService.getRateAt('CUP', endDate || new Date());
    summary.exchangeRateInfo = {
      at: endDate || new Date(),
      usdToCup: cupUsd > 0 ? (1 / cupUsd) : 0,
      cupToUsd: cupUsd,
    };

    const rateCache = new Map<string, number>();
    const movementTotals = new Map<number, number>();
    const getRateAt = async (code: string, at: Date) => {
      if (code === 'USD') return 1;
      const key = `${code}|${at.toISOString()}`;
      if (!rateCache.has(key)) {
        const rate = await this.currenciesService.getRateAt(code, at);
        rateCache.set(key, rate);
      }
      return rateCache.get(key)!;
    };

    const convertToTarget = async (movement: any, amount: number) => {
      if (targetCurrency === movement.currencyCode) return amount;
      const rateAtTransaction = toNum(movement.rateAtTransaction || 1);
      const amountUsd = movement.currencyCode === 'USD' ? amount : amount * rateAtTransaction;
      if (targetCurrency === 'USD') return amountUsd;
      const targetRate = await getRateAt(targetCurrency, movement.date);
      return targetRate ? amountUsd / targetRate : amountUsd;
    };

    for (const movement of movements) {
      const isEntry = movement.type === MovementType.ENTRADA;
      
      if (isEntry) summary.totalEntries++;
      else summary.totalExits++;

      for (const detail of movement.details) {
        const productId = detail.productId;
        const value = toNum(detail.totalCost);
        const valueBase = await convertToTarget(movement, value);
        movementTotals.set(movement.id, (movementTotals.get(movement.id) || 0) + valueBase);

        if (isEntry) summary.totalEntriesValue += valueBase;
        else summary.totalExitsValue += valueBase;

        if (!summary.products[productId]) {
          summary.products[productId] = {
            product: detail.product,
            entries: 0,
            exits: 0,
            entriesValue: 0,
            exitsValue: 0,
          };
        }

        if (isEntry) {
          summary.products[productId].entries += toNum(detail.quantity);
          summary.products[productId].entriesValue += valueBase;
        } else {
          summary.products[productId].exits += toNum(detail.quantity);
          summary.products[productId].exitsValue += valueBase;
        }
      }
    }

    const normalizedMovements = movements.map(m => ({
      ...this.normalizeMovement(m),
      reportTotal: movementTotals.get(m.id) || 0,
      reportCurrency: targetCurrency,
    }));

    return { movements: normalizedMovements, summary };
  }

  async generateVoucher(movementId: number) {
    const movement = await this.prisma.movement.findUnique({
      where: { id: movementId },
      include: {
        client: true,
        costCenter: true,
        user: { select: { name: true, email: true } },
        details: { include: { product: true } },
      },
    });

    if (!movement) {
      throw new NotFoundException('Movimiento no encontrado');
    }

    const voucher = {
      id: movement.id,
      type: movement.type,
      date: movement.date,
      documentNumber: movement.documentNumber,
      description: movement.description,
      client: movement.client,
      costCenter: movement.costCenter,
      user: movement.user,
      currencyCode: movement.currencyCode,
      rateAtTransaction: toNum(movement.rateAtTransaction || 1),
      details: movement.details.map(detail => ({
        code: detail.product.code,
        product: detail.product.name,
        unit: detail.product.unit,
        quantity: detail.quantity,
        unitCost: toNum(detail.unitCost),
        totalCost: toNum(detail.totalCost),
      })),
      total: movement.details.reduce((sum, detail) => sum + toNum(detail.totalCost), 0),
      totalBase: movement.details.reduce((sum, detail) => sum + toNum(detail.totalCost) * toNum(movement.rateAtTransaction || 1), 0),
    };

    return voucher;
  }

  async reverse(id: number, actorId: number) {
    return this.prisma.$transaction(async (tx) => {
      const movement = await tx.movement.findUnique({
        where: { id },
        include: { details: true },
      });

      if (!movement) {
        throw new NotFoundException('Movimiento no encontrado');
      }
      if (movement.status !== MovementStatus.POSTED) {
        throw new BadRequestException('El movimiento ya fue revertido');
      }
      const company = await tx.company.findFirst({
        orderBy: { id: 'asc' },
        select: { accountingCutoverAt: true },
      });
      if (
        company?.accountingCutoverAt &&
        !await tx.journalEntry.findUnique({ where: { sourceMovementId: id }, select: { id: true } })
      ) {
        throw new BadRequestException('El movimiento es anterior a la apertura contable; no se puede revertir desde el libro mayor');
      }

      const affectedProductIds = new Set<number>();

      for (const detail of movement.details) {
        affectedProductIds.add(detail.productId);
        const qty = detail.quantity;
        if (movement.type === MovementType.ENTRADA) {
          const updated = await tx.product.updateMany({
            where: { id: detail.productId, stock: { gte: qty } },
            data: { stock: { decrement: qty } },
          });
          if (updated.count !== 1) {
            throw new BadRequestException('No se puede revertir la entrada: el stock disponible sería negativo');
          }
        } else {
          await tx.product.update({
            where: { id: detail.productId },
            data: { stock: { increment: qty } },
          });
        }
      }

      const reversal = await tx.movement.create({
        data: {
          type: movement.type === MovementType.ENTRADA ? MovementType.SALIDA : MovementType.ENTRADA,
          date: new Date(),
          description: `Reverso de ${movement.documentNumber || `movimiento ${movement.id}`}`,
          currencyCode: movement.currencyCode,
          rateAtTransaction: movement.rateAtTransaction,
          clientId: movement.clientId,
          costCenterId: movement.costCenterId,
          counterpartAccountId: movement.counterpartAccountId,
          userId: actorId,
          reversalOfId: movement.id,
          details: {
            create: movement.details.map(detail => ({
              productId: detail.productId,
              quantity: detail.quantity,
              unitCost: detail.unitCost,
              totalCost: detail.totalCost,
            })),
          },
        },
      });
      const reversalDocumentNumber = `REV-${movement.id}-${reversal.id}`;
      if (company?.accountingCutoverAt) {
        await this.accountingService.reverseInventoryMovement(
          tx,
          movement.id,
          reversal.id,
          actorId,
          reversal.date,
        );
      }
      await tx.movement.update({
        where: { id: reversal.id },
        data: { documentNumber: reversalDocumentNumber },
      });
      const originalUpdated = await tx.movement.updateMany({
        where: { id, status: MovementStatus.POSTED },
        data: { status: MovementStatus.REVERSED, reversedAt: new Date() },
      });
      if (originalUpdated.count !== 1) {
        throw new BadRequestException('El movimiento fue revertido por otra operación; actualiza la lista');
      }

      if (movement.type === MovementType.ENTRADA && affectedProductIds.size > 0) {
        for (const productId of affectedProductIds) {
          const entries = await tx.movementDetail.findMany({
            where: {
              productId,
              movement: { type: MovementType.ENTRADA, status: MovementStatus.POSTED },
            },
            include: {
              movement: { select: { currencyCode: true, rateAtTransaction: true } },
            },
            orderBy: { movement: { date: 'asc' } },
          });

          let totalQty = 0;
          let totalCostUsd = 0;
          for (const entry of entries) {
            const qty = toNum(entry.quantity);
            const unitCost = toNum(entry.unitCost);
            const rate = toNum(entry.movement?.rateAtTransaction || 1);
            const unitCostUsd = entry.movement?.currencyCode === 'USD' ? unitCost : unitCost * rate;
            totalQty += qty;
            totalCostUsd += qty * unitCostUsd;
          }

          const newCost = totalQty > 0 ? totalCostUsd / totalQty : 0;
          await tx.product.update({
            where: { id: productId },
            data: { unitCost: newCost },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'REVERSE',
          table: 'Movement',
          recordId: id,
          oldData: { status: MovementStatus.POSTED },
          newData: {
            status: MovementStatus.REVERSED,
            reversalId: reversal.id,
            reversalDocumentNumber,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'CREATE_REVERSAL',
          table: 'Movement',
          recordId: reversal.id,
          newData: {
            reversalOfId: id,
            documentNumber: reversalDocumentNumber,
            type: reversal.type,
          },
        },
      });

      return { ok: true, reversalId: reversal.id, reversalDocumentNumber };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
