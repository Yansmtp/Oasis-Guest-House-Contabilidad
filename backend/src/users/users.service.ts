import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { data: users };
  }

  async create(dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    const role = (dto.role || 'USER').toUpperCase();

    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('El usuario ya existe');

    const hashed = await bcrypt.hash(dto.password, 10);
    const created = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email,
        password: hashed,
        role,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { data: created };
  }

  async update(id: number, dto: UpdateUserDto, currentUserId: number) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Usuario no encontrado');

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.role !== undefined) data.role = dto.role.toUpperCase();
    if (dto.password !== undefined) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    if (data.email && data.email !== existing.email) {
      const dup = await this.prisma.user.findUnique({ where: { email: data.email } });
      if (dup) throw new ConflictException('Ya existe un usuario con ese email');
    }

    if (existing.role === 'ADMIN' && data.role === 'USER') {
      const totalAdmins = await this.prisma.user.count({ where: { role: 'ADMIN' } });
      if (totalAdmins <= 1) {
        throw new BadRequestException('Debe existir al menos un administrador');
      }
    }

    if (id === currentUserId && data.role === 'USER') {
      throw new BadRequestException('No puede quitarse el rol ADMIN a si mismo');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { data: updated };
  }

  async remove(id: number, currentUserId: number) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Usuario no encontrado');

    if (id === currentUserId) {
      throw new BadRequestException('No puede eliminar su propio usuario');
    }

    if (existing.role === 'ADMIN') {
      const totalAdmins = await this.prisma.user.count({ where: { role: 'ADMIN' } });
      if (totalAdmins <= 1) {
        throw new BadRequestException('Debe existir al menos un administrador');
      }
    }

    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
