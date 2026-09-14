import Fastify, { type FastifyError } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { sendError } from '../../libs/reply.js';
import authMiddlewarePlugin from '../../plugins/AuthMiddleware.js';
import healthPlugin from '../../plugins/HealthPlugin.js';
import { authRoutesPlugin } from '../../plugins/AuthRoutes.js';
import { userRoutesPlugin } from '../../plugins/UserRoutes.js';
import { businessRoutesPlugin } from '../../plugins/BusinessRoutes.js';

// Mirror index.ts (tanpa Swagger/listen/migrate) - lihat catatan pola di
// Backend-Boilerplate-Guide.pdf peta folder §3.1.
export async function buildApp() {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode < 500 ? error.message : 'Terjadi kesalahan pada server';
    return sendError(reply, statusCode, statusCode < 500 ? 'BadRequest' : 'InternalServerError', message);
  });

  await app.register(authMiddlewarePlugin);
  await app.register(healthPlugin);

  await app.register(
    async (instance) => {
      instance.register(authRoutesPlugin, { prefix: '/auth' });
      instance.register(userRoutesPlugin, { prefix: '/users' });
      instance.register(businessRoutesPlugin, { prefix: '/businesses' });
    },
    { prefix: '/api/v1' },
  );

  await app.ready();
  return app;
}
