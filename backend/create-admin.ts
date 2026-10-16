import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@local.com';
  const password = 'admin123';

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  const hashedPassword = await bcrypt.hash(password, 10);
  let user = existingUser;

  if (existingUser) {
    user = await prisma.user.update({
      where: { email },
      data: {
        name: existingUser.name || 'Administrador',
        password: hashedPassword,
        role: existingUser.role || 'ADMIN',
      },
    });
    console.log('[admin] existing user, password reset');
  } else {
    user = await prisma.user.create({
      data: {
        email,
        name: 'Administrador',
        password: hashedPassword,
        role: 'ADMIN',
      },
    });
    console.log('[admin] user created');
  }

  console.log({
    id: user.id,
    email: user.email,
    role: user.role,
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
