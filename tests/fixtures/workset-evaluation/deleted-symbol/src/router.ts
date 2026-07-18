export function routeRequest(path: string): string {
  return path === '/health' ? 'ok' : 'not-found';
}
