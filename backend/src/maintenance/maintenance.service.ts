import {
  Injectable,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, statSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { resolveUploadsRoot } from '../shared/utils/uploads-root';

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private autoBackupTimer: NodeJS.Timeout | null = null;
  private autoBackupStartTimer: NodeJS.Timeout | null = null;
  private autoBackupEnabled = true;
  private autoBackupIntervalHours = 24;

  private getRepoRoot() {
    // dist/src/maintenance -> dist/src -> dist -> backend -> repo root
    return join(__dirname, '..', '..', '..', '..');
  }

  private getDefaultBackupDir() {
    return process.env.MAINTENANCE_BACKUP_DIR || join(resolveUploadsRoot(), 'backups');
  }

  private ensureBackupDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private resolveBackupDir(dir?: string) {
    const target = (dir || '').trim() || this.getDefaultBackupDir();
    return isAbsolute(target) ? target : resolve(target);
  }

  async onModuleInit() {
    this.autoBackupEnabled = String(process.env.MAINTENANCE_AUTO_BACKUP ?? 'false').toLowerCase() === 'true';
    const parsedHours = Number(process.env.MAINTENANCE_AUTO_BACKUP_HOURS ?? '24');
    this.autoBackupIntervalHours = Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 24;

    const backupDir = this.resolveBackupDir();
    this.ensureBackupDir(backupDir);

    if (!this.autoBackupEnabled) return;

    const intervalMs = this.autoBackupIntervalHours * 60 * 60 * 1000;
    this.autoBackupStartTimer = setTimeout(() => this.runAutoBackup(), 10000);
    this.autoBackupTimer = setInterval(() => this.runAutoBackup(), intervalMs);
  }

  onModuleDestroy() {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }
    if (this.autoBackupStartTimer) {
      clearTimeout(this.autoBackupStartTimer);
      this.autoBackupStartTimer = null;
    }
  }

  private async runAutoBackup() {
    try {
      await this.backup(this.getDefaultBackupDir(), true);
    } catch (error) {
      const message = String((error as any)?.message || error || '');
      this.logger.error(`Auto backup fallo: ${message}`);
      if (/pg_dump/i.test(message)) {
        this.logger.warn('Auto backup desactivado en esta ejecucion: pg_dump no disponible');
        this.autoBackupEnabled = false;
        if (this.autoBackupTimer) {
          clearInterval(this.autoBackupTimer);
          this.autoBackupTimer = null;
        }
      }
    }
  }

  private runPostgresTool(command: string, args: string[], databaseUrl: string): Promise<string> {
    let password: string | undefined;
    try {
      password = decodeURIComponent(new URL(databaseUrl).password);
    } catch {
      throw new InternalServerErrorException('La URL de base de datos no tiene un formato válido');
    }
    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        { windowsHide: true, maxBuffer: 1024 * 1024, env: { ...process.env, PGPASSWORD: password } },
        (error, stdout, stderr) => {
          if (error) {
            const detail = String(stderr || error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, '[database-url]');
            return reject(new InternalServerErrorException(detail));
          }
          resolve(stdout || '');
        },
      );
    });
  }

  private runPowerShell(scriptPath: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'powershell',
        ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) return reject(new InternalServerErrorException(stderr || error.message));
          resolve(stdout || '');
        },
      );
    });
  }

  getConfig() {
    return {
      defaultBackupDir: this.resolveBackupDir(),
      autoBackupEnabled: this.autoBackupEnabled,
      autoBackupIntervalHours: this.autoBackupIntervalHours,
    };
  }

  async backup(outputDir?: string, auto = false) {
    const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!databaseUrl) throw new InternalServerErrorException('Falta configurar DATABASE_URL');
    const dir = this.resolveBackupDir(outputDir);
    this.ensureBackupDir(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(dir, `database-${stamp}.dump`);
    const command = process.env.PG_DUMP_PATH || 'pg_dump';
    const output = await this.runPostgresTool(command, [
      '--format=custom', '--no-owner', '--no-acl', `--file=${backupPath}`, `--dbname=${databaseUrl}`,
    ], databaseUrl);
    return { ok: true, output, path: backupPath, auto };
  }

  async restore(backupPath: string) {
    if (!backupPath || !backupPath.trim() || !existsSync(backupPath) || !statSync(backupPath).isFile()) {
      throw new InternalServerErrorException('Debe indicar la ruta de un archivo de respaldo existente');
    }
    const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!databaseUrl) throw new InternalServerErrorException('Falta configurar DATABASE_URL');
    const command = process.env.PG_RESTORE_PATH || 'pg_restore';
    const output = await this.runPostgresTool(command, [
      '--clean', '--if-exists', '--no-owner', '--no-acl', `--dbname=${databaseUrl}`, backupPath.trim(),
    ], databaseUrl);
    return { ok: true, output, path: backupPath };
  }

  async reset() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('El reinicio destructivo está deshabilitado en producción');
    }
    const root = this.getRepoRoot();
    const script = join(root, 'scripts', 'db-reset.ps1');
    const output = await this.runPowerShell(script, ['-Force']);
    return { ok: true, output };
  }
}
