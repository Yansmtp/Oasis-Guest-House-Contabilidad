# 1. Base image
FROM node:20-alpine

# 2. Directorio de trabajo
WORKDIR /app

# 3. Instalar dependencias de sistema para Prisma (OpenSSL)
RUN apk add --no-cache openssl

# 4. Copiar archivos de dependencias
COPY package.json package-lock.json ./

# 5. Instalar dependencias de producción
RUN npm ci --omit=dev

# 6. Copiar código fuente y Prisma schema
COPY . .

# 7. Generar Prisma Client
RUN npx prisma generate

# 8. Construir la aplicación NestJS
RUN npm run build

# 9. Puerto expuesto (Render inyecta PORT, por defecto 3000)
ENV PORT=3000
ENV NODE_ENV=production

# 10. Ejecutar migraciones de Prisma al iniciar y luego iniciar la app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]