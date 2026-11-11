<?php

declare(strict_types=1);

namespace Indra\Itam\Services;

use PDO;

final class NotificationService
{
    /** First warranty reminder (days before expiry). */
    private const WARRANTY_LEAD_DAYS = 14;

    /** Keep reminding every N days after the first alert (including expiry and after). */
    private const WARRANTY_REPEAT_DAYS = 2;

    /** Stop post-expiry reminders after this many days. */
    private const WARRANTY_AFTER_CAP_DAYS = 60;

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function notifyAssetAvailable(
        string $assetType,
        int $assetId,
        int $companyId,
        string $assetTag,
        ?int $actorUserId = null,
    ): void {
        $title = 'Asset marked available';
        $body = "{$assetTag} is back in stock and ready for assignment.";
        $link = $this->assetLink($assetType);

        $this->insertForCompanyAdmins($companyId, 'asset_available', $title, $body, $link, $assetType, $assetId, $actorUserId);
    }

    public function notifyStatusChange(
        string $assetType,
        int $assetId,
        int $companyId,
        string $assetTag,
        string $toStatus,
        ?int $actorUserId = null,
    ): void {
        if ($toStatus === 'available') {
            $this->notifyAssetAvailable($assetType, $assetId, $companyId, $assetTag, $actorUserId);
            return;
        }

        $labels = [
            'under_repair' => 'Under repair',
            'lost' => 'Lost / stolen',
            'disposed' => 'Disposed',
            'deployed' => 'Deployed',
        ];
        $label = $labels[$toStatus] ?? $toStatus;
        $title = "Asset status: {$label}";
        $body = "{$assetTag} was marked as {$label}.";
        $this->insertForCompanyAdmins(
            $companyId,
            'status_change',
            $title,
            $body,
            $this->assetLink($assetType),
            $assetType,
            $assetId,
            $actorUserId
        );
    }

    /**
     * Warranty alerts only: 14 days before, then every 2 days through expiry and after.
     * Viewed (read) notifications are omitted from the list.
     *
     * @return list<array<string, mixed>>
     */
    public function listForUser(array $user, int $limit = 40): array
    {
        $limit = max(1, min(100, $limit));
        $companyId = ($user['role'] ?? '') === 'super_admin' ? null : (int) ($user['company_id'] ?? 0);
        $userId = (int) ($user['id'] ?? 0);

        $this->syncWarrantyNotifications($companyId);

        return $this->storedUnreadWarranty($userId, $companyId, $limit);
    }

    public function unreadCount(array $user): int
    {
        $companyId = ($user['role'] ?? '') === 'super_admin' ? null : (int) ($user['company_id'] ?? 0);
        $userId = (int) ($user['id'] ?? 0);

        $sql = "SELECT COUNT(*) FROM notifications
                WHERE is_read = FALSE
                  AND type LIKE 'warranty_%'
                  AND (user_id = :uid OR user_id IS NULL)";
        $params = ['uid' => $userId];
        if ($companyId !== null) {
            $sql .= ' AND (company_id IS NULL OR company_id = :cid)';
            $params['cid'] = $companyId;
        }
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    }

