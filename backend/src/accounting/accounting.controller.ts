import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { JournalEntryStatus } from '@prisma/client';
import { AdminRoleGuard } from '../shared/guards/admin-role.guard';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { AccountingService } from './accounting.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { InventoryOpeningDto } from './dto/inventory-opening.dto';

@Controller('accounting')
@UseGuards(JwtAuthGuard)
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  private parseDate(value?: string, fieldName = 'date'): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} no es una fecha válida`);
    }
    return parsed;
  }

  @Get('accounts')
  getAccounts(@Query('includeInactive') includeInactive?: string) {
    if (includeInactive && !['true', 'false'].includes(includeInactive.toLowerCase())) {
      throw new BadRequestException('includeInactive debe ser true o false');
    }
    return this.accountingService.getAccounts(includeInactive?.toLowerCase() === 'true');
  }

  @Post('accounts')
  @UseGuards(AdminRoleGuard)
  createAccount(@Req() req, @Body() dto: CreateAccountDto) {
    return this.accountingService.createAccount(req.user.userId, dto);
  }

  @Patch('accounts/:id')
  @UseGuards(AdminRoleGuard)
  updateAccount(@Param('id', ParseIntPipe) id: number, @Req() req, @Body() dto: UpdateAccountDto) {
    return this.accountingService.updateAccount(id, req.user.userId, dto);
  }

  @Get('periods')
  getPeriods() {
    return this.accountingService.getPeriods();
  }

  @Post('periods')
  @UseGuards(AdminRoleGuard)
  createPeriod(@Req() req, @Body() dto: CreateAccountingPeriodDto) {
    return this.accountingService.createPeriod(req.user.userId, dto);
  }

  @Post('periods/:id/close')
  @UseGuards(AdminRoleGuard)
  closePeriod(@Param('id', ParseIntPipe) id: number, @Req() req) {
    return this.accountingService.closePeriod(id, req.user.userId);
  }

  @Post('journal-entries')
  @UseGuards(AdminRoleGuard)
  createJournalEntry(@Req() req, @Body() dto: CreateJournalEntryDto) {
    return this.accountingService.createJournalEntry(req.user.userId, dto);
  }

  @Post('inventory-opening')
  @UseGuards(AdminRoleGuard)
  createInventoryOpening(@Req() req, @Body() dto: InventoryOpeningDto) {
    return this.accountingService.createInventoryOpening(req.user.userId, dto);
  }

  @Get('journal-entries')
  @UseGuards(AdminRoleGuard)
  listJournalEntries(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
  ) {
    let normalizedStatus: JournalEntryStatus | undefined;
    if (status) {
      if (!Object.values(JournalEntryStatus).includes(status as JournalEntryStatus)) {
        throw new BadRequestException('status debe ser DRAFT, POSTED o REVERSED');
      }
      normalizedStatus = status as JournalEntryStatus;
    }
    return this.accountingService.listJournalEntries(
      this.parseDate(startDate, 'startDate'),
      this.parseDate(endDate, 'endDate'),
      normalizedStatus,
    );
  }

  @Get('journal-entries/:id')
  @UseGuards(AdminRoleGuard)
  getJournalEntry(@Param('id', ParseIntPipe) id: number) {
    return this.accountingService.getJournalEntry(id);
  }

  @Post('journal-entries/:id/post')
  @UseGuards(AdminRoleGuard)
  postJournalEntry(@Param('id', ParseIntPipe) id: number, @Req() req) {
    return this.accountingService.postJournalEntry(id, req.user.userId);
  }

  @Post('journal-entries/:id/reverse')
  @UseGuards(AdminRoleGuard)
  reverseJournalEntry(@Param('id', ParseIntPipe) id: number, @Req() req) {
    return this.accountingService.reverseJournalEntry(id, req.user.userId);
  }

  @Get('trial-balance')
  @UseGuards(AdminRoleGuard)
  getTrialBalance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.accountingService.getTrialBalance(
      this.parseDate(startDate, 'startDate'),
      this.parseDate(endDate, 'endDate'),
    );
  }
}
