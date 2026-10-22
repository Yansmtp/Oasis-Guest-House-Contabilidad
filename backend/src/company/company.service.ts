import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { UpdateCompanyDto } from './dto/update-company.dto';

const COMPANY_LOGO_PATH = '/assets/brand/oasis-logo.png';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async findOne() {
    const company = await this.prisma.company.findFirst({
      orderBy: { id: 'asc' },
    });

    if (!company) {
      return this.prisma.company.create({
        data: {
          name: 'Oasis Guest House',
          lowStockThreshold: 10,
          logo: COMPANY_LOGO_PATH,
        },
      });
    }

    // La marca está empaquetada con el backend y nunca depende de archivos subidos.
    return { ...company, logo: COMPANY_LOGO_PATH };
  }

  async update(id: number, updateCompanyDto: UpdateCompanyDto) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const functionalCurrencyCode = updateCompanyDto.functionalCurrencyCode?.trim().toUpperCase();
    if (
      functionalCurrencyCode &&
      company.accountingCutoverAt &&
      functionalCurrencyCode !== company.functionalCurrencyCode
    ) {
      throw new BadRequestException('La moneda funcional no se puede cambiar después de la apertura contable');
    }

    const updated = await this.prisma.company.update({
      where: { id },
      data: {
        ...updateCompanyDto,
        ...(functionalCurrencyCode ? { functionalCurrencyCode } : {}),
      },
    });
    return { ...updated, logo: COMPANY_LOGO_PATH };
  }
}
