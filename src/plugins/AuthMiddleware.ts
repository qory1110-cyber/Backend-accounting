import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../libs/jwt.js';
import { sendError } from '../libs/reply.js';
import { findMembership } from '../repositories/BusinessRepository.js';

export interface RequestUser {
  id: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: RequestUser | null;
    // Diisi oleh requireBusinessScope setelah lolos — role user PADA BISNIS
    // yang sedang diakses (bisa beda-beda tiap bisnis, lihat §2.5 LAPORAN_FASE_1_2).
    businessRole?: 'admin' | 'accountant' | 'viewer';
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: Array<'admin' | 'accountant' | 'viewer'>
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireBusinessScope: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Sesuai §7.2: request.user diisi (nullable) untuk SEMUA request lewat
// preHandler global, terlepas apakah route-nya butuh login atau tidak —
// supaya route publik tetap bisa cek "kalau ada user yang login, tampilkan X".
// Error decode token DITELAN di sini (bukan langsung 401) supaya route
// publik tidak ikut gagal karena token basi terkirim tanpa sengaja.
export default fp(async (fastify: FastifyInstance) => {
  fastify.decorateRequest('user', null);

  fastify.addHook('preHandler', async (request) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      request.user = null;
      return;
    }

    try {
      const payload = verifyAccessToken(authHeader.slice('Bearer '.length));
      request.user = { id: payload.sub };
    } catch {
      request.user = null;
    }
  });

  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return sendError(reply, 401, 'Unauthorized', 'Silakan login terlebih dahulu');
    }
  });

  // Penegakan multi-tenant (§2.4 LAPORAN_FASE_1_2 / §6.3 dokumen analisis).
  // WAJIB dipasang SETELAH requireAuth di preHandler array setiap route yang
  // punya :businessId. Query findMembership yang jadi jantung isolasinya
  // (lihat BusinessRepository.ts) — ini cuma "gerbang" di lapisan HTTP.
  fastify.decorate(
    'requireBusinessScope',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { businessId } = request.params as { businessId?: string };
      if (!request.user || !businessId) {
        return sendError(reply, 401, 'Unauthorized', 'Silakan login terlebih dahulu');
      }

      const membership = await findMembership(request.user.id, businessId);

      // 404, BUKAN 403 — baik bisnis tidak ada maupun user bukan anggotanya,
      // supaya ID bisnis milik orang lain tidak bisa dienumerasi dari
      // perbedaan kode status (keputusan desain §2.4 LAPORAN_FASE_1_2_Backend.docx).
      if (!membership) {
        return sendError(reply, 404, 'NotFound', 'Bisnis tidak ditemukan');
      }

      request.businessRole = membership.role;
    },
  );

  fastify.decorate('requireRole', (...roles: Array<'admin' | 'accountant' | 'viewer'>) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.businessRole || !roles.includes(request.businessRole)) {
        return sendError(reply, 403, 'Forbidden', 'Role kamu tidak punya izin untuk aksi ini');
      }
    };
  });
});
