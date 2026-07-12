import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';

const SALT_ROUNDS = 10;

function getSecret(): string {
  return process.env.JWT_SECRET || 'dev-secret';
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function generateToken(
  payload: object,
  expiresIn: SignOptions['expiresIn'] = '1h'
): string {
  return jwt.sign(payload, getSecret(), { expiresIn });
}

export function verifyToken(token: string): string | jwt.JwtPayload {
  return jwt.verify(token, getSecret());
}
