import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Administrador';
  if (!email || !password || password.length < 12) {
    throw new Error('Define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres) para crear el administrador.');
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, password: hashedPassword, role: 'ADMIN' },
    update: { name, password: hashedPassword, role: 'ADMIN' },
    select: { id: true, email: true, role: true },
  });
  console.log(`Administrador listo: ${user.email} (${user.role})`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Error al crear administrador');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
