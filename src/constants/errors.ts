// Kode error terpusat — dipakai konsisten lintas repository & route,
// supaya frontend bisa switch-case pada `error` tanpa parsing `message`.
export const ErrorCode = {
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'NotFound',
  BAD_REQUEST: 'BadRequest',
  CONFLICT: 'Conflict',
  INTERNAL: 'InternalServerError',
} as const;
