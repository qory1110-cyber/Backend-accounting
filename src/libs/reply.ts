import type { FastifyReply } from 'fastify';

export function sendError(res: FastifyReply, status: number, error: string, message: string) {
  return res.code(status).send({ error, message });
}

export function sendData<T>(res: FastifyReply, data: T, status = 200) {
  return res.code(status).send({ data });
}

export function sendPaginated<T>(
  res: FastifyReply,
  data: T[],
  total: number,
  page: number,
  pageSize: number,
) {
  return res.send({
    data,
    pagination: {
      total,
      currentPage: page,
      totalPages: Math.ceil(total / pageSize) || 1,
      pageSize,
    },
  });
}
