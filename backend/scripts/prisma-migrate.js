const { execFileSync } = require('node:child_process');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const directUrl = process.env.DIRECT_URL;
const databaseUrl = directUrl || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL (and preferably DIRECT_URL) before running Prisma migrations.');

const prismaCli = require.resolve('prisma/build/index.js');
const args = process.argv.slice(2);
if (args.length === 0) args.push('dev');
execFileSync(process.execPath, [prismaCli, 'migrate', ...args], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: databaseUrl },
  cwd: path.resolve(__dirname, '..'),
});