    public function markRead(array $user, int $id): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE notifications SET is_read = TRUE
             WHERE id = :id
               AND is_read = FALSE
               AND (user_id = :uid OR (user_id IS NULL AND (company_id = :cid OR :super = 1)))'
        );
        $stmt->execute([
            'id' => $id,
            'uid' => (int) $user['id'],
            'cid' => (int) ($user['company_id'] ?? 0),
            'super' => ($user['role'] ?? '') === 'super_admin' ? 1 : 0,
        ]);
        return $stmt->rowCount() > 0;
    }

    public function markAllRead(array $user): void
    {
        $sql = "UPDATE notifications SET is_read = TRUE
                WHERE is_read = FALSE
                  AND type LIKE 'warranty_%'
                  AND (user_id = :uid";
        $params = ['uid' => (int) $user['id']];
        if (($user['role'] ?? '') === 'super_admin') {
            $sql .= ' OR user_id IS NULL)';
        } else {
            $sql .= ' OR (user_id IS NULL AND company_id = :cid))';
            $params['cid'] = (int) $user['company_id'];
        }
        $this->pdo->prepare($sql)->execute($params);
    }

    /**
     * Create one company-wide warranty notification per asset milestone day.
     * Already-created milestones (even if previously viewed) are not re-inserted.
     */
    private function syncWarrantyNotifications(?int $companyId): void
    {
        $sql = "SELECT a.id, a.company_id, a.asset_tag, a.category, a.warranty_expires_on,
                       (a.warranty_expires_on - CURRENT_DATE) AS days_remaining
                FROM v_assets a
                WHERE a.warranty_expires_on IS NOT NULL
                  AND a.status::text NOT IN ('disposed', 'lost')
                  AND a.warranty_expires_on <= CURRENT_DATE + (INTERVAL '1 day' * :lead)
                  AND a.warranty_expires_on >= CURRENT_DATE - (INTERVAL '1 day' * :cap)";
        $params = [
            'lead' => self::WARRANTY_LEAD_DAYS,
            'cap' => self::WARRANTY_AFTER_CAP_DAYS,
        ];
        if ($companyId !== null) {
            $sql .= ' AND a.company_id = :cid';
            $params['cid'] = $companyId;
        }
        $sql .= ' ORDER BY a.warranty_expires_on ASC LIMIT 500';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (\Throwable) {
            return;
        }

        $exists = $this->pdo->prepare(
            "SELECT id FROM notifications
             WHERE type = :type AND asset_type = :atype AND asset_id = :aid
             LIMIT 1"
        );
        $insert = $this->pdo->prepare(
            'INSERT INTO notifications (user_id, company_id, type, title, body, link, asset_type, asset_id)
             VALUES (NULL, :cid, :type, :title, :body, :link, :atype, :aid)'
        );

        foreach ($rows as $row) {
            $days = (int) $row['days_remaining'];
            if (!$this->isWarrantyAlertDay($days)) {
                continue;
            }

            $type = $this->warrantyTypeKey($days);
            $assetType = (string) $row['category'];
            $assetId = (int) $row['id'];

            $exists->execute(['type' => $type, 'atype' => $assetType, 'aid' => $assetId]);
            if ($exists->fetchColumn()) {
                continue;
            }

            $tag = (string) $row['asset_tag'];
            [$title, $body] = $this->warrantyCopy($tag, $days);

            $insert->execute([
                'cid' => (int) $row['company_id'],
                'type' => $type,
                'title' => $title,
                'body' => $body,
                'link' => $this->assetLink($assetType),
                'atype' => $assetType,
                'aid' => $assetId,
            ]);
        }
    }

    private function isWarrantyAlertDay(int $daysRemaining): bool
    {
        if ($daysRemaining > self::WARRANTY_LEAD_DAYS) {
            return false;
        }
        if ($daysRemaining < -self::WARRANTY_AFTER_CAP_DAYS) {
            return false;
        }
        // 14, 12, … 2, 0 (expiry), then -2, -4, … after expiry
        return ($daysRemaining % self::WARRANTY_REPEAT_DAYS) === 0;
    }

    private function warrantyTypeKey(int $daysRemaining): string
    {
        if ($daysRemaining < 0) {
            return 'warranty_m' . abs($daysRemaining);
        }
        return 'warranty_d' . $daysRemaining;
    }

    /** @return array{0: string, 1: string} */
    private function warrantyCopy(string $tag, int $days): array
    {
        if ($days < 0) {
            return [
                'Warranty expired',
                "{$tag} expired " . abs($days) . ' day(s) ago',
            ];
        }
        if ($days === 0) {
            return [
                'Warranty expires today',
                "{$tag} warranty ends today",
            ];
        }
        return [
            'Warranty expiring soon',
            "{$tag} expires in {$days} day(s)",
        ];
    }

    private function insertForCompanyAdmins(
        int $companyId,
        string $type,
        string $title,
        string $body,
        string $link,
        string $assetType,
        int $assetId,
        ?int $actorUserId,
    ): void {
        // One company-wide row (user_id NULL) so all company users see it
        $dup = $this->pdo->prepare(
            "SELECT id FROM notifications
             WHERE type = :type AND asset_type = :atype AND asset_id = :aid
               AND created_at > NOW() - INTERVAL '1 day'
             LIMIT 1"
        );
        $dup->execute(['type' => $type, 'atype' => $assetType, 'aid' => $assetId]);
        if ($dup->fetchColumn()) {
            return;
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO notifications (user_id, company_id, type, title, body, link, asset_type, asset_id)
             VALUES (NULL, :cid, :type, :title, :body, :link, :atype, :aid)'
        );
        $stmt->execute([
            'cid' => $companyId,
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'link' => $link,
            'atype' => $assetType,
            'aid' => $assetId,
        ]);
        unset($actorUserId);
    }

    /** @return list<array<string, mixed>> */
    private function storedUnreadWarranty(int $userId, ?int $companyId, int $limit): array
    {
        $sql = "SELECT id, type, title, body, link, asset_type, asset_id, is_read, created_at, company_id
                FROM notifications
                WHERE is_read = FALSE
                  AND type LIKE 'warranty_%'
                  AND (user_id = :uid OR user_id IS NULL)";
        $params = ['uid' => $userId];
        if ($companyId !== null) {
            $sql .= ' AND (company_id IS NULL OR company_id = :cid)';
            $params['cid'] = $companyId;
        }
        $sql .= ' ORDER BY created_at DESC LIMIT :lim';
        $stmt = $this->pdo->prepare($sql);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->bindValue('lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $rows[] = [
                'id' => 'db-' . $row['id'],
                'db_id' => (int) $row['id'],
                'type' => $row['type'],
                'title' => $row['title'],
                'body' => $row['body'],
                'link' => $row['link'],
                'asset_type' => $row['asset_type'],
                'asset_id' => $row['asset_id'] !== null ? (int) $row['asset_id'] : null,
                'is_read' => false,
                'created_at' => $row['created_at'],
                'source' => 'stored',
            ];
        }
        return $rows;
    }

    private function assetLink(string $category): string
    {
        return match ($category) {
            'laptop' => '/assets/laptop',
            'mobile_phone' => '/assets/mobile-phones',
            'pc' => '/assets/all',
            'other' => '/assets/others',
            default => '/assets/all',
        };
    }
}
