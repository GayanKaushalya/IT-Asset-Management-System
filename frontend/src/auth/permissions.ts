import type { AuthUser } from '../services/client';

export function roleOf(user: AuthUser | null | undefined): string {
  return String(user?.role ?? '');
}

export function isSuperAdmin(user: AuthUser | null | undefined): boolean {
  return roleOf(user) === 'super_admin';
}

export function isAudit(user: AuthUser | null | undefined): boolean {
  return roleOf(user) === 'audit';
}

/** Cross-company / all-tabs access (super_admin + audit). */
export function hasGlobalAccess(user: AuthUser | null | undefined): boolean {
  return roleOf(user) === 'super_admin' || roleOf(user) === 'audit';
}

/** Create / edit / delete (audit is view-only). */
export function canWrite(user: AuthUser | null | undefined): boolean {
  return !!user && !isAudit(user);
}

export function canManageAssets(user: AuthUser | null | undefined): boolean {
  return canWrite(user) && ['super_admin', 'it_admin', 'it_staff'].includes(roleOf(user));
}

export function canManageUsers(user: AuthUser | null | undefined): boolean {
  return canWrite(user) && (roleOf(user) === 'super_admin' || roleOf(user) === 'it_admin');
}

/** View backups panel (list/download). */
export function canViewBackups(user: AuthUser | null | undefined): boolean {
  return isSuperAdmin(user) || isAudit(user) || roleOf(user) === 'it_admin';
}

export function canCreateBackup(user: AuthUser | null | undefined): boolean {
  return canWrite(user) && (isSuperAdmin(user) || roleOf(user) === 'it_admin');
}

export function canDecryptVault(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.can_decrypt_vault) return true;
  return ['super_admin', 'it_admin', 'audit'].includes(roleOf(user));
}
