FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl postgresql-client

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Prisma needs a schema URL during client generation; these build-only placeholders are not runtime defaults.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build DIRECT_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build

ENV PORT=3000
ENV NODE_ENV=production
ENV UPLOAD_PATH=/app/uploads
EXPOSE 3000

CMD ["sh", "-c", "if [ -z \"$DIRECT_URL\" ]; then echo 'DIRECT_URL is required for Prisma migrations' >&2; exit 1; fi; DATABASE_URL=\"$DIRECT_URL\" npx prisma migrate deploy && node dist/main"]
