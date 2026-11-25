let sessionTokenCache: string | null = null;

export function setAegisSessionToken(token: string | null): void {
  sessionTokenCache = token;
}

export function getAegisSessionToken(): string | null {
  return sessionTokenCache;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (sessionTokenCache) {
    headers.set('X-Aegis-Session', sessionTokenCache);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  });
}
