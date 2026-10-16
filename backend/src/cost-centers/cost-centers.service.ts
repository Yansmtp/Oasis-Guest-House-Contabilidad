import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';
import { MovementStatus } from '@prisma/client';

@Injectable()
export class CostCentersService {
  constructor(private prisma: PrismaService) {}

  private async generateNextCode(prefix: string): Promise<string> {
    const latest = await this.prisma.costCenter.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { id: 'desc' },
      select: { code: true },
    });

    const parsed = latest?.code ? Number(latest.code.replace(prefix, '')) : 0;
    let next = Number.isFinite(parsed) ? parsed + 1 : 1;
    let candidate = `${prefix}${String(next).padStart(5, '0')}`;

    while (await this.prisma.costCenter.findUnique({ where: { code: candidate } })) {
      next += 1;
      candidate = `${prefix}${String(next).padStart(5, '0')}`;
    }

    return candidate;
  }

  async create(createCostCenterDto: CreateCostCenterDto) {
    const code = (createCostCenterDto.code || '').trim() || await this.generateNextCode('CC-');

    const existingCostCenter = await this.prisma.costCenter.findUnique({
      where: { code },
    });

    if (existingCostCenter) {
      throw new BadRequestException('El codigo del centro de costo ya existe');
    }

    return this.prisma.costCenter.create({
      data: {
        ...createCostCenterDto,
        code,
      },
    });
  }

  async findAll(page: number = 1, limit: number = 10, search: string = '', activeOnly: boolean = true) {
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    };

    if (activeOnly) {
      where.isActive = true;
    }

    const [costCenters, total] = await Promise.all([
      this.prisma.costCenter.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.costCenter.count({ where }),
    ]);

    return {
      data: costCenters,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const costCenter = await this.prisma.costCenter.findUnique({
      where: { id },
      include: {
        movements: {
          take: 10,
          orderBy: { date: 'desc' },
          include: {
            details: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!costCenter) {
      throw new NotFoundException('Centro de costo no encontrado');
    }

    return costCenter;
  }

  async findByCode(code: string) {
    const costCenter = await this.prisma.costCenter.findUnique({
      where: { code },
    });

    if (!costCenter) {
      throw new NotFoundException('Centro de costo no encontrado');
    }

    return costCenter;
  }

  async update(id: number, updateCostCenterDto: UpdateCostCenterDto) {
    await this.findOne(id);

    return this.prisma.costCenter.update({
      where: { id },
      data: updateCostCenterDto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.costCenter.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getCostCenterMovements(costCenterId: number, startDate?: Date, endDate?: Date) {
    const where: any = { costCenterId, status: MovementStatus.POSTED };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    return this.prisma.movement.findMany({
      where,
      include: {
        details: {
          include: {
            product: true,
          },
        },
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });
  }
}
