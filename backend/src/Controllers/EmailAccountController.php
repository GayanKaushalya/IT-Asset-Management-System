<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Services\CredentialEncryptionService;
use Indra\Itam\Support\Auth;
use PDO;
use Throwable;

final class EmailAccountController
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly CredentialEncryptionService $vault,
    ) {
    }

    public function index(Request $request, array $user): void
    {
        $sql = 'SELECT u.id AS user_row_id,
                       u.user_name,
                       u.location_id,
                       u.email_account_id,
                       e.id AS email_id,
                       e.uuid AS email_uuid,
                       e.company_id,
                       e.email_address,
                       e.password_ciphertext,
                       e.is_active,
                       e.updated_at AS password_updated_at,
                       e.updated_by AS password_updated_by,
                       updater.name AS password_updated_by_name,
                       co.code AS company_code,
                       co.short_name AS company_short,
                       l.name AS location_name,
                       l.city AS location_city
                FROM email_account_users u
                JOIN email_accounts e ON e.id = u.email_account_id
                JOIN companies co ON co.id = e.company_id
                JOIN locations l ON l.id = u.location_id
                LEFT JOIN users updater ON updater.id = e.updated_by
                WHERE u.is_active = TRUE AND e.is_active = TRUE';
        $params = [];
        $companyCode = strtoupper(trim((string) $request->input('company_code', '')));
        $isOtherVault = $companyCode === 'OTHER';

        if ($isOtherVault) {
            // Shared external mailboxes — visible to all vault users
            $sql .= ' AND co.code = :company_code';
            $params['company_code'] = 'OTHER';
        } else {
            if (($user['role'] ?? '') !== 'super_admin') {
                $sql .= ' AND e.company_id = :company_id';
                $params['company_id'] = $user['company_id'];
            } elseif ($request->input('company_id')) {
                $sql .= ' AND e.company_id = :company_id';
                $params['company_id'] = (int) $request->input('company_id');
            }

            if ($companyCode !== '') {
                $sql .= ' AND co.code = :company_code';
                $params['company_code'] = $companyCode;
            }
        }

        $sql .= ' ORDER BY e.email_address ASC, u.user_name ASC';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        $pwCache = [];
        foreach ($rows as &$row) {
            $emailId = (int) ($row['email_id'] ?? 0);
            $cipher = (string) ($row['password_ciphertext'] ?? '');
            unset($row['password_ciphertext']);
            if (! array_key_exists($emailId, $pwCache)) {
                $has = false;
                if ($cipher !== '') {
                    try {
                        $has = $this->vault->decrypt($cipher) !== '';
                    } catch (Throwable) {
                        $has = true;
                    }
                }
                $pwCache[$emailId] = $has;
            }
            $row['has_password'] = $pwCache[$emailId];
        }
        unset($row);

        Response::json(['data' => $rows]);
    }

    public function store(Request $request, array $user): void
    {
        $companyId = (int) $request->input('company_id', 0);
        $emailAddress = strtolower(trim((string) $request->input('email_address', '')));
        $userName = trim((string) $request->input('user_name', ''));
        $locationId = (int) $request->input('location_id', 0);
        $password = (string) $request->input('password', '');

        if ($companyId < 1 || $emailAddress === '' || $locationId < 1) {
            Response::error('Invalid email payload', 422);
            return;
        }
        if (! filter_var($emailAddress, FILTER_VALIDATE_EMAIL)) {
            Response::error('Invalid email address', 422);
            return;
        }

        $this->assertEmailVaultAccess($user, $companyId);

        if (! $this->locationBelongsToCompany($locationId, $companyId)) {
            Response::error('Location does not belong to this company', 422);
            return;
        }

        // Include inactive rows — soft-deleted mailboxes must be reactivated, not re-inserted
        $existing = $this->findByEmail($companyId, $emailAddress, true);

        try {
            $this->pdo->beginTransaction();

            if ($existing !== null) {
                $emailId = (int) $existing['id'];
                $wasActive = $this->isTruthy($existing['is_active'] ?? false);

                if ($password !== '' && strlen($password) < 8) {
                    $this->pdo->rollBack();
                    Response::error('Password must be at least 8 characters', 422);
                    return;
                }

                // Reactivate soft-deleted mailbox and optionally update password
                if ($password !== '') {
                    $cipher = $this->vault->encrypt($password);
                    $upd = $this->pdo->prepare(
                        'UPDATE email_accounts
                         SET password_ciphertext = :cipher,
                             is_active = TRUE,
                             updated_by = :updated_by,
                             updated_at = NOW()
                         WHERE id = :id OR (company_id = :company_id AND lower(email_address) = :email)'
                    );
                    $upd->execute([
                        'cipher' => $cipher,
                        'updated_by' => $user['id'],
                        'id' => $emailId,
                        'company_id' => $companyId,
                        'email' => $emailAddress,
                    ]);
                } elseif (! $wasActive) {
                    $this->pdo->prepare(
                        'UPDATE email_accounts
                         SET is_active = TRUE, updated_by = :updated_by, updated_at = NOW()
                         WHERE id = :id'
                    )->execute([
                        'updated_by' => $user['id'],
                        'id' => $emailId,
                    ]);
                }

                // Bring back any soft-deleted user profiles for this mailbox
                if (! $wasActive) {
                    $this->pdo->prepare(
                        'UPDATE email_account_users
                         SET is_active = TRUE, updated_at = NOW()
                         WHERE email_account_id = :eid'
                    )->execute(['eid' => $emailId]);
                }
            } else {
                // Blank password allowed (stored encrypted empty string)
                if ($password !== '' && strlen($password) < 8) {
                    $this->pdo->rollBack();
                    Response::error('Password must be at least 8 characters when provided', 422);
                    return;
                }

                $sql = 'INSERT INTO email_accounts (
                            company_id, email_address, password_ciphertext, encryption_version,
                            created_by, updated_by
                        ) VALUES (
                            :company_id, :email_address, :password_ciphertext, 1,
                            :created_by, :updated_by
                        )';
                $isPgsql = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql';
                if ($isPgsql) {
                    $sql .= ' RETURNING id, uuid';
                }
                $stmt = $this->pdo->prepare($sql);
                $stmt->execute([
                    'company_id' => $companyId,
                    'email_address' => $emailAddress,
                    'password_ciphertext' => $this->vault->encrypt($password),
                    'created_by' => $user['id'],
                    'updated_by' => $user['id'],
                ]);
                if ($isPgsql) {
                    $row = $stmt->fetch() ?: [];
                    $emailId = (int) ($row['id'] ?? 0);
                } else {
                    $emailId = (int) $this->pdo->lastInsertId();
                }
            }

            // Prefer reactivating an inactive user row for the same name, else insert
            $userRowId = 0;
            $existingUser = $this->pdo->prepare(
                'SELECT id, is_active FROM email_account_users
                 WHERE email_account_id = :eid
                   AND lower(btrim(user_name)) = lower(btrim(:name))
                 ORDER BY id ASC LIMIT 1'
            );
            $existingUser->execute([
                'eid' => $emailId,
                'name' => $userName !== '' ? $userName : ' ',
            ]);
            $eu = $existingUser->fetch(PDO::FETCH_ASSOC);
            if ($eu && $userName !== '') {
                $userRowId = (int) $eu['id'];
                $this->pdo->prepare(
                    'UPDATE email_account_users
                     SET is_active = TRUE, location_id = :lid, user_name = :name, updated_at = NOW()
                     WHERE id = :id'
                )->execute([
                    'lid' => $locationId,
                    'name' => $userName,
                    'id' => $userRowId,
                ]);
            } else {
                $userSql = 'INSERT INTO email_account_users (
                                email_account_id, user_name, location_id, created_by
                            ) VALUES (
                                :email_account_id, :user_name, :location_id, :created_by
                            )';
                $isPgsql = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql';
                if ($isPgsql) {
                    $userSql .= ' RETURNING id';
                }
                $userStmt = $this->pdo->prepare($userSql);
                $userStmt->execute([
                    'email_account_id' => $emailId,
                    'user_name' => $userName,
                    'location_id' => $locationId,
                    'created_by' => $user['id'],
                ]);
                $userRowId = $isPgsql
                    ? (int) (($userStmt->fetch()['id'] ?? 0))
                    : (int) $this->pdo->lastInsertId();
            }

            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            $msg = $e->getMessage();
            if (str_contains($msg, 'uq_email_accounts_company_email') || str_contains($msg, 'duplicate key')) {
                Response::error('This email already exists — try again or edit the existing account', 422);
                return;
            }
            Response::error('Unable to save email account', 500);
            return;
        }

        Response::json([
            'id' => $emailId,
            'user_row_id' => $userRowId,
            'email_address' => $emailAddress,
            'message' => $existing !== null
                ? 'User added to existing email account.'
                : 'Email account stored securely.',
        ], 201);
    }

    public function reveal(Request $request, array $user, array $params): void
    {
        if (! Auth::canDecryptVault($user)) {
            Response::error('Not authorized to decrypt vault secrets', 403);
            return;
        }

        $account = $this->findAccount($params['id'] ?? '');
        if ($account === null) {
            Response::error('Email account not found', 404);
            return;
        }

        $this->assertEmailVaultAccess($user, (int) $account['company_id']);

        try {
            $plaintext = $this->vault->decrypt($account['password_ciphertext']);
        } catch (Throwable $e) {
            Response::error('Unable to decrypt email password', 500);
            return;
        }

        Response::json([
            'id' => $account['id'],
            'email_address' => $account['email_address'],
            'password' => $plaintext,
            'ttl_seconds' => 10,
        ]);
    }

    public function updateUser(Request $request, array $user, array $params): void
    {
        $row = $this->findUserRow($params['id'] ?? '');
        if ($row === null) {
            Response::error('Email user not found', 404);
            return;
        }

        $this->assertEmailVaultAccess($user, (int) $row['company_id']);

        $userName = trim((string) $request->input('user_name', $row['user_name']));
        $locationId = (int) $request->input('location_id', $row['location_id']);
        $emailAddress = strtolower(trim((string) $request->input('email_address', $row['email_address'])));
        $password = (string) $request->input('password', '');

        if ($locationId < 1 || $emailAddress === '') {
            Response::error('Invalid email payload', 422);
            return;
        }
        if (! filter_var($emailAddress, FILTER_VALIDATE_EMAIL)) {
            Response::error('Invalid email address', 422);
            return;
        }
        if (! $this->locationBelongsToCompany($locationId, (int) $row['company_id'])) {
            Response::error('Location does not belong to this company', 422);
            return;
        }
        if ($password !== '' && strlen($password) < 8) {
            Response::error('Password must be at least 8 characters', 422);
            return;
        }

        $targetAccountId = (int) $row['email_account_id'];
        $mergeFromAccountId = null;

        // If email moved onto another existing mailbox, attach this profile there (shared password).
        if (strtolower((string) $row['email_address']) !== $emailAddress) {
            $conflict = $this->findByEmail((int) $row['company_id'], $emailAddress);
            if ($conflict !== null && (int) $conflict['id'] !== $targetAccountId) {
                $mergeFromAccountId = $targetAccountId;
                $targetAccountId = (int) $conflict['id'];
            }
        }

        try {
            $this->pdo->beginTransaction();

            $updUser = $this->pdo->prepare(
                'UPDATE email_account_users
                 SET user_name = :user_name,
                     location_id = :location_id,
                     email_account_id = :email_account_id,
                     updated_at = NOW()
                 WHERE id = :id'
            );
            $updUser->execute([
                'user_name' => $userName,
                'location_id' => $locationId,
                'email_account_id' => $targetAccountId,
                'id' => $row['id'],
            ]);

            if ($mergeFromAccountId !== null) {
                $remaining = $this->pdo->prepare(
                    'SELECT COUNT(*) FROM email_account_users
                     WHERE email_account_id = :aid AND is_active = TRUE'
                );
                $remaining->execute(['aid' => $mergeFromAccountId]);
                if ((int) $remaining->fetchColumn() === 0) {
                    $deactivate = $this->pdo->prepare(
                        'UPDATE email_accounts
                         SET is_active = FALSE, updated_by = :updated_by, updated_at = NOW()
                         WHERE id = :id'
                    );
                    $deactivate->execute([
                        'updated_by' => $user['id'],
                        'id' => $mergeFromAccountId,
                    ]);
                }
            }

            // Keep address in sync on the target mailbox (no-op when already matching).
            $accountSql = 'UPDATE email_accounts
                           SET email_address = :email_address, updated_by = :updated_by, updated_at = NOW()';
            $accountParams = [
                'email_address' => $emailAddress,
                'updated_by' => $user['id'],
                'id' => $targetAccountId,
            ];
            if ($password !== '') {
                $cipher = $this->vault->encrypt($password);
                $accountSql .= ', password_ciphertext = :cipher';
                $accountParams['cipher'] = $cipher;
            }
            $accountSql .= ' WHERE id = :id';
            $updAccount = $this->pdo->prepare($accountSql);
            $updAccount->execute($accountParams);

            // One password for this mailbox everywhere (any duplicate active rows).
            if ($password !== '') {
                $sync = $this->pdo->prepare(
                    'UPDATE email_accounts
                     SET password_ciphertext = :cipher, updated_by = :updated_by, updated_at = NOW()
                     WHERE is_active = TRUE
                       AND lower(email_address) = :email
                       AND id <> :id'
                );
                $sync->execute([
                    'cipher' => $accountParams['cipher'],
                    'updated_by' => $user['id'],
                    'email' => $emailAddress,
                    'id' => $targetAccountId,
                ]);
            }

            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Unable to update email user', 500);
            return;
        }

        Response::json([
            'message' => $password !== ''
                ? 'Email user updated. Password synced for all profiles on this mailbox.'
                : 'Email user updated.',
        ]);
    }

    public function destroyUser(Request $request, array $user, array $params): void
    {
        $row = $this->findUserRow($params['id'] ?? '');
        if ($row === null) {
            Response::error('Email user not found', 404);
            return;
        }

        $this->assertEmailVaultAccess($user, (int) $row['company_id']);

        try {
            $this->pdo->beginTransaction();

            $del = $this->pdo->prepare(
                'UPDATE email_account_users SET is_active = FALSE, updated_at = NOW() WHERE id = :id'
            );
            $del->execute(['id' => $row['id']]);

            $countStmt = $this->pdo->prepare(
                'SELECT COUNT(*) FROM email_account_users
                 WHERE email_account_id = :aid AND is_active = TRUE'
            );
            $countStmt->execute(['aid' => $row['email_account_id']]);
            $remaining = (int) $countStmt->fetchColumn();

            if ($remaining === 0) {
                $deactivate = $this->pdo->prepare(
                    'UPDATE email_accounts
                     SET is_active = FALSE, updated_by = :updated_by, updated_at = NOW()
                     WHERE id = :id'
                );
                $deactivate->execute([
                    'updated_by' => $user['id'],
                    'id' => $row['email_account_id'],
                ]);
            }

            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Unable to delete email user', 500);
            return;
        }

        Response::json(['message' => 'Email user deleted.']);
    }

    /** @return array<string, mixed>|null */
    private function findUserRow(string $id): ?array
    {
        if ($id === '' || ! ctype_digit($id)) {
            return null;
        }
        $stmt = $this->pdo->prepare(
            'SELECT u.id, u.user_name, u.location_id, u.email_account_id, u.is_active,
                    e.company_id, e.email_address, e.is_active AS account_active
             FROM email_account_users u
             JOIN email_accounts e ON e.id = u.email_account_id
             WHERE u.id = :id AND u.is_active = TRUE AND e.is_active = TRUE
             LIMIT 1'
        );
        $stmt->execute(['id' => (int) $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** @return array<string, mixed>|null */
    private function findByEmail(int $companyId, string $email, bool $includeInactive = false): ?array
    {
        $sql = 'SELECT * FROM email_accounts
                WHERE company_id = :company_id AND lower(email_address) = :email';
        if (! $includeInactive) {
            $sql .= ' AND is_active = TRUE';
        }
        $sql .= ' ORDER BY is_active DESC, id ASC LIMIT 1';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute(['company_id' => $companyId, 'email' => strtolower($email)]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function isTruthy(mixed $v): bool
    {
        return $v === true || $v === 1 || $v === '1' || $v === 't' || $v === 'true';
    }

    /** @return array<string, mixed>|null */
    private function findAccount(string $id): ?array
    {
        if ($id === '' || ! ctype_digit($id)) {
            return null;
        }
        $stmt = $this->pdo->prepare('SELECT * FROM email_accounts WHERE id = :id AND is_active = TRUE LIMIT 1');
        $stmt->execute(['id' => (int) $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function assertEmailVaultAccess(array $user, int $companyId): void
    {
        $stmt = $this->pdo->prepare('SELECT code FROM companies WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $companyId]);
        $code = strtoupper((string) ($stmt->fetchColumn() ?: ''));
        if ($code === 'OTHER') {
            if (! Auth::canDecryptVault($user) && ($user['role'] ?? '') !== 'super_admin') {
                Response::error('Not authorized for Other emails vault', 403);
                exit;
            }
            return;
        }
        Auth::assertCompanyAccess($user, $companyId);
    }

    private function locationBelongsToCompany(int $locationId, int $companyId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT 1 FROM locations WHERE id = :id AND company_id = :company_id AND is_active = TRUE LIMIT 1'
        );
        $stmt->execute(['id' => $locationId, 'company_id' => $companyId]);
        return (bool) $stmt->fetchColumn();
    }
}
