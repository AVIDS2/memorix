import { validateToken } from '../src/auth.js';

if (!validateToken('a'.repeat(24))) {
  throw new Error('Expected a 24-character token to be valid.');
}
