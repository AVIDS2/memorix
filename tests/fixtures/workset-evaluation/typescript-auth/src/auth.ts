export function validateToken(token: string): boolean {
  return token.length >= 24;
}

export function requireAuthenticatedUser(token: string): boolean {
  return validateToken(token);
}
