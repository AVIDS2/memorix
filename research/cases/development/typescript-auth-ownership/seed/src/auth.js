export function validateToken(token) {
  return typeof token === 'string' && token.length >= 8;
}
