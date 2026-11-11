const API_URL = String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'itam_token';
const USER_KEY = 'itam_user';

export type AuthUser = {
  id: number;
  company_id: number;
  staff_id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  can_decrypt_vault: boolean;
};

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  // FormData must set its own multipart boundary — do not force JSON
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (options.body && !headers['Content-Type'] && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const json = await res.json().catch(() => ({}));
  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
  }
  return json as T;
}

/** Authenticated file download (e.g. SQL backups). */
export async function downloadAuthenticated(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: '*/*' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const fileName = match?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const data = await api<{ token: string; user: AuthUser }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(data.token, data.user);
  return data;
}

export type RegisterPayload = {
  name: string;
  email: string;
  password: string;
};

export async function register(payload: RegisterPayload): Promise<{ token: string; user: AuthUser }> {
  const data = await api<{ token: string; user: AuthUser }>('/api/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setSession(data.token, data.user);
  return data;
}

export async function fetchPublicCompanies(): Promise<{ id: number; code: string; name: string; short_name: string }[]> {
  const res = await fetch(`${API_URL}/api/public/companies`, { headers: { Accept: 'application/json' } });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to load companies');
  return json.data ?? [];
}

export async function logout(): Promise<void> {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  clearSession();
}

export { API_URL };
