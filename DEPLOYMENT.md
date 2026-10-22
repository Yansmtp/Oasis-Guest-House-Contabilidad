# Despliegue: Vercel + Render + Neon

## 1. Base de datos Neon

1. Crea un proyecto y una base de datos PostgreSQL en Neon. Elige una región cercana a tu servicio de Render.
2. En **Connect**, copia las dos cadenas de conexión. Usa la variante **pooled** para `DATABASE_URL` y la conexión **directa (sin pooler)** para `DIRECT_URL`. Ambas deben usar SSL (`sslmode=require`). Prisma Migrate necesita la conexión directa; la aplicación puede usar la agrupada.
3. Guarda las cadenas en Render, nunca en el repositorio ni en Vercel. No pegues las contraseñas en el chat.

## 2. Backend en Render

1. Crea un **Web Service** conectado al repositorio. Runtime: **Docker**. Configura **Root Directory** como `backend` y Dockerfile como `Dockerfile`.
2. En **Environment**, añade:

   - `DATABASE_URL`: cadena pooled de Neon.
   - `DIRECT_URL`: cadena directa de Neon.
   - `JWT_SECRET`: secreto aleatorio de al menos 32 caracteres.
   - `JWT_EXPIRATION`: `24h`.
   - `NODE_ENV`: `production`.
   - `FRONTEND_URL`: origen exacto del frontend en Vercel, por ejemplo `https://oasis-frontend.vercel.app` (sin barra final). Separa los orígenes con comas si necesitas permitir más de uno.
   - `UPLOAD_PATH`: `/app/uploads`.
   - `MAINTENANCE_BACKUP_DIR`: `/app/uploads/backups`.
   - `MAINTENANCE_AUTO_BACKUP`: `false`.

   Render define `PORT`; no añadas un valor fijo.
3. Configura el **Health Check Path** como `/api/health`.
4. Añade un Persistent Disk montado en `/app/uploads`. El sistema de archivos de Render es efímero por defecto; el disco persistente está disponible en servicios de pago. Si no quieres usar un disco, los logos deben migrarse a almacenamiento de objetos externo.
5. Despliega. El contenedor ejecutará `prisma migrate deploy` usando `DIRECT_URL` antes de arrancar la API. La primera vez puede tardar mientras Neon activa el compute.

Para generar un secreto localmente en PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## 3. Crear el primer administrador

Cuando el backend esté activo y las migraciones hayan terminado, abre **Shell** del servicio en Render y ejecuta con credenciales propias:

```sh
export ADMIN_EMAIL='tu-correo'
export ADMIN_PASSWORD='una-clave-larga-y-unica-de-12-caracteres-o-mas'
npm run admin:create
unset ADMIN_EMAIL ADMIN_PASSWORD
```

El comando crea o actualiza ese usuario como administrador. El script anterior que usaba credenciales fijas se retiró.

## 4. Conectar el frontend de Vercel

1. En el proyecto Vercel, confirma que **Root Directory** sea `frontend` y que el framework esté en **Other**.
2. En **Settings → Environment Variables**, añade `VITE_API_BASE_URL` con la URL pública de Render, por ejemplo `https://oasis-backend.onrender.com` (sin `/api`). Actívala para Production y Preview si también usarás las vistas previas.
3. Redeploya el frontend. El build crea `js/config.js` con esa URL y añade `/api` automáticamente.
4. Comprueba `https://TU-BACKEND.onrender.com/api/health`; debe responder `{"status":"ok"}`. Después inicia sesión en Vercel.

Si usas un dominio personalizado en Vercel, actualiza `FRONTEND_URL` en Render con ese origen y vuelve a desplegar el backend para aplicar CORS. Los dominios de Preview también deben agregarse explícitamente a `FRONTEND_URL`, o puedes configurar un dominio de pruebas estable.

## 5. Uso local

En `backend/.env`, configura `DATABASE_URL` y `DIRECT_URL` (pueden ser iguales para PostgreSQL local), un `JWT_SECRET`, `PORT=3000`, `FRONTEND_URL=http://localhost:8080` y `UPLOAD_PATH=./uploads`. El script de migración usa `DIRECT_URL` automáticamente, así que en Neon puede apuntar `DATABASE_URL` al pooler y `DIRECT_URL` a la conexión directa. Luego, desde `backend`:

```powershell
npm ci
npx prisma generate
npm run prisma:migrate
npm run start:dev
```

Para previsualizar el frontend local puedes servir `frontend` con un servidor estático. En Vercel, `VITE_API_BASE_URL` es obligatoria para evitar publicar una página que llame a `localhost`.

## Respaldo y persistencia

Los números de factura ahora se asignan en Neon dentro de una operación atómica, por lo que sobreviven reinicios y varias instancias. Los logos y los respaldos manuales usan el disco persistente de Render. El respaldo automático local está desactivado por defecto; configura los respaldos y la recuperación desde Neon según el plan de tu base de datos.
