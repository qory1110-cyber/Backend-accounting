import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../helpers/app.js';

// Test ini butuh database jalan & sudah di-migrate (lihat README - jalankan
// `pnpm run migrations:run` dan `pnpm run seed` dulu sebelum `pnpm test`).
describe('Auth flow', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('menolak login dengan password salah', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.com', password: 'password-salah' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('berhasil login dengan kredensial seed yang benar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.com', password: 'Password123!' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.accessToken).toBeTypeOf('string');
    expect(body.data.refreshToken).toBeTypeOf('string');
  });

  it('menolak akses /users/me tanpa token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me' });
    expect(res.statusCode).toBe(401);
  });
});
