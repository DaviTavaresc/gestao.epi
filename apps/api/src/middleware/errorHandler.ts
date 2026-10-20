import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/httpError";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ message: `Rota não encontrada: ${req.method} ${req.path}` });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ message: "Dados inválidos.", errors: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, details: err.details });
  }

  console.error(err);
  return res.status(500).json({ message: "Erro interno do servidor." });
}
