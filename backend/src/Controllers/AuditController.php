<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use PDO;

final class AuditController
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** GET /api/audit-logs — system audit (logins, role changes, etc.) */
    public function systemLogs(Request $request, array $user): void
    {
        if (! $this->isAdmin($user)) {
            Response::error('Only IT admins can view audit logs', 403);
            return;
        }

        $action = trim((string) $request->input('action', ''));
        $limit = min(500, max(1, (int) $request->input('limit', 200)));

        $sql = 'SELECT a.id, a.action, a.details, a.ip_address, a.user_agent, a.created_at,
                       a.actor_user_id, actor.name AS actor_name, actor.email AS actor_email, actor.role AS actor_role,
                       a.target_user_id, target.name AS target_name, target.email AS target_email, target.role AS target_role
                FROM system_audit_logs a
                LEFT JOIN users actor ON actor.id = a.actor_user_id
                LEFT JOIN users target ON target.id = a.target_user_id
                WHERE 1=1';
        $params = [];

        if ($action !== '') {
            if ($action === 'auth') {
                $sql .= " AND a.action IN ('login', 'logout', 'register', 'login_failed')";
            } elseif ($action === 'access') {
                $sql .= " AND a.action IN ('user_create', 'user_role_change', 'user_activate', 'user_deactivate', 'user_update')";
            } else {
                $sql .= ' AND a.action = :action';
                $params['action'] = $action;
            }
        }

        $sql .= ' ORDER BY a.created_at DESC LIMIT ' . $limit;

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
        } catch (\Throwable $e) {
            Response::error('Audit log table missing — run migrations/create_system_audit_logs.sql', 500);
            return;
        }

        foreach ($rows as &$row) {
            if (isset($row['details']) && is_string($row['details'])) {
                $decoded = json_decode($row['details'], true);
                $row['details'] = is_array($decoded) ? $decoded : null;
            }
        }
        unset($row);

        Response::json(['data' => $rows]);
    }

    /** GET /api/audit-logs/sessions — active login sessions */
    public function sessions(Request $request, array $user): void
    {
        if (! $this->isAdmin($user)) {
            Response::error('Only IT admins can view sessions', 403);
            return;
        }

        $sql = 'SELECT t.id, t.user_id, t.label, t.created_at, t.last_used_at, t.expires_at,
                       u.name AS user_name, u.email AS user_email, u.role AS user_role,
                       c.short_name AS company_short
                FROM api_access_tokens t
                JOIN users u ON u.id = t.user_id
                LEFT JOIN companies c ON c.id = u.company_id
                WHERE (t.expires_at IS NULL OR t.expires_at > NOW())
                ORDER BY COALESCE(t.last_used_at, t.created_at) DESC
                LIMIT 300';

        $stmt = $this->pdo->query($sql);
        Response::json(['data' => $stmt ? $stmt->fetchAll() : []]);
    }

    /** GET /api/credentials/access-logs — vault access only */
    public function credentialAccessLogs(Request $request, array $user): void
    {
        if (! $this->isAdmin($user)) {
            Response::error('Only IT admins can view credential access logs', 403);
            return;
        }

        $limit = min(500, max(1, (int) $request->input('limit', 200)));
        $sql = 'SELECT l.id, l.credential_id, l.action, l.ip_address, l.user_agent, l.created_at,
                       u.name AS user_name, u.email AS user_email, u.role AS user_role,
                       c.system_name, c.username, c.credential_type, c.company_id,
                       co.short_name AS company_short
                FROM credential_access_logs l
                JOIN credentials c ON c.id = l.credential_id
                LEFT JOIN users u ON u.id = l.accessed_by
                LEFT JOIN companies co ON co.id = c.company_id
                WHERE 1=1';
        $params = [];

        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND c.company_id = :company_id';
            $params['company_id'] = $user['company_id'];
        }

        $sql .= ' ORDER BY l.created_at DESC LIMIT ' . $limit;

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        Response::json(['data' => $stmt->fetchAll()]);
    }

    /** @param array<string, mixed> $user */
    private function isAdmin(array $user): bool
    {
        return in_array($user['role'] ?? '', ['super_admin', 'it_admin'], true);
    }
}
