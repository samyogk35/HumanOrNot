
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../src/auth'; // Claude to implement

describe('Auth Unit Tests (Pure Logic)', () => {
  it('should hash a password and verify it correctly', async () => {
    const plain = 'supersecret';
    const hash = await hashPassword(plain);
    
    expect(hash).not.toBe(plain);
    expect(await verifyPassword(plain, hash)).toBe(true);
    expect(await verifyPassword('wrongpassword', hash)).toBe(false);
  });

  it('should generate and verify a JWT token', () => {
    const payload = { userId: 1, username: 'alice' };
    const token = generateToken(payload, '1h'); // Token valid for 1 hour
    
    expect(typeof token).toBe('string');
    
    const decoded = verifyToken(token) as any;
    expect(decoded.userId).toBe(1);
    expect(decoded.username).toBe('alice');
  });

  it('should reject an invalid or expired JWT token', () => {
    expect(() => verifyToken('invalid.token.string')).toThrow();
  });
});
