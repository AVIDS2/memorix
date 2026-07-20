import { validateToken } from './auth.js';

export function createSession(token) {
  if (!validateToken(token)) {
    throw new Error('invalid token');
  }
  return { token };
}
