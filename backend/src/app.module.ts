// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { SharedModule } from './shared/shared.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { ClientsModule } from './clients/clients.module';
import { CostCentersModule } from './cost-centers/cost-centers.module';
import { MovementsModule } from './movements/movements.module';
import { ReportsModule } from './reports/reports.module';
import { CompanyModule } from './company/company.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { UsersModule } from './users/users.module';
import { AccountingModule } from './accounting/accounting.module';
import { HealthController } from './health.controller';
import * as Joi from 'joi';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().when('NODE_ENV', {
          is: 'production', then: Joi.string().min(32).required(), otherwise: Joi.optional(),
        }),
        FRONTEND_URL: Joi.string().when('NODE_ENV', {
          is: 'production', then: Joi.required(), otherwise: Joi.optional(),
        }),
        PORT: Joi.number().port().default(3000),
      }),
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),

    SharedModule,     // contiene PrismaModule
    AuthModule,
    ProductsModule,
    ClientsModule,
    CostCentersModule,
    MovementsModule,
    ReportsModule,
    CompanyModule,
    // Currencies (file-based simple settings)
    CurrenciesModule,
    MaintenanceModule,
    UsersModule,
    AccountingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
