export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Não autenticado.") => new HttpError(401, message);
export const forbidden = (message = "Você não tem permissão para realizar esta ação.") => new HttpError(403, message);
export const notFound = (message = "Registro não encontrado.") => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);
