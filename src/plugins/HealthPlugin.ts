import fp from 'fastify-plugin';
import underPressure from '@fastify/under-pressure';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pool } from '../db/index.js';

// Catatan penting: @fastify/under-pressure punya endpoint /health bawaan
// sendiri (lewat exposeStatusRoute), TAPI skemanya JSON Schema biasa —
// bentrok dengan serializerCompiler Zod yang kita pasang global di index.ts
// ("schema.safeParse is not a function"). Solusinya: matikan route bawaan
// under-pressure (exposeStatusRoute: false), lalu tulis /health sendiri
// pakai Zod supaya konsisten dengan route lain. under-pressure sendiri
// tetap aktif untuk fungsi utamanya: menolak request (503) kalau
// event-loop/memori server kelebihan beban.
export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(underPressure, {
    exposeStatusRoute: false,
  });

  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/health', {
    schema: {
      tags: ['Health'],
      operationId: 'healthCheck',
      response: {
        200: z.object({ status: z.string(), uptime: z.number() }),
        503: z.object({ status: z.string(), error: z.string() }),
      },
    },
    handler: async (_req, reply) => {
      try {
        const client = await pool.connect();
        try {
          await Promise.race([
            client.query('SELECT 1'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 2000)),
          ]);
        } finally {
          client.release();
        }
        return reply.send({ status: 'ok', uptime: process.uptime() });
      } catch {
        return reply.code(503).send({ status: 'degraded', error: 'Database tidak bisa diakses' });
      }
    },
  });
});
