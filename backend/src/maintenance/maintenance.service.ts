import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join } from 'path';

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private autoBackupTimer: NodeJS.Timeout | null = null;
  private autoBackupEnabled = true;
  private autoBackupIntervalHours = 24;

  private getRepoRoot() {
    // dist/src/maintenance -> dist/src -> dist -> backend -> repo root
    return join(__dirname, '..', '..', '..', '..');
  }

  private getDefaultBackupDir() {
    return process.env.MAINTENANCE_BACKUP_DIR || join(homedir(), 'InventoryBackups');
  }

  private ensureBackupDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private resolveBackupDir(dir?: string) {
    const root = this.getRepoRoot();
    const target = (dir || '').trim() || this.getDefaultBackupDir();
    return isAbsolute(target) ? target : join(root, target);
  }

  async onModuleInit() {
    this.autoBackupEnabled = String(process.env.MAINTENANCE_AUTO_BACKUP ?? 'true').toLowerCase() !== 'false';
    const parsedHours = Number(process.env.MAINTENANCE_AUTO_BACKUP_HOURS ?? '24');
    this.autoBackupIntervalHours = Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 24;

    const backupDir = this.resolveBackupDir();
    this.ensureBackupDir(backupDir);

    if (!this.autoBackupEnabled) return;

    const intervalMs = this.autoBackupIntervalHours * 60 * 60 * 1000;
    setTimeout(() => this.runAutoBackup(), 10000);
    this.autoBackupTimer = setInterval(() => this.runAutoBackup(), intervalMs);
  }

  onModuleDestroy() {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
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

  private runPowerShell(scriptPath: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'powershell',
        ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
        { windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            return reject(new InternalServerErrorException(stderr || error.message));
          }
          resolve(stdout || '');
        },
      );
    });
  }

  private extractPathFromOutput(output: string, marker: string) {
    const lines = String(output || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const found = lines.find((l) => l.toLowerCase().includes(marker.toLowerCase()));
    if (!found) return null;
    const parts = found.split(':');
    return parts.length > 1 ? parts.slice(1).join(':').trim() : null;
  }

  getConfig() {
    return {
      defaultBackupDir: this.resolveBackupDir(),
      autoBackupEnabled: this.autoBackupEnabled,
      autoBackupIntervalHours: this.autoBackupIntervalHours,
    };
  }

  async backup(outputDir?: string, auto = false) {
    const root = this.getRepoRoot();
    const script = join(root, 'scripts', 'db-backup.ps1');
    const dir = this.resolveBackupDir(outputDir);
    this.ensureBackupDir(dir);
    const output = await this.runPowerShell(script, ['-OutputDir', dir]);
    const path = this.extractPathFromOutput(output, 'Backup completado en');
    return { ok: true, output, path, auto };
  }

  async restore(backupDir: string) {
    if (!backupDir || !backupDir.trim()) {
      throw new InternalServerErrorException('Debe indicar la carpeta del respaldo a restaurar');
    }
    const root = this.getRepoRoot();
    const script = join(root, 'scripts', 'db-restore.ps1');
    const output = await this.runPowerShell(script, ['-BackupDir', backupDir.trim()]);
    const path = this.extractPathFromOutput(output, 'Restaur');
    return { ok: true, output, path };
  }

  async reset() {
    const root = this.getRepoRoot();
    const script = join(root, 'scripts', 'db-reset.ps1');
    const output = await this.runPowerShell(script, ['-Force']);
    return { ok: true, output };
  }
}
