import pino from 'pino';
import env from '../constants/env.js';

// Guide §7.3 minta "singleton proxy ke Fastify logger" supaya lib lain
// (repository, dsb, yang tidak menerima `request`) tetap bisa logging
// dengan konfigurasi (level, redaksi) yang sama dengan instance Fastify.
// Di sini disederhanakan: satu instance pino berdiri sendiri dengan
// konfigurasi identik ke yang dipasang di Fastify (lihat index.ts),
// supaya tidak perlu wiring proxy tambahan untuk kebutuhan saat ini.
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
});
