/**
 * Auth state for the web app.
 * With Google SSO, credentials are managed via HTTP-only session cookies.
 * The SPA only needs to know whether the user is logged in and who they are.
 */

export interface UserInfo {
  email: string;
}

export async function checkAuth(): Promise<UserInfo | null> {
  try {
    const res = await fetch('/auth/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as UserInfo;
  } catch {
    return null;
  }
}

export function logout(): void {
  window.location.href = '/auth/logout';
}
