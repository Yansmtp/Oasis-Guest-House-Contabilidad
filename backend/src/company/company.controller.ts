import { Controller, Get, Put, Post, Body, Param, UploadedFile, UseInterceptors, UseGuards, Req, HttpException, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CompanyService } from './company.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import { resolveUploadsRoot } from '../shared/utils/uploads-root';

@Controller('company')
@UseGuards(JwtAuthGuard)
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  findOne() {
    return this.companyService.findOne();
  }

  @Put(':id')
  @UseGuards(AdminRoleGuard)
  update(@Param('id') id: string, @Body() updateCompanyDto: UpdateCompanyDto) {
    return this.companyService.update(+id, updateCompanyDto);
  }

  @Put(':id/logo')
  @UseGuards(AdminRoleGuard)
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: (req, file, callback) => {
          try {
            const dir = join(resolveUploadsRoot(), 'logos');
            fs.mkdirSync(dir, { recursive: true });
            callback(null, dir);
          } catch (e) {
            callback(e, null);
          }
        },
        filename: (req, file, callback) => {
          const ext = (extname(file.originalname) || '.png').toLowerCase();
          const companyId = Number(req.params?.id) || 1;
          const filename = `logo-company-${companyId}${ext}`;
          callback(null, filename);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif|svg)$/i)) {
          return callback(new Error('Solo se permiten imágenes'), false);
        }
        callback(null, true);
      },
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  )
  async updateLogo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    console.log('LOGO UPLOAD:', req.method, req.path, 'file:', file ? file.filename : 'no-file', 'content-type:', req.headers['content-type']);

    if (!file) {
      throw new HttpException('No se recibió archivo', HttpStatus.BAD_REQUEST);
    }

    // Construir URL pública
    const updated = await this.companyService.updateLogo(+id, file);
    const publicUrl = `${req.protocol}://${req.get('host')}${updated.logo}`;

    return { logo: publicUrl };
  }

  // Also support POST for clients that prefer POST for multipart/form-data
  @Post(':id/logo')
  @UseGuards(AdminRoleGuard)
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: (req, file, callback) => {
          try {
            const dir = join(resolveUploadsRoot(), 'logos');
            fs.mkdirSync(dir, { recursive: true });
            callback(null, dir);
          } catch (e) {
            callback(e, null);
          }
        },
        filename: (req, file, callback) => {
          const ext = (extname(file.originalname) || '.png').toLowerCase();
          const companyId = Number(req.params?.id) || 1;
          const filename = `logo-company-${companyId}${ext}`;
          callback(null, filename);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif|svg)$/i)) {
          return callback(new Error('Solo se permiten imágenes'), false);
        }
        callback(null, true);
      },
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  )
  async uploadLogoPost(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    console.log('LOGO UPLOAD (POST):', req.method, req.path, 'file:', file ? file.filename : 'no-file');

    if (!file) {
      throw new HttpException('No se recibió archivo', HttpStatus.BAD_REQUEST);
    }

    const updated = await this.companyService.updateLogo(+id, file);
    const publicUrl = `${req.protocol}://${req.get('host')}${updated.logo}`;

    return { logo: publicUrl };
  }

  @Get(':id/logo')
  getLogo(@Param('id') id: string) {
    return this.companyService.getLogoPath(+id);
  }
}
