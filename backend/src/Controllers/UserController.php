<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Services\SystemAuditService;
use Indra\Itam\Support\Auth;
use PDO;

final class UserController
{
    private readonly SystemAuditService $audit;

    public function __construct(private readonly PDO $pdo)
    {
        $this->audit = new SystemAuditService($pdo);
    }

    public function index(Request $request, array $user): void
    {
        $sql = 'SELECT u.id, u.uuid, u.company_id, u.staff_id, u.name, u.email, u.phone,
                       u.role, u.can_decrypt_vault, u.is_active, u.last_login_at,
                       u.department_id, u.location_id,
                       c.short_name AS company_short, d.name AS department_name
                FROM users u
                JOIN companies c ON c.id = u.company_id
                LEFT JOIN departments d ON d.id = u.department_id
                WHERE 1=1';
        $params = [];

        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND u.company_id = :company_id';
            $params['company_id'] = $user['company_id'];
        }

        $sql .= ' ORDER BY u.name ASC LIMIT 300';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        Response::json(['data' => $stmt->fetchAll()]);
    }

    public function store(Request $request, array $user): void
    {
        if (! in_array($user['role'] ?? '', ['super_admin', 'it_admin', 'it_staff'], true)) {
            Response::error('Not allowed to create users', 403);
            return;
        }

        $companyId = (int) $request->input('company_id', $user['company_id']);
        Auth::assertCompanyAccess($user, $companyId);

        $staffId = trim((string) $request->input('staff_id', ''));
        $name = trim((string) $request->input('name', ''));
        $email = strtolower(trim((string) $request->input('email', '')));
        $role = (string) $request->input('role', 'employee');
        $allowedRoles = ['super_admin', 'it_admin', 'it_staff', 'viewer', 'employee'];

        if ($staffId === '' || $name === '' || $email === '' || ! in_array($role, $allowedRoles, true)) {
            Response::error('staff_id, name, email, role required', 422);
            return;
        }

        if ($role === 'super_admin' && ($user['role'] ?? '') !== 'super_admin') {
            Response::error('Only super_admin can create super_admin', 403);
            return;
        }

        $sql = 'INSERT INTO users (
                    company_id, location_id, department_id, staff_id, name, email, phone,
                    password_hash, role, can_decrypt_vault, is_active
                ) VALUES (
                    :company_id, :location_id, :department_id, :staff_id, :name, :email, :phone,
                    :password_hash, :role, :can_decrypt_vault, TRUE
                ) RETURNING id, uuid, company_id, staff_id, name, email, role, can_decrypt_vault, is_active';

        $password = (string) $request->input('password', '');
        $passwordHash = $password !== '' ? password_hash($password, PASSWORD_BCRYPT) : null;

        $stmt = $this->pdo->prepare($sql);
        try {
            $stmt->execute([
                'company_id' => $companyId,
                'location_id' => $request->input('location_id') ?: null,
                'department_id' => $request->input('department_id') ?: null,
                'staff_id' => $staffId,
                'name' => $name,
                'email' => $email,
                'phone' => $request->input('phone') ?: null,
                'password_hash' => $passwordHash,
                'role' => $role,
                'can_decrypt_vault' => in_array($role, ['super_admin', 'it_admin'], true) ? 1 : 0,
            ]);
        } catch (\Throwable $e) {
            Response::error('Could not create user (duplicate email/staff?)', 422);
            return;
        }

        $created = $stmt->fetch();
        $this->audit->log(
            (int) $user['id'],
            'user_create',
            $request,
            (int) ($created['id'] ?? 0) ?: null,
            ['role' => $role, 'email' => $email, 'name' => $name]
        );

        Response::json(['data' => $created], 201);
    }

    /**
     * PUT /api/users/{id} — change role, active status, vault flag (admins).
     */
    public function update(Request $request, array $user, string $id): void
    {
        if (! in_array($user['role'] ?? '', ['super_admin', 'it_admin'], true)) {
            Response::error('Only IT admins can change user access', 403);
            return;
        }

        $targetId = (int) $id;
        if ($targetId < 1) {
            Response::error('Invalid user id', 422);
            return;
        }

        $stmt = $this->pdo->prepare(
            'SELECT id, company_id, name, email, role, can_decrypt_vault, is_active
             FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute(['id' => $targetId]);
        $target = $stmt->fetch();
        if (! $target) {
            Response::error('User not found', 404);
            return;
        }

        Auth::assertCompanyAccess($user, (int) $target['company_id']);

        if (($target['role'] ?? '') === 'super_admin' && ($user['role'] ?? '') !== 'super_admin') {
            Response::error('Only super_admin can modify a super_admin', 403);
            return;
        }

        $allowedRoles = ['super_admin', 'it_admin', 'it_staff', 'viewer', 'employee'];
        $newRole = $request->input('role');
        $newActive = $request->input('is_active');
        $newVault = $request->input('can_decrypt_vault');

        $role = $newRole !== null ? (string) $newRole : (string) $target['role'];
        if (! in_array($role, $allowedRoles, true)) {
            Response::error('Invalid role', 422);
            return;
        }
        if ($role === 'super_admin' && ($user['role'] ?? '') !== 'super_admin') {
            Response::error('Only super_admin can assign super_admin', 403);
            return;
        }

        // Prevent locking yourself out of the last active super_admin
        if ($targetId === (int) $user['id'] && $newActive !== null && ! self::isTruthy($newActive)) {
            Response::error('You cannot deactivate your own account', 422);
            return;
        }
        if ($targetId === (int) $user['id'] && $role !== 'super_admin' && ($user['role'] ?? '') === 'super_admin') {
            $other = (int) $this->pdo->query(
                "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND is_active = TRUE AND id <> " . (int) $user['id']
            )->fetchColumn();
            if ($other < 1) {
                Response::error('Cannot demote the only active super_admin', 422);
                return;
            }
        }

        $isActive = $newActive !== null ? self::isTruthy($newActive) : self::isTruthy($target['is_active']);
        if ($newVault !== null) {
            $canDecrypt = self::isTruthy($newVault);
        } else {
            $canDecrypt = in_array($role, ['super_admin', 'it_admin'], true)
                ? true
                : self::isTruthy($target['can_decrypt_vault']);
            if (in_array($role, ['super_admin', 'it_admin'], true)) {
                $canDecrypt = true;
            } elseif ($newRole !== null) {
                $canDecrypt = false;
            }
        }

        $upd = $this->pdo->prepare(
            'UPDATE users
             SET role = :role,
                 is_active = :is_active,
                 can_decrypt_vault = :can_decrypt_vault,
                 updated_at = NOW()
             WHERE id = :id
             RETURNING id, uuid, company_id, staff_id, name, email, phone, role, can_decrypt_vault, is_active, last_login_at'
        );
        $upd->execute([
            'role' => $role,
            'is_active' => $isActive ? 1 : 0,
            'can_decrypt_vault' => $canDecrypt ? 1 : 0,
            'id' => $targetId,
        ]);
        $updated = $upd->fetch();

        $oldRole = (string) $target['role'];
        $oldActive = self::isTruthy($target['is_active']);

        if ($oldRole !== $role) {
            $this->audit->log((int) $user['id'], 'user_role_change', $request, $targetId, [
                'from' => $oldRole,
                'to' => $role,
                'email' => $target['email'],
            ]);
        }
        if ($oldActive !== $isActive) {
            $this->audit->log(
                (int) $user['id'],
                $isActive ? 'user_activate' : 'user_deactivate',
                $request,
                $targetId,
                ['email' => $target['email'], 'role' => $role]
            );
        }
        if ($oldRole === $role && $oldActive === $isActive) {
            $this->audit->log((int) $user['id'], 'user_update', $request, $targetId, [
                'email' => $target['email'],
                'role' => $role,
                'can_decrypt_vault' => $canDecrypt,
            ]);
        }

        // Kill sessions when deactivated
        if (! $isActive) {
            $this->pdo->prepare('DELETE FROM api_access_tokens WHERE user_id = :id')
                ->execute(['id' => $targetId]);
        }

        Response::json(['data' => $updated, 'message' => 'User access updated']);
    }

    private static function isTruthy(mixed $v): bool
    {
        return $v === true || $v === 1 || $v === '1' || $v === 't' || $v === 'true';
    }
}
