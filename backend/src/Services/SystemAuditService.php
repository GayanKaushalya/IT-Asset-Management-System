<?php

declare(strict_types=1);

namespace Indra\Itam\Services;

use Indra\Itam\Http\Request;
use PDO;

final class SystemAuditService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param array<string, mixed>|null $details
     */
    public function log(
        ?int $actorUserId,
        string $action,
        Request $request,
        ?int $targetUserId = null,
        ?array $details = null,
    ): void {
        try {
            $ua = $request->userAgent();
            $stmt = $this->pdo->prepare(
                'INSERT INTO system_audit_logs
                    (actor_user_id, target_user_id, action, details, ip_address, user_agent, created_at)
                 VALUES
                    (:actor_user_id, :target_user_id, :action, CAST(:details AS JSONB), :ip_address, :user_agent, NOW())'
            );
            $stmt->execute([
                'actor_user_id' => $actorUserId,
                'target_user_id' => $targetUserId,
                'action' => $action,
                'details' => $details !== null ? json_encode($details, JSON_THROW_ON_ERROR) : null,
                'ip_address' => $request->ip(),
                'user_agent' => $ua !== null ? substr($ua, 0, 255) : null,
            ]);
        } catch (\Throwable) {
            // Never break the main request if audit write fails
        }
    }
}
