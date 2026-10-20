import jwt, { SignOptions } from "jsonwebtoken";
import { randomToken } from "./crypto";
import { env } from "../env";

export type AccessTokenPayload = {
  sub: string;
  organizationId: string;
  role: string;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = { expiresIn: env.jwtAccessExpiresIn as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwtAccessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

export function signRefreshToken(payload: { sub: string }): string {
  const options: SignOptions = { expiresIn: env.jwtRefreshExpiresIn as SignOptions["expiresIn"] };
  // jti aleatório garante um token único mesmo se emitido no mesmo segundo (mesmo iat) para o mesmo usuário,
  // evitando colisão no hash único armazenado em refresh_tokens.
  return jwt.sign({ ...payload, jti: randomToken(16) }, env.jwtRefreshSecret, options);
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { sub: string };
}
