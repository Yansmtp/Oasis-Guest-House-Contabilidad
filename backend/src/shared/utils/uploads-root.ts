import * as fs from 'fs';
import { isAbsolute, resolve } from 'path';

function getBackendBaseDir(): string {
  const cwd = process.cwd().replace(/\\/g, '/').toLowerCase();
  return cwd.endsWith('/backend') ? process.cwd() : resolve(process.cwd(), 'backend');
}

export function resolveUploadsRoot(configuredPath?: string): string {
  const raw = (configuredPath || process.env.UPLOAD_PATH || './uploads').trim();
  let preferred: string;

  if (isAbsolute(raw)) {
    preferred = raw;
  } else {
    preferred = resolve(getBackendBaseDir(), raw.replace(/^\.?\//, ''));
  }

  const legacy = resolve(process.cwd(), 'uploads');
  const chosen = fs.existsSync(preferred) ? preferred : (fs.existsSync(legacy) ? legacy : preferred);
  fs.mkdirSync(chosen, { recursive: true });
  return chosen;
}
