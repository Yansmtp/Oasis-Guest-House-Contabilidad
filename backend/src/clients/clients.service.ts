import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { MovementStatus } from '@prisma/client';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  private async generateNextCode(prefix: string): Promise<string> {
    const latest = await this.prisma.client.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { id: 'desc' },
      select: { code: true },
    });

    const parsed = latest?.code ? Number(latest.code.replace(prefix, '')) : 0;
    let next = Number.isFinite(parsed) ? parsed + 1 : 1;
    let candidate = `${prefix}${String(next).padStart(5, '0')}`;

    while (await this.prisma.client.findUnique({ where: { code: candidate } })) {
      next += 1;
      candidate = `${prefix}${String(next).padStart(5, '0')}`;
    }

    return candidate;
  }

  async create(createClientDto: CreateClientDto) {
    const code = (createClientDto.code || '').trim() || await this.generateNextCode('CLI-');

    const existingClient = await this.prisma.client.findUnique({
      where: { code },
    });

    if (existingClient) {
      throw new BadRequestException('El codigo del cliente ya existe');
    }

    return this.prisma.client.create({
      data: {
        ...createClientDto,
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
        { email: { contains: search, mode: 'insensitive' } },
      ],
    };

    if (activeOnly) {
      where.isActive = true;
    }

    const [clients, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.count({ where }),
    ]);

    return {
      data: clients,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const client = await this.prisma.client.findUnique({
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

    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    return client;
  }

  async findByCode(code: string) {
    const client = await this.prisma.client.findUnique({
      where: { code },
    });

    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    return client;
  }

  async update(id: number, updateClientDto: UpdateClientDto) {
    await this.findOne(id);

    return this.prisma.client.update({
      where: { id },
      data: updateClientDto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.client.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getClientMovements(clientId: number, startDate?: Date, endDate?: Date) {
    const where: any = { clientId, status: MovementStatus.POSTED };

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
