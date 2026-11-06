import { NextFunction, Request, Response } from "express";
import { forbidden } from "../utils/httpError";
import { AuthenticatedUser } from "./auth";

type Role = AuthenticatedUser["role"];

// Perfis que só leem, em qualquer módulo. DIRETORIA acompanha o grupo inteiro e
// CONSULTA acompanha o que lhe cabe, mas nenhum dos dois escreve.
const SOMENTE_LEITURA: Role[] = ["DIRETORIA", "CONSULTA"];

export function blockReadOnlyWrites(req: Request, _res: Response, next: NextFunction) {
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  if (isWrite && req.user && SOMENTE_LEITURA.includes(req.user.role)) {
    return next(forbidden("Seu perfil tem acesso apenas de consulta."));
  }
  next();
}

// Restringe escrita (POST/PUT/PATCH/DELETE) a um conjunto de perfis. ADMIN sempre tem acesso total.
// Leitura (GET) é permitida para qualquer perfil autenticado da organização.
export function requireWriteRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const isWrite = req.method !== "GET" && req.method !== "HEAD";
    if (!isWrite) return next();
    if (!req.user) return next(forbidden());
    // Trava de segurança: um perfil só de leitura não escreve nem que seja listado
    // por engano na chamada de alguma rota.
    if (SOMENTE_LEITURA.includes(req.user.role)) {
      return next(forbidden("Seu perfil tem acesso apenas de consulta."));
    }
    if (req.user.role === "ADMIN" || roles.includes(req.user.role)) return next();
    return next(forbidden());
  };
}

// Restringe a rota inteira (leitura e escrita) a perfis específicos. ADMIN sempre tem acesso.
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(forbidden());
    if (req.user.role === "ADMIN" || roles.includes(req.user.role)) return next();
    return next(forbidden());
  };
}
