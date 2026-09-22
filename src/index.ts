import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import env from './constants/env.js';
import { logger } from './libs/logger.js';
import { sendError } from './libs/reply.js';
import { runMigrations, closePool } from './db/index.js';
import authMiddlewarePlugin from './plugins/AuthMiddleware.js';
import healthPlugin from './plugins/HealthPlugin.js';
import { authRoutesPlugin } from './plugins/AuthRoutes.js';
import { userRoutesPlugin } from './plugins/UserRoutes.js';
import { businessRoutesPlugin } from './plugins/BusinessRoutes.js';
import { chartOfAccountRoutesPlugin } from './plugins/ChartOfAccountRoutes.js';
import { customerRoutesPlugin } from './plugins/CustomerRoutes.js';

async function main() {
  const app = Fastify({ loggerInstance: logger }).withTypeProvider<ZodTypeProvider>();

  // --- Urutan di bawah ini FIXED, jangan diubah tanpa alasan kuat (§7.1) ---

  app.setValidatorCompiler(validatorCompiler); // Zod
  app.setSerializerCompiler(serializerCompiler); // Zod

  // 1. Error handler global
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');

    // Error validasi Zod dari fastify-type-provider-zod sudah punya statusCode 400.
    const statusCode = error.statusCode ?? 500;
    const message = statusCode < 500 ? error.message : 'Terjadi kesalahan pada server';

    return sendError(reply, statusCode, statusCode < 500 ? 'BadRequest' : 'InternalServerError', message);
  });

  // 2. CORS
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? env.CORS_ORIGIN.split(',') : true,
  });

  // 3. Rate limit
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW_MS,
    allowList: env.RATE_LIMIT_ALLOW_LIST,
    keyGenerator: (req) => req.ip,
  });

  // 4. Security headers
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  // 5. Auth middleware (request.user + requireAuth/requireRole/requireBusinessScope)
  await app.register(authMiddlewarePlugin);

  // 6. (WebSocket dilewati - belum ada kebutuhan)

  // 7. Health check
  await app.register(healthPlugin);

  // 8. Swagger (tugas #6: Kerangka OpenAPI otomatis dari kode) — SEBELUM
  // route bisnis, supaya semua route yang didaftarkan setelah ini otomatis
  // terdiscover ke dalam dokumen OpenAPI.
  if (env.ENABLE_SWAGGER) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Accounting Backend API',
          description:
            'Clone Manager.io. OpenAPI di-generate otomatis dari skema Zod yang sama dipakai untuk validasi (lihat src/schemas/).',
          version: '1.0.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUI, { routePrefix: '/documentation' });
  }

  // 9. Route domain, satu per satu, dengan prefix versi
  await app.register(
    async (instance) => {
      instance.register(authRoutesPlugin, { prefix: '/auth' });
      instance.register(userRoutesPlugin, { prefix: '/users' });
      instance.register(businessRoutesPlugin, { prefix: '/businesses' });
      instance.register(chartOfAccountRoutesPlugin, { prefix: '/businesses' });
      instance.register(customerRoutesPlugin, { prefix: '/businesses' });
    },
    { prefix: '/api/v1' },
  );

  // --- Migrasi sebelum listen, supaya container baru selalu selaras ---
  await runMigrations();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Server jalan di http://localhost:${env.PORT}/api/v1`);
  if (env.ENABLE_SWAGGER) {
    app.log.info(`Dokumentasi API di http://localhost:${env.PORT}/documentation`);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Menerima ${signal}, mematikan server dengan aman...`);
    await app.close().catch(() => undefined);
    await closePool().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
