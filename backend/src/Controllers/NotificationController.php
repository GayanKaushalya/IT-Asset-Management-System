<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Services\NotificationService;
use PDO;

final class NotificationController
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function index(Request $request, array $user): void
    {
        $svc = new NotificationService($this->pdo);
        $limit = (int) $request->input('limit', 40);
        $items = $svc->listForUser($user, $limit);
        Response::json([
            'data' => $items,
            'unread' => $svc->unreadCount($user),
        ]);
    }

    public function markRead(Request $request, array $user, string $id): void
    {
        $svc = new NotificationService($this->pdo);
        if (str_starts_with($id, 'db-')) {
            $id = substr($id, 3);
        }
        if (! ctype_digit($id)) {
            // Live/virtual notifications — acknowledge client-side only
            Response::json(['ok' => true]);
            return;
        }
        $svc->markRead($user, (int) $id);
        Response::json(['ok' => true]);
    }

    public function markAllRead(Request $request, array $user): void
    {
        unset($request);
        (new NotificationService($this->pdo))->markAllRead($user);
        Response::json(['ok' => true]);
    }
}
