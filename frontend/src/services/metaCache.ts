/** Cached org metadata — one API call, persisted across navigations. */
import { api } from './client';

export type MetaCompany = { id: number; code: string; short_name: string; name: string };
export type MetaLocation = { id: number; company_id: number; code?: string; name: string };
export type MetaDepartment = { id: number; company_id: number; code?: string; name: string; location_id?: number | null };

type OrgMeta = {
  companies: MetaCompany[];
  locations: MetaLocation[];
  departments: MetaDepartment[];
};

const STORAGE_KEY = 'itam_org_meta_v7';
const TTL_MS = 10 * 60 * 1000;

let cache: OrgMeta | null = null;
let inflight: Promise<OrgMeta> | null = null;

function readStorage(): OrgMeta | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: OrgMeta };
    if (!parsed?.data || Date.now() - parsed.at > TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeStorage(data: OrgMeta): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* ignore quota */
  }
}

export async function getOrgMeta(force = false): Promise<OrgMeta> {
  if (!force && cache) {
    return cache;
  }
  if (!force) {
    const stored = readStorage();
    if (stored) {
      cache = stored;
      return stored;
    }
  }
  // Always coalesce in-flight requests (even when force=true)
  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const org = await api<{
        companies?: MetaCompany[];
        locations?: MetaLocation[];
        departments?: MetaDepartment[];
        data?: OrgMeta;
      }>('/api/org');
      const next: OrgMeta = {
        companies: org.companies ?? org.data?.companies ?? [],
        locations: org.locations ?? org.data?.locations ?? [],
        departments: org.departments ?? org.data?.departments ?? [],
      };
      cache = next;
      writeStorage(next);
      return next;
    } catch {
      // Fallback to legacy 3-call shape if /api/org unavailable
      const [c, locs, deps] = await Promise.all([
        api<{ data: MetaCompany[] }>('/api/companies'),
        api<{ data: MetaLocation[] }>('/api/locations'),
        api<{ data: MetaDepartment[] }>('/api/departments'),
      ]);
      const next: OrgMeta = {
        companies: c.data ?? [],
        locations: locs.data ?? [],
        departments: deps.data ?? [],
      };
      cache = next;
      writeStorage(next);
      return next;
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function clearOrgMetaCache(): void {
  cache = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
