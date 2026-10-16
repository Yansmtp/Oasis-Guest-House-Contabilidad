import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import * as fs from 'fs';
import * as path from 'path';
import { promises as fsp } from 'fs';
import { resolveUploadsRoot } from '../shared/utils/uploads-root';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  private getUploadsRoot(): string {
    return resolveUploadsRoot();
  }

  private resolveStoredLogoPath(storedPath: string): string | null {
    if (!storedPath) return null;

    let normalized = storedPath;
    try {
      if (/^https?:\/\//i.test(normalized)) {
        const parsed = new URL(normalized);
        normalized = parsed.pathname;
      }
    } catch (e) {
      // noop
    }

    normalized = normalized.replace(/[?#].*$/, '').replace(/\\/g, '/');
    if (!normalized.startsWith('/uploads/')) return null;

    const relative = normalized.replace(/^\/uploads\//, '');
    const absolute = path.resolve(this.getUploadsRoot(), relative);
    if (!absolute.startsWith(this.getUploadsRoot())) return null;
    return absolute;
  }

  private async findLatestLogoPath(): Promise<string | null> {
    const logosDir = path.join(this.getUploadsRoot(), 'logos');
    try {
      const entries = await fsp.readdir(logosDir, { withFileTypes: true });
      const files = entries.filter(e => e.isFile()).map(e => e.name);
      if (!files.length) return null;

      let latest = files[0];
      let latestMtime = (await fsp.stat(path.join(logosDir, latest))).mtimeMs;
      for (const name of files.slice(1)) {
        const mtime = (await fsp.stat(path.join(logosDir, name))).mtimeMs;
        if (mtime > latestMtime) {
          latestMtime = mtime;
          latest = name;
        }
      }
      return `/uploads/logos/${latest}`;
    } catch (e) {
      return null;
    }
  }

  private async cleanupOldLogos(currentFilename: string): Promise<void> {
    const logosDir = path.join(this.getUploadsRoot(), 'logos');
    try {
      const entries = await fsp.readdir(logosDir, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((e) => e.isFile() && e.name !== currentFilename)
          .map(async (e) => {
            const filePath = path.join(logosDir, e.name);
            try {
              await fsp.unlink(filePath);
            } catch (err) {
              // noop: no bloquear la actualización por limpieza
            }
          }),
      );
    } catch (err) {
      // noop
    }
  }

  async findOne() {
    const company = await this.prisma.company.findFirst({
      orderBy: { id: 'asc' },
    });

    if (!company) {
      // Crear una empresa por defecto si no existe
      const logo = await this.findLatestLogoPath();
      return this.prisma.company.create({
        data: {
          name: 'Oasis Guest House',
          lowStockThreshold: 10,
          logo: logo || undefined,
        },
      });
    }

    if (!company.logo) {
      const logo = await this.findLatestLogoPath();
      if (logo) {
        return this.prisma.company.update({
          where: { id: company.id },
          data: { logo },
        });
      }
    }

    // Mantener sincronizado el logo en BD con el archivo real más reciente en uploads/logos.
    // Esto cubre reinicios o casos donde el archivo existe pero la ruta almacenada quedó desactualizada.
    const latestLogo = await this.findLatestLogoPath();
    if (latestLogo && company.logo !== latestLogo) {
      return this.prisma.company.update({
        where: { id: company.id },
        data: { logo: latestLogo },
      });
    }

    return company;
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

    return this.prisma.company.update({
      where: { id },
      data: {
        ...updateCompanyDto,
        ...(functionalCurrencyCode ? { functionalCurrencyCode } : {}),
      },
    });
  }

  async updateLogo(id: number, file: Express.Multer.File) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    // Eliminar logo anterior si existe
    if (company.logo) {
      const oldLogoPath = this.resolveStoredLogoPath(company.logo);
      if (oldLogoPath && fs.existsSync(oldLogoPath)) {
        fs.unlinkSync(oldLogoPath);
      }
    }

    // Guardar nueva ruta del logo
    const logoPath = `/uploads/logos/${file.filename}`;

    const updated = await this.prisma.company.update({
      where: { id },
      data: { logo: logoPath },
    });
    await this.cleanupOldLogos(file.filename);
    return updated;
  }

  async getLogoPath(id: number) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company || !company.logo) {
      return null;
    }

    return company.logo;
  }
}
