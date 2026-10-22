import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingPeriodStatus,
  AccountType,
  JournalEntryKind,
  JournalEntryStatus,
  MovementStatus,
  MovementType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { InventoryOpeningDto } from './dto/inventory-opening.dto';

const journalEntryInclude = {
  lines: {
    include: {
      account: true,
      costCenter: true,
    },
    orderBy: { id: 'asc' as const },
  },
  period: true,
  createdBy: { select: { id: true, name: true, email: true } },
  postedBy: { select: { id: true, name: true, email: true } },
  reversal: { select: { id: true, entryNumber: true, date: true } },
  reversalOf: { select: { id: true, entryNumber: true, date: true } },
};

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeDate(date: Date): Date {
    const normalized = new Date(date);
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }

  private currentAccountingDate(): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Havana',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => parts.find(value => value.type === type)?.value || '';
    return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
  }

  private formatEntryNumber(entryNumber: number): string {
    return `JE-${String(entryNumber).padStart(8, '0')}`;
  }

  private async getFunctionalCurrency(tx: Prisma.TransactionClient): Promise<string> {
    const company = await tx.company.findFirst({
      orderBy: { id: 'asc' },
      select: { functionalCurrencyCode: true },
    });
    return (company?.functionalCurrencyCode || 'USD').trim().toUpperCase();
  }

  async getAccounts(includeInactive = false) {
    const accounts = await this.prisma.account.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: { parent: { select: { id: true, code: true, name: true } } },
      orderBy: { code: 'asc' },
    });
    return { data: accounts };
  }

  async createAccount(actorId: number, dto: CreateAccountDto) {
    const code = dto.code.trim();
    const name = dto.name.trim();
    if (!code || !name) {
      throw new BadRequestException('El código y el nombre de la cuenta son obligatorios');
    }

    if (dto.parentId) {
      const parent = await this.prisma.account.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('La cuenta padre no existe');
      if (parent.type !== dto.type) {
        throw new BadRequestException('La cuenta y su cuenta padre deben tener el mismo tipo');
      }
    }

    try {
      return await this.prisma.$transaction(async tx => {
        const account = await tx.account.create({
          data: { code, name, type: dto.type, description: dto.description?.trim(), parentId: dto.parentId },
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: 'CREATE',
            table: 'Account',
            recordId: account.id,
            newData: { code: account.code, name: account.name, type: account.type },
          },
        });
        return account;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe una cuenta con ese código');
      }
      throw error;
    }
  }

  async updateAccount(id: number, actorId: number, dto: UpdateAccountDto) {
    return this.prisma.$transaction(async tx => {
      const account = await tx.account.findUnique({ where: { id } });
      if (!account) throw new NotFoundException('Cuenta contable no encontrada');
      if (dto.name !== undefined && !dto.name.trim()) {
        throw new BadRequestException('El nombre de la cuenta no puede estar vacío');
      }

      const updated = await tx.account.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'UPDATE',
          table: 'Account',
          recordId: id,
          oldData: { name: account.name, description: account.description, isActive: account.isActive },
          newData: { name: updated.name, description: updated.description, isActive: updated.isActive },
        },
      });
      return updated;
    });
  }

  async getPeriods() {
    return {
      data: await this.prisma.accountingPeriod.findMany({
        include: { closedBy: { select: { id: true, name: true } } },
        orderBy: { startsAt: 'desc' },
      }),
    };
  }

  async createPeriod(actorId: number, dto: CreateAccountingPeriodDto) {
    const startsAt = this.normalizeDate(dto.startsAt);
    const endsAt = this.normalizeDate(dto.endsAt);
    if (startsAt > endsAt) {
      throw new BadRequestException('La fecha inicial debe ser anterior o igual a la fecha final');
    }

    try {
      return await this.prisma.$transaction(async tx => {
        const overlap = await tx.accountingPeriod.findFirst({
          where: { startsAt: { lte: endsAt }, endsAt: { gte: startsAt } },
          select: { id: true, name: true },
        });
        if (overlap) {
          throw new ConflictException(`El período se superpone con el período ${overlap.name}`);
        }

        const period = await tx.accountingPeriod.create({
          data: { name: dto.name.trim(), startsAt, endsAt },
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: 'CREATE',
            table: 'AccountingPeriod',
            recordId: period.id,
            newData: {
              name: period.name,
              startsAt: period.startsAt.toISOString(),
              endsAt: period.endsAt.toISOString(),
            },
          },
        });
        return period;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe un período con ese nombre');
      }
      throw error;
    }
  }

  async closePeriod(id: number, actorId: number) {
    return this.prisma.$transaction(async tx => {
      const period = await tx.accountingPeriod.findUnique({ where: { id } });
      if (!period) throw new NotFoundException('Período contable no encontrado');
      if (period.status !== AccountingPeriodStatus.OPEN) {
        throw new ConflictException('El período ya está cerrado');
      }

      const drafts = await tx.journalEntry.count({
        where: {
          periodId: id,
          status: JournalEntryStatus.DRAFT,
        },
      });
      if (drafts > 0) {
        throw new ConflictException('No se puede cerrar el período mientras tenga asientos pendientes');
      }

      const updated = await tx.accountingPeriod.update({
        where: { id },
        data: { status: AccountingPeriodStatus.CLOSED, closedAt: new Date(), closedById: actorId },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'CLOSE',
          table: 'AccountingPeriod',
          recordId: id,
          oldData: { status: period.status },
          newData: { status: updated.status, closedAt: updated.closedAt?.toISOString() },
        },
      });
      return updated;
    });
  }

  private async findOpenPeriod(tx: Prisma.TransactionClient, date: Date) {
    const period = await tx.accountingPeriod.findFirst({
      where: {
        status: AccountingPeriodStatus.OPEN,
        startsAt: { lte: date },
        endsAt: { gte: date },
      },
      orderBy: { startsAt: 'desc' },
    });
    if (!period) {
      throw new BadRequestException('No existe un período contable abierto para la fecha del asiento');
    }
    return period;
  }

  private async validateLines(tx: Prisma.TransactionClient, dto: CreateJournalEntryDto) {
    const functionalCurrency = await this.getFunctionalCurrency(tx);
    const accountIds = Array.from(new Set(dto.lines.map(line => line.accountId)));
    const accounts = await tx.account.findMany({
      where: { id: { in: accountIds }, isActive: true },
      select: { id: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('Todos los asientos deben usar cuentas contables activas');
    }

    const costCenterIds = Array.from(new Set(dto.lines.map(line => line.costCenterId).filter(Boolean))) as number[];
    if (costCenterIds.length) {
      const costCenters = await tx.costCenter.findMany({
        where: { id: { in: costCenterIds }, isActive: true },
        select: { id: true },
      });
      if (costCenters.length !== costCenterIds.length) {
        throw new BadRequestException('Todos los centros de costo deben existir y estar activos');
      }
    }

    for (const line of dto.lines) {
      if ((line.debit > 0) === (line.credit > 0)) {
        throw new BadRequestException('Cada línea debe tener importe en débito o crédito, pero no en ambos');
      }
      const currencyCode = line.currencyCode?.trim().toUpperCase();
      const hasOriginalAmount = line.originalDebit !== undefined || line.originalCredit !== undefined;
      if (hasOriginalAmount && !currencyCode) {
        throw new BadRequestException('La moneda es obligatoria cuando se informa un importe original');
      }
      if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) {
        throw new BadRequestException('El código de moneda debe tener tres letras ISO 4217');
      }
      if (currencyCode && currencyCode !== functionalCurrency && (!line.exchangeRate || line.exchangeRate <= 0)) {
        throw new BadRequestException('Se requiere una tasa de cambio positiva para importes en moneda extranjera');
      }
      if (line.originalDebit !== undefined && line.originalCredit !== undefined) {
        throw new BadRequestException('Una línea no puede tener débito y crédito en moneda original simultáneamente');
      }
    }

    return dto.lines.map(line => ({
      accountId: line.accountId,
      costCenterId: line.costCenterId,
      description: line.description?.trim(),
      debit: new Prisma.Decimal(line.debit),
      credit: new Prisma.Decimal(line.credit),
      currencyCode: line.currencyCode?.trim().toUpperCase(),
      originalDebit: line.originalDebit === undefined ? undefined : new Prisma.Decimal(line.originalDebit),
      originalCredit: line.originalCredit === undefined ? undefined : new Prisma.Decimal(line.originalCredit),
      exchangeRate: line.exchangeRate === undefined ? undefined : new Prisma.Decimal(line.exchangeRate),
    }));
  }

  async createJournalEntry(actorId: number, dto: CreateJournalEntryDto) {
    // La fecha contable de un asiento nuevo es el día actual del servidor (normalizado a UTC).
    const date = this.currentAccountingDate();
    const rawDescription = dto.description.trim();
    if (dto.isAdjustment && !rawDescription) {
      throw new BadRequestException('Describa el ajuste e indique la fecha real del hecho corregido');
    }
    const description = dto.isAdjustment && !/^ajuste de asiento:/i.test(rawDescription)
      ? `AJUSTE DE ASIENTO: ${rawDescription}`
      : rawDescription;
    if (!description) throw new BadRequestException('La descripción del asiento es obligatoria');
    if (dto.kind === JournalEntryKind.REVERSAL || dto.kind === JournalEntryKind.INVENTORY_MOVEMENT) {
      throw new BadRequestException('Este tipo de asiento solo puede generarse desde el flujo contable correspondiente');
    }

    return this.prisma.$transaction(async tx => {
      const period = await this.findOpenPeriod(tx, date);
      const lines = await this.validateLines(tx, dto);
      const entry = await tx.journalEntry.create({
        data: {
          date,
          description,
          reference: dto.reference?.trim(),
          kind: dto.kind || JournalEntryKind.GENERAL,
          periodId: period.id,
          createdById: actorId,
          lines: { create: lines },
        },
        include: journalEntryInclude,
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'CREATE_DRAFT',
          table: 'JournalEntry',
          recordId: entry.id,
          newData: {
            entryNumber: entry.entryNumber,
            date: entry.date.toISOString(),
            description: entry.description,
            status: entry.status,
          },
        },
      });
      return { ...entry, formattedNumber: this.formatEntryNumber(entry.entryNumber) };
    });
  }

  async createInventoryOpening(actorId: number, dto: InventoryOpeningDto) {
    const date = this.normalizeDate(dto.date);
    const description = dto.description.trim();
    if (!description) throw new BadRequestException('La descripción del conteo de apertura es obligatoria');

    const itemIds = dto.items.map(item => item.productId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException('El conteo contiene productos duplicados');
    }

    return this.prisma.$transaction(async tx => {
      const company = await tx.company.findFirst({ orderBy: { id: 'asc' } });
      if (!company) throw new BadRequestException('Configure primero la información de la empresa');
      if (company.accountingCutoverAt) {
        throw new ConflictException('La apertura contable ya fue realizada y no se puede reemplazar');
      }
      if (await tx.journalEntry.count() > 0) {
        throw new ConflictException('La apertura de inventario debe ser el primer asiento del libro mayor');
      }

      const laterMovement = await tx.movement.findFirst({
        where: { status: MovementStatus.POSTED, date: { gt: date } },
        select: { id: true },
      });
      if (laterMovement) {
        throw new BadRequestException('Hay movimientos posteriores a la fecha de corte; el conteo debe cubrir la fecha más reciente');
      }

      const period = await this.findOpenPeriod(tx, date);
      const [inventoryAccount, equityAccount, products] = await Promise.all([
        tx.account.findUnique({ where: { id: dto.inventoryAccountId } }),
        tx.account.findUnique({ where: { id: dto.openingEquityAccountId } }),
        tx.product.findMany({
          where: { OR: [{ isActive: true }, { stock: { not: 0 } }] },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
      ]);
      if (!inventoryAccount?.isActive || inventoryAccount.type !== AccountType.ASSET) {
        throw new BadRequestException('Seleccione una cuenta de inventario activa de tipo activo');
      }
      if (!equityAccount?.isActive || equityAccount.type !== AccountType.EQUITY) {
        throw new BadRequestException('La contrapartida de apertura debe ser una cuenta de patrimonio activa');
      }
      const requiredIds = new Set(products.map(product => product.id));
      if (requiredIds.size !== itemIds.length || itemIds.some(id => !requiredIds.has(id))) {
        throw new BadRequestException('El conteo debe incluir exactamente todos los productos activos o con existencias');
      }

      const functionalCurrency = company.functionalCurrencyCode.trim().toUpperCase();
      const functionalRate = await this.getFunctionalCurrencyRate(tx, functionalCurrency, date);
      const openingItems = dto.items.map(item => {
        if (item.countedQuantity > 0 && item.unitCost <= 0) {
          throw new BadRequestException('Cada producto con existencias requiere un costo unitario de apertura positivo');
        }
        const quantity = new Prisma.Decimal(item.countedQuantity);
        const unitCost = new Prisma.Decimal(item.unitCost);
        const value = quantity.mul(unitCost).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
        return { productId: item.productId, quantity, unitCost, value };
      });
      const totalValue = openingItems.reduce(
        (total, item) => total.add(item.value),
        new Prisma.Decimal(0),
      );
      if (!totalValue.gt(0)) {
        throw new BadRequestException('El valor total del inventario de apertura debe ser mayor que cero');
      }

      for (const item of openingItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: item.quantity,
            unitCost: item.unitCost.mul(functionalRate).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP),
          },
        });
      }

      const entry = await tx.journalEntry.create({
        data: {
          date,
          description,
          reference: `COUNT-${date.toISOString().slice(0, 10)}`,
          kind: JournalEntryKind.INVENTORY_OPENING,
          status: JournalEntryStatus.POSTED,
          periodId: period.id,
          createdById: actorId,
          postedById: actorId,
          postedAt: new Date(),
          lines: {
            create: [
              ...openingItems.filter(item => item.value.gt(0)).map(item => ({
                accountId: inventoryAccount.id,
                productId: item.productId,
                description: 'Inventario según conteo físico de apertura',
                debit: item.value,
                credit: new Prisma.Decimal(0),
                currencyCode: functionalCurrency,
                originalDebit: item.value,
              })),
              {
                accountId: equityAccount.id,
                description: 'Contrapartida del inventario de apertura',
                debit: new Prisma.Decimal(0),
                credit: totalValue,
                currencyCode: functionalCurrency,
                originalCredit: totalValue,
              },
            ],
          },
        },
      });

      await tx.company.update({
        where: { id: company.id },
        data: { inventoryAccountId: inventoryAccount.id, accountingCutoverAt: date },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'INVENTORY_OPENING',
          table: 'JournalEntry',
          recordId: entry.id,
          newData: {
            entryNumber: entry.entryNumber,
            cutoverDate: date.toISOString(),
            functionalCurrency,
            inventoryAccountId: inventoryAccount.id,
            openingEquityAccountId: equityAccount.id,
            totalValue: totalValue.toString(),
            items: openingItems.map(item => ({
              productId: item.productId,
              quantity: item.quantity.toString(),
              unitCost: item.unitCost.toString(),
              value: item.value.toString(),
            })),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'SET_ACCOUNTING_CUTOVER',
          table: 'Company',
          recordId: company.id,
          oldData: { accountingCutoverAt: null },
          newData: {
            accountingCutoverAt: date.toISOString(),
            inventoryAccountId: inventoryAccount.id,
            functionalCurrency,
          },
        },
      });
      return {
        ...entry,
        formattedNumber: this.formatEntryNumber(entry.entryNumber),
        totalValue: totalValue.toString(),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listJournalEntries(startDate?: Date, endDate?: Date, status?: JournalEntryStatus) {
    if (startDate && endDate && this.normalizeDate(startDate) > this.normalizeDate(endDate)) {
      throw new BadRequestException('startDate no puede ser posterior a endDate');
    }
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        ...(startDate || endDate ? {
          date: {
            ...(startDate ? { gte: this.normalizeDate(startDate) } : {}),
            ...(endDate ? { lte: this.normalizeDate(endDate) } : {}),
          },
        } : {}),
        ...(status ? { status } : {}),
      },
      include: journalEntryInclude,
      orderBy: [{ date: 'desc' }, { entryNumber: 'desc' }],
    });
    return {
      data: entries.map(entry => ({
        ...entry,
        formattedNumber: this.formatEntryNumber(entry.entryNumber),
      })),
    };
  }

  async getJournalEntry(id: number) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: journalEntryInclude,
    });
    if (!entry) throw new NotFoundException('Asiento contable no encontrado');
    return { ...entry, formattedNumber: this.formatEntryNumber(entry.entryNumber) };
  }

  async postJournalEntry(id: number, actorId: number) {
    return this.prisma.$transaction(async tx => {
      const entry = await tx.journalEntry.findUnique({
        where: { id },
        include: { lines: { include: { account: true } }, period: true },
      });
      if (!entry) throw new NotFoundException('Asiento contable no encontrado');
      if (entry.status !== JournalEntryStatus.DRAFT) {
        throw new ConflictException('Solo se pueden contabilizar asientos en borrador');
      }
      if (!entry.period || entry.period.status !== AccountingPeriodStatus.OPEN) {
        throw new ConflictException('El asiento no pertenece a un período abierto');
      }
      if (entry.lines.length < 2 || entry.lines.some(line => !line.account.isActive)) {
        throw new BadRequestException('El asiento requiere al menos dos líneas en cuentas activas');
      }

      const debit = entry.lines.reduce((sum, line) => sum.add(line.debit), new Prisma.Decimal(0));
      const credit = entry.lines.reduce((sum, line) => sum.add(line.credit), new Prisma.Decimal(0));
      if (!debit.gt(0) || !debit.equals(credit)) {
        throw new BadRequestException('El asiento debe estar balanceado: total débito igual a total crédito y mayor que cero');
      }

      const updated = await tx.journalEntry.updateMany({
        where: { id, status: JournalEntryStatus.DRAFT },
        data: { status: JournalEntryStatus.POSTED, postedById: actorId, postedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new ConflictException('El asiento fue actualizado por otra operación; vuelve a cargarlo');
      }

      const posted = await tx.journalEntry.findUniqueOrThrow({
        where: { id },
        include: journalEntryInclude,
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'POST',
          table: 'JournalEntry',
          recordId: id,
          oldData: { status: JournalEntryStatus.DRAFT },
          newData: { status: JournalEntryStatus.POSTED, postedAt: posted.postedAt?.toISOString() },
        },
      });
      return { ...posted, formattedNumber: this.formatEntryNumber(posted.entryNumber) };
    });
  }

  async reverseJournalEntry(id: number, actorId: number) {
    return this.prisma.$transaction(async tx => {
      const original = await tx.journalEntry.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!original) throw new NotFoundException('Asiento contable no encontrado');
      if (original.status !== JournalEntryStatus.POSTED) {
        throw new ConflictException('Solo se pueden revertir asientos contabilizados');
      }
      if (await tx.journalEntry.findUnique({ where: { reversalOfId: id }, select: { id: true } })) {
        throw new ConflictException('Este asiento ya tiene un reverso');
      }

      const reversalDate = this.normalizeDate(new Date());
      const period = await this.findOpenPeriod(tx, reversalDate);
      const reversal = await tx.journalEntry.create({
        data: {
          date: reversalDate,
          description: `Reverso de JE-${String(original.entryNumber).padStart(8, '0')}: ${original.description}`,
          reference: original.reference,
          kind: JournalEntryKind.REVERSAL,
          status: JournalEntryStatus.POSTED,
          periodId: period.id,
          createdById: actorId,
          postedById: actorId,
          postedAt: new Date(),
          reversalOfId: original.id,
          lines: {
            create: original.lines.map(line => ({
              accountId: line.accountId,
              costCenterId: line.costCenterId,
              description: line.description,
              debit: line.credit,
              credit: line.debit,
              currencyCode: line.currencyCode,
              originalDebit: line.originalCredit,
              originalCredit: line.originalDebit,
              exchangeRate: line.exchangeRate,
            })),
          },
        },
        include: journalEntryInclude,
      });

      const changed = await tx.journalEntry.updateMany({
        where: { id, status: JournalEntryStatus.POSTED },
        data: { status: JournalEntryStatus.REVERSED },
      });
      if (changed.count !== 1) {
        throw new ConflictException('El asiento fue actualizado por otra operación; vuelve a cargarlo');
      }
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'REVERSE',
          table: 'JournalEntry',
          recordId: id,
          oldData: { status: JournalEntryStatus.POSTED },
          newData: {
            status: JournalEntryStatus.REVERSED,
            reversalEntryId: reversal.id,
            reversalEntryNumber: reversal.entryNumber,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'CREATE_REVERSAL',
          table: 'JournalEntry',
          recordId: reversal.id,
          newData: {
            reversalOfId: original.id,
            reversalEntryNumber: reversal.entryNumber,
            status: reversal.status,
          },
        },
      });
      return { ...reversal, formattedNumber: this.formatEntryNumber(reversal.entryNumber) };
    });
  }

  async postInventoryMovement(
    tx: Prisma.TransactionClient,
    input: {
      movementId: number;
      actorId: number;
      date: Date;
      description?: string | null;
      documentNumber?: string | null;
      type: MovementType;
      currencyCode: string;
      rateAtTransaction: Prisma.Decimal;
      counterpartAccountId: number;
      costCenterId?: number | null;
      details: Array<{
        productId: number;
        quantity: Prisma.Decimal;
        unitCost: Prisma.Decimal;
        totalCost: Prisma.Decimal;
      }>;
    },
  ) {
    const company = await tx.company.findFirst({
      orderBy: { id: 'asc' },
      select: { functionalCurrencyCode: true, inventoryAccountId: true, accountingCutoverAt: true },
    });
    if (!company?.inventoryAccountId || !company.accountingCutoverAt) {
      throw new BadRequestException('Configure la cuenta de inventario y el asiento de apertura antes de contabilizar movimientos');
    }
    if (this.normalizeDate(input.date) < this.normalizeDate(company.accountingCutoverAt)) {
      throw new BadRequestException('No se permiten movimientos anteriores a la fecha de apertura contable');
    }

    const [inventoryAccount, counterpartAccount, period] = await Promise.all([
      tx.account.findUnique({ where: { id: company.inventoryAccountId } }),
      tx.account.findUnique({ where: { id: input.counterpartAccountId } }),
      this.findOpenPeriod(tx, this.normalizeDate(input.date)),
    ]);
    if (!inventoryAccount?.isActive || inventoryAccount.type !== AccountType.ASSET) {
      throw new BadRequestException('La cuenta de inventario configurada debe ser una cuenta de activo activa');
    }
    if (!counterpartAccount?.isActive) {
      throw new BadRequestException('La cuenta de contrapartida debe existir y estar activa');
    }
    if (input.type === MovementType.SALIDA && counterpartAccount.type !== AccountType.EXPENSE) {
      throw new BadRequestException('Una salida de inventario debe imputarse a una cuenta de gasto');
    }
    if (input.type === MovementType.ENTRADA && counterpartAccount.type === AccountType.EXPENSE) {
      throw new BadRequestException('La contrapartida de una entrada no puede ser una cuenta de gasto');
    }

    const functionalCurrency = company.functionalCurrencyCode.trim().toUpperCase();
    const functionalRate = await this.getFunctionalCurrencyRate(tx, functionalCurrency, input.date);
    const sourceRate = input.currencyCode === 'USD'
      ? new Prisma.Decimal(1)
      : input.rateAtTransaction;
    const functionalPerSourceUnit = sourceRate.div(functionalRate);
    if (!functionalPerSourceUnit.gt(0)) {
      throw new BadRequestException('No se pudo determinar la conversión a moneda funcional');
    }

    const lines: Prisma.JournalLineCreateWithoutJournalEntryInput[] = [];
    for (const detail of input.details) {
      const amount = detail.totalCost
        .mul(functionalPerSourceUnit)
        .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
      if (!amount.gt(0)) {
        throw new BadRequestException('El costo funcional del movimiento debe ser mayor que cero');
      }
      const sourceAmount = detail.totalCost;
      const debitAccountId = input.type === MovementType.ENTRADA
        ? inventoryAccount.id
        : counterpartAccount.id;
      const creditAccountId = input.type === MovementType.ENTRADA
        ? counterpartAccount.id
        : inventoryAccount.id;
      lines.push({
        account: { connect: { id: debitAccountId } },
        product: { connect: { id: detail.productId } },
        ...(input.costCenterId ? { costCenter: { connect: { id: input.costCenterId } } } : {}),
        description: input.description || undefined,
        debit: amount,
        credit: new Prisma.Decimal(0),
        currencyCode: input.currencyCode,
        originalDebit: sourceAmount,
        exchangeRate: functionalPerSourceUnit,
      });
      lines.push({
        account: { connect: { id: creditAccountId } },
        product: { connect: { id: detail.productId } },
        ...(input.costCenterId ? { costCenter: { connect: { id: input.costCenterId } } } : {}),
        description: input.description || undefined,
        debit: new Prisma.Decimal(0),
        credit: amount,
        currencyCode: input.currencyCode,
        originalCredit: sourceAmount,
        exchangeRate: functionalPerSourceUnit,
      });
    }

    const entry = await tx.journalEntry.create({
      data: {
        date: this.normalizeDate(input.date),
        description: input.description?.trim() || `${input.type} de inventario`,
        reference: input.documentNumber || undefined,
        kind: JournalEntryKind.INVENTORY_MOVEMENT,
        status: JournalEntryStatus.POSTED,
        periodId: period.id,
        createdById: input.actorId,
        postedById: input.actorId,
        postedAt: new Date(),
        sourceMovementId: input.movementId,
        lines: { create: lines },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: 'POST_INVENTORY_MOVEMENT',
        table: 'JournalEntry',
        recordId: entry.id,
        newData: {
          entryNumber: entry.entryNumber,
          sourceMovementId: input.movementId,
          currencyCode: input.currencyCode,
          functionalCurrency,
        },
      },
    });
    return entry;
  }

  async reverseInventoryMovement(
    tx: Prisma.TransactionClient,
    sourceMovementId: number,
    reversalMovementId: number,
    actorId: number,
    reversalDate: Date,
  ) {
    const original = await tx.journalEntry.findUnique({
      where: { sourceMovementId },
      include: { lines: true },
    });
    if (!original || original.status !== JournalEntryStatus.POSTED) {
      throw new ConflictException('El movimiento no tiene un asiento contabilizado que se pueda revertir');
    }
    if (await tx.journalEntry.findUnique({ where: { reversalOfId: original.id }, select: { id: true } })) {
      throw new ConflictException('El asiento de este movimiento ya fue revertido');
    }
    const period = await this.findOpenPeriod(tx, this.normalizeDate(reversalDate));
    const reversal = await tx.journalEntry.create({
      data: {
        date: this.normalizeDate(reversalDate),
        description: `Reverso de JE-${String(original.entryNumber).padStart(8, '0')}`,
        reference: `MOV-${reversalMovementId}`,
        kind: JournalEntryKind.REVERSAL,
        status: JournalEntryStatus.POSTED,
        periodId: period.id,
        createdById: actorId,
        postedById: actorId,
        postedAt: new Date(),
        reversalOfId: original.id,
        sourceMovementId: reversalMovementId,
        lines: {
          create: original.lines.map(line => ({
            accountId: line.accountId,
            productId: line.productId,
            costCenterId: line.costCenterId,
            description: line.description,
            debit: line.credit,
            credit: line.debit,
            currencyCode: line.currencyCode,
            originalDebit: line.originalCredit,
            originalCredit: line.originalDebit,
            exchangeRate: line.exchangeRate,
          })),
        },
      },
    });
    const updated = await tx.journalEntry.updateMany({
      where: { id: original.id, status: JournalEntryStatus.POSTED },
      data: { status: JournalEntryStatus.REVERSED },
    });
    if (updated.count !== 1) {
      throw new ConflictException('El asiento fue revertido por otra operación');
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'REVERSE_INVENTORY_MOVEMENT',
        table: 'JournalEntry',
        recordId: original.id,
        oldData: { status: JournalEntryStatus.POSTED },
        newData: { status: JournalEntryStatus.REVERSED, reversalEntryId: reversal.id },
      },
    });
    return reversal;
  }

  private async getFunctionalCurrencyRate(
    tx: Prisma.TransactionClient,
    code: string,
    date: Date,
  ): Promise<Prisma.Decimal> {
    if (code === 'USD') return new Prisma.Decimal(1);
    const rate = await tx.currencyRate.findFirst({
      where: { code, effectiveFrom: { lte: date } },
      orderBy: { effectiveFrom: 'desc' },
      select: { rate: true },
    });
    if (!rate || !rate.rate.gt(0)) {
      throw new BadRequestException(`No existe una tasa histórica de ${code} para la fecha indicada`);
    }
    return rate.rate;
  }

  async getTrialBalance(startDate?: Date, endDate?: Date) {
    const end = endDate ? this.normalizeDate(endDate) : this.normalizeDate(new Date());
    const start = startDate ? this.normalizeDate(startDate) : undefined;
    if (start && start > end) {
      throw new BadRequestException('startDate no puede ser posterior a endDate');
    }

    const whereBeforeStart: Prisma.JournalLineWhereInput | undefined = start
      ? { journalEntry: { status: JournalEntryStatus.POSTED, date: { lt: start } } }
      : undefined;
    const whereInPeriod: Prisma.JournalLineWhereInput = {
      journalEntry: {
        status: JournalEntryStatus.POSTED,
        date: { ...(start ? { gte: start } : {}), lte: end },
      },
    };

    const [accounts, openingSums, periodSums, company] = await Promise.all([
      this.prisma.account.findMany({
        orderBy: { code: 'asc' },
      }),
      whereBeforeStart
        ? this.prisma.journalLine.groupBy({
            by: ['accountId'],
            where: whereBeforeStart,
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve([]),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: whereInPeriod,
        _sum: { debit: true, credit: true },
      }),
      this.prisma.company.findFirst({
        orderBy: { id: 'asc' },
        select: { functionalCurrencyCode: true },
      }),
    ]);

    const opening = new Map(openingSums.map(sum => [
      sum.accountId,
      { debit: sum._sum.debit || new Prisma.Decimal(0), credit: sum._sum.credit || new Prisma.Decimal(0) },
    ]));
    const activity = new Map(periodSums.map(sum => [
      sum.accountId,
      { debit: sum._sum.debit || new Prisma.Decimal(0), credit: sum._sum.credit || new Prisma.Decimal(0) },
    ]));

    const rows = accounts.map(account => {
      const initial = opening.get(account.id) || { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      const current = activity.get(account.id) || { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      const openingNet = initial.debit.sub(initial.credit);
      const movementNet = current.debit.sub(current.credit);
      const closingNet = openingNet.add(movementNet);
      return {
        account,
        openingDebit: openingNet.gt(0) ? openingNet.toString() : '0',
        openingCredit: openingNet.lt(0) ? openingNet.abs().toString() : '0',
        periodDebits: current.debit.toString(),
        periodCredits: current.credit.toString(),
        closingDebit: closingNet.gt(0) ? closingNet.toString() : '0',
        closingCredit: closingNet.lt(0) ? closingNet.abs().toString() : '0',
      };
    });

    return {
      functionalCurrency: (company?.functionalCurrencyCode || 'USD').toUpperCase(),
      startDate: start?.toISOString().slice(0, 10) || null,
      endDate: end.toISOString().slice(0, 10),
      accounts: rows,
    };
  }
}
