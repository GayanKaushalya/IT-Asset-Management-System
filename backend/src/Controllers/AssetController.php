<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Services\HandoverSlotSync;
use Indra\Itam\Services\NotificationService;
use Indra\Itam\Support\Auth;
use PDO;

final class AssetController
{
    /** @var array<string, string> */
    private const TABLES = [
        'laptop' => 'laptops',
        'mobile_phone' => 'mobile_phones',
        'pc' => 'pcs',
        'printer' => 'printers',
        'other' => 'other_assets',
    ];

    /** @var array<string, list<string>> */
    private const TABLE_COLUMNS = [
        'laptops' => [
            'company_id', 'location_id', 'department_id', 'supplier_id', 'asset_tag', 'serial_number',
            'brand', 'model', 'status', 'pc_name', 'cpu', 'ram_gb', 'storage_gb', 'storage_type',
            'hdd_gb', 'ssd_gb',
            'invoice_no', 'purchase_amount_lkr', 'purchase_date', 'warranty_expires_on', 'notes',
            'handover_person_1', 'handover_person_2', 'handover_person_3', 'handover_person_4',
            'handover_person_5', 'handover_person_6', 'handover_person_7', 'handover_person_8',
            'handover_on_1', 'handover_on_2', 'handover_on_3', 'handover_on_4',
            'handover_on_5', 'handover_on_6', 'handover_on_7', 'handover_on_8',
            'original_assigned_person', 'original_assigned_on', 'allocated_person', 'allocated_on',
            'has_mouse',
            'is_legacy',
            'created_by', 'updated_by',
        ],
        'mobile_phones' => [
            'company_id', 'location_id', 'department_id', 'supplier_id', 'asset_tag', 'serial_number',
            'brand', 'model', 'status', 'pc_name', 'invoice_no', 'purchase_amount_lkr',
            'imei_number', 'phone_number', 'first_handover_person', 'handed_over_on', 'asset_return_date',
            'handover_person_1', 'handover_person_2', 'handover_person_3', 'handover_person_4',
            'handover_person_5', 'handover_person_6', 'handover_person_7', 'handover_person_8',
            'handover_person_9', 'handover_person_10',
            'handover_on_1', 'handover_on_2', 'handover_on_3', 'handover_on_4',
            'handover_on_5', 'handover_on_6', 'handover_on_7', 'handover_on_8',
            'handover_on_9', 'handover_on_10',
            'original_assigned_person', 'original_assigned_on', 'allocated_person', 'allocated_on',
            'imei_number_2', 'condition_code', 'accessories', 'purchase_date',
            'warranty_period', 'warranty_expires_on',
            'has_charger', 'has_data_cable', 'has_back_cover',
            'is_legacy', 'is_sim',
            'notes', 'created_by', 'updated_by',
        ],
        'pcs' => [
            'company_id', 'location_id', 'department_id', 'supplier_id', 'asset_tag', 'serial_number',
            'brand', 'model', 'status', 'pc_name', 'cpu', 'ram_gb', 'storage_gb', 'storage_type',
            'hdd_gb', 'ssd_gb', 'windows_version',
            'invoice_no', 'purchase_amount_lkr', 'purchase_date',
            'warranty_period', 'warranty_expires_on', 'notes',
            'monitor_brand', 'has_power_cable', 'has_vga_cable', 'has_ups', 'ups_brand', 'ups_model',
            'ups_purchase_date', 'ups_warranty_period', 'ups_warranty_expires_on',
            'has_keyboard', 'has_mouse',
            'handover_person_1', 'handover_person_2', 'handover_person_3', 'handover_person_4',
            'handover_person_5', 'handover_person_6', 'handover_person_7', 'handover_person_8',
            'handover_on_1', 'handover_on_2', 'handover_on_3', 'handover_on_4',
            'handover_on_5', 'handover_on_6', 'handover_on_7', 'handover_on_8',
            'original_assigned_person', 'original_assigned_on',
            'allocated_person', 'allocated_on',
            'newly_purchased',
            'created_by', 'updated_by',
        ],
        'printers' => [
            'company_id', 'location_id', 'department_id', 'supplier_id', 'asset_tag', 'serial_number',
            'brand', 'model', 'status', 'pc_name', 'invoice_no', 'purchase_amount_lkr',
            'purchase_date', 'warranty_expires_on', 'notes', 'created_by', 'updated_by',
        ],
        'other_assets' => [
            'company_id', 'location_id', 'department_id', 'supplier_id', 'asset_tag', 'serial_number',
            'brand', 'model', 'status', 'pc_name', 'user_name', 'item_name', 'invoice_no', 'purchase_amount_lkr',
            'purchase_date', 'warranty_period', 'warranty_expires_on', 'specification', 'notes', 'handover_date',
            'created_by', 'updated_by',
        ],
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function index(Request $request, array $user): void
    {
        $category = (string) $request->input('category', '');
        // All Branch PC Inventory → branch desktop PCs only (not laptops/phones/etc.)
        $categories = $category === '' || $category === 'all'
            ? ['pc']
            : $this->resolveListCategories($category);
        if ($categories === []) {
            Response::error('Valid category required', 422);
            return;
        }

        $companyId = null;
        $companyCode = null;
        $companyShort = null;

        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) $user['company_id'];
        } elseif ($request->input('company_id')) {
            $companyId = (int) $request->input('company_id');
        } elseif ($request->input('company_code')) {
            $co = $this->resolveCompanyByCode(strtoupper((string) $request->input('company_code')));
            if ($co !== null) {
                $companyId = (int) $co['id'];
                $companyCode = (string) $co['code'];
                $companyShort = (string) $co['short_name'];
            }
        }

        if ($companyCode === null && $request->input('company_code')) {
            $companyCode = strtoupper((string) $request->input('company_code'));
        }
        if ($companyCode !== null && $companyShort === null) {
            $companyShort = match ($companyCode) {
                'IT' => 'Traders',
                'IMS' => 'Motor Spares',
                'ISP' => 'Service Park',
                'FOTON' => 'Foton',
                'SIM' => 'SIM',
                default => $companyCode,
            };
        } elseif ($companyId !== null && ($companyCode === null || $companyShort === null)) {
            $co = $this->resolveCompanyById($companyId);
            if ($co !== null) {
                $companyCode = (string) $co['code'];
                $companyShort = (string) $co['short_name'];
            }
        }

        $parts = [];
        $params = [];
        foreach ($categories as $i => $cat) {
            $table = self::TABLES[$cat];
            $alias = 'a' . $i;
            $sql = $this->selectListSql($table, $cat, $alias, $companyCode, $companyShort);
            $where = ['1=1'];

            $isSimList = $cat === 'mobile_phone' && (
                strtoupper((string) ($companyCode ?? '')) === 'SIM'
                || $request->input('is_sim') === '1'
                || $request->input('is_sim') === 1
                || $request->input('is_sim') === true
            );

            if ($isSimList) {
                // SIM tab: all SIM cards across ITL / IMS / ISP (and legacy SIM company)
                $where[] = "{$alias}.is_sim = TRUE";
            } elseif ($companyId !== null) {
                // Include assets that used to belong here (transferred away) so old company can still open them
                if (in_array($cat, ['laptop', 'mobile_phone', 'pc', 'other', 'printer'], true)) {
                    $where[] = "({$alias}.company_id = :company_id OR {$alias}.transferred_from_company_id = :company_id)";
                } else {
                    $where[] = "{$alias}.company_id = :company_id";
                }
                $params['company_id'] = $companyId;
                // Keep SIMs off the regular ITL / IMS / ISP phone tabs
                if ($cat === 'mobile_phone') {
                    $where[] = "{$alias}.is_sim IS NOT TRUE";
                }
            }

            // Newly Purchased PCs tab: flagged on create (keeps Assigned purchases visible)
            $newlyPurchased = $cat === 'pc' && (
                $request->input('newly_purchased') === '1'
                || $request->input('newly_purchased') === 1
                || $request->input('newly_purchased') === true
            );
            if ($newlyPurchased) {
                $where[] = "{$alias}.newly_purchased = TRUE";
            } elseif ($request->input('status')) {
                $where[] = "{$alias}.status = :status";
                $params['status'] = (string) $request->input('status');
            }

            if ($request->input('location_id')) {
                $params['location_id'] = (int) $request->input('location_id');
                // Still list assets transferred away from this company (any new location)
                if (
                    ! $isSimList
                    && $companyId !== null
                    && in_array($cat, ['laptop', 'mobile_phone', 'pc', 'other', 'printer'], true)
                ) {
                    $where[] = "({$alias}.location_id = :location_id
                        OR ({$alias}.transferred_from_company_id = :company_id
                            AND {$alias}.company_id <> :company_id))";
                } else {
                    $where[] = "{$alias}.location_id = :location_id";
                }
            }

            if ($q = trim((string) $request->input('q', ''))) {
                $params['q'] = '%' . $q . '%';
                if ($cat === 'mobile_phone') {
                    $where[] = "({$alias}.asset_tag ILIKE :q OR {$alias}.former_asset_tag ILIKE :q OR {$alias}.pc_name ILIKE :q OR {$alias}.serial_number ILIKE :q
                        OR {$alias}.imei_number ILIKE :q OR {$alias}.imei_number_2 ILIKE :q OR {$alias}.phone_number ILIKE :q
                        OR {$alias}.original_assigned_person ILIKE :q OR {$alias}.allocated_person ILIKE :q
                        OR {$alias}.first_handover_person ILIKE :q
                        OR {$alias}.handover_person_1 ILIKE :q OR {$alias}.handover_person_2 ILIKE :q
                        OR {$alias}.handover_person_3 ILIKE :q OR {$alias}.handover_person_4 ILIKE :q
                        OR {$alias}.handover_person_5 ILIKE :q OR {$alias}.handover_person_6 ILIKE :q
                        OR {$alias}.handover_person_7 ILIKE :q OR {$alias}.handover_person_8 ILIKE :q
                        OR {$alias}.handover_person_9 ILIKE :q OR {$alias}.handover_person_10 ILIKE :q)";
                } elseif ($cat === 'laptop') {
                    $where[] = "({$alias}.asset_tag ILIKE :q OR {$alias}.former_asset_tag ILIKE :q OR {$alias}.pc_name ILIKE :q OR {$alias}.serial_number ILIKE :q
                        OR {$alias}.original_assigned_person ILIKE :q OR {$alias}.allocated_person ILIKE :q
                        OR {$alias}.handover_person_1 ILIKE :q OR {$alias}.handover_person_2 ILIKE :q
                        OR {$alias}.handover_person_3 ILIKE :q OR {$alias}.handover_person_4 ILIKE :q
                        OR {$alias}.handover_person_5 ILIKE :q OR {$alias}.handover_person_6 ILIKE :q
                        OR {$alias}.handover_person_7 ILIKE :q OR {$alias}.handover_person_8 ILIKE :q)";
                } elseif ($cat === 'other') {
                    $where[] = "({$alias}.asset_tag ILIKE :q OR {$alias}.former_asset_tag ILIKE :q OR {$alias}.user_name ILIKE :q OR {$alias}.pc_name ILIKE :q
                        OR {$alias}.item_name ILIKE :q OR {$alias}.serial_number ILIKE :q
                        OR {$alias}.brand ILIKE :q OR {$alias}.model ILIKE :q OR {$alias}.notes ILIKE :q)";
                } elseif ($cat === 'pc') {
                    $where[] = "({$alias}.asset_tag ILIKE :q OR {$alias}.former_asset_tag ILIKE :q OR {$alias}.pc_name ILIKE :q OR {$alias}.serial_number ILIKE :q)";
                } else {
                    $where[] = "({$alias}.asset_tag ILIKE :q OR {$alias}.pc_name ILIKE :q OR {$alias}.serial_number ILIKE :q)";
                }
            }

            $parts[] = $sql . ' WHERE ' . implode(' AND ', $where);
        }

        $allowedLimits = [5, 10, 20, 50, 100, 500];
        $limit = (int) $request->input('limit', 50);
        if (! in_array($limit, $allowedLimits, true)) {
            $limit = 50;
        }

        $page = max(1, (int) $request->input('page', 1));
        $offset = ($page - 1) * $limit;

        $base = implode(' UNION ALL ', $parts);

        // New first (highest tag number on top: …0016, 0015, 0014…); Old stock below, short tag ASC.
        $tagNumDesc = "CAST(NULLIF(substring(asset_tag from '([0-9]+)$'), '') AS INTEGER) DESC NULLS LAST, id DESC";
        $orderBy = "CASE WHEN COALESCE(is_legacy, FALSE) THEN 1 ELSE 0 END,
                 CASE WHEN COALESCE(is_legacy, FALSE) THEN asset_tag ELSE NULL END ASC NULLS FIRST,
                 {$tagNumDesc}";

        // One DB round-trip instead of COUNT + SELECT (saves Supabase pooler RTT)
        $fetchPage = static function (
            PDO $pdo,
            string $base,
            array $params,
            int $limit,
            int $offset,
            string $orderBy,
            ?string $legacyFilter = null
        ): array {
            $legacyWhere = $legacyFilter === null
                ? ''
                : ' WHERE COALESCE(is_legacy, FALSE) = ' . ($legacyFilter === 'old' ? 'TRUE' : 'FALSE');
            $stmt = $pdo->prepare(
                "SELECT * FROM (
                    SELECT asset_list.*, COUNT(*) OVER() AS _total_count
                    FROM ({$base}) AS asset_list
                    {$legacyWhere}
                 ) AS paged
                 ORDER BY {$orderBy}
                 LIMIT {$limit} OFFSET {$offset}"
            );
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
            $total = $rows === [] ? 0 : (int) ($rows[0]['_total_count'] ?? 0);
            foreach ($rows as &$row) {
                unset($row['_total_count']);
            }
            unset($row);
            return [$rows, $total];
        };

        // Per sub-company laptop/phone lists: new stock fills pages 1..N; one trailing page holds ALL Old stock.
        // When searching, skip the new/old page split so old-stock matches appear in results.
        $hasSearch = trim((string) $request->input('q', '')) !== '';
        $reserveOldPages = $companyId !== null
            && count($categories) === 1
            && in_array($categories[0], ['laptop', 'mobile_phone'], true);

        $newCount = 0;
        $oldCount = 0;
        $newPages = 0;
        $oldPages = 0;

        if ($reserveOldPages) {
            $countStmt = $this->pdo->prepare(
                "SELECT
                    COUNT(*) FILTER (WHERE NOT COALESCE(is_legacy, FALSE)) AS new_count,
                    COUNT(*) FILTER (WHERE COALESCE(is_legacy, FALSE)) AS old_count
                 FROM ({$base}) AS asset_list"
            );
            $countStmt->execute($params);
            $counts = $countStmt->fetch(PDO::FETCH_ASSOC) ?: [];
            $newCount = (int) ($counts['new_count'] ?? 0);
            $oldCount = (int) ($counts['old_count'] ?? 0);
            $total = $newCount + $oldCount;

            $newOrderBy = $tagNumDesc;
            $oldOrderBy = 'asset_tag ASC, id DESC';

            if ($hasSearch) {
                // Mixed new + old matches; keep new-first ordering from $orderBy
                $offset = ($page - 1) * $limit;
                [$rows, $total] = $fetchPage($this->pdo, $base, $params, $limit, $offset, $orderBy, null);
                $pages = $total === 0 ? 1 : max(1, (int) ceil($total / $limit));
                if ($page > $pages) {
                    $page = $pages;
                    $offset = ($page - 1) * $limit;
                    [$rows, $total] = $fetchPage($this->pdo, $base, $params, $limit, $offset, $orderBy, null);
                    $pages = $total === 0 ? 1 : max(1, (int) ceil($total / $limit));
                }
                $newPages = $pages;
                $oldPages = 0;
            } else {
                $newPages = $newCount === 0 ? 0 : (int) ceil($newCount / $limit);
                // Keep every old-stock row on a single final page so none are hidden behind page 2+
                $oldPages = $oldCount === 0 ? 0 : 1;
                $pages = max(1, $newPages + $oldPages);
                if ($page > $pages) {
                    $page = $pages;
                }

                if ($oldCount > 0 && $page > $newPages) {
                    $page = $newPages + 1;
                    $oldLimit = max($oldCount, 1);
                    if ($oldLimit > 500) {
                        $oldLimit = 500;
                    }
                    [$rows] = $fetchPage($this->pdo, $base, $params, $oldLimit, 0, $oldOrderBy, 'old');
                } else {
                    $offset = ($page - 1) * $limit;
                    [$rows] = $fetchPage($this->pdo, $base, $params, $limit, $offset, $newOrderBy, 'new');
                }
            }
        } else {
            [$rows, $total] = $fetchPage($this->pdo, $base, $params, $limit, $offset, $orderBy);
            $pages = $total === 0 ? 1 : max(1, (int) ceil($total / $limit));
            if ($total > 0 && $page > $pages) {
                $page = $pages;
                $offset = ($page - 1) * $limit;
                [$rows, $total] = $fetchPage($this->pdo, $base, $params, $limit, $offset, $orderBy);
                $pages = $total === 0 ? 1 : max(1, (int) ceil($total / $limit));
            }
        }

        if ($companyId !== null) {
            foreach ($rows as &$row) {
                $currentCid = (int) ($row['current_company_id'] ?? 0);
                $fromCid = (int) ($row['transferred_from_company_id'] ?? 0);
                $row['transferred_away'] = $currentCid > 0 && $currentCid !== $companyId && $fromCid === $companyId;
                // Arrived here via company transfer — treat as new at this company/location
                $row['transferred_in'] = $currentCid === $companyId
                    && $fromCid > 0
                    && ! empty($row['company_transferred_at']);
            }
            unset($row);
        }

        $meta = [
            'total' => $total,
            'page' => $page,
            'limit' => $limit,
            'pages' => $pages,
        ];
        if ($reserveOldPages) {
            $meta['new_count'] = $newCount;
            $meta['old_count'] = $oldCount;
            $meta['new_pages'] = $newPages;
            $meta['old_pages'] = $oldPages;
            // Hide reserved old-stock page while searching — results already include old matches
            $meta['old_stock_from_page'] = (! $hasSearch && $oldPages > 0) ? $newPages + 1 : null;
        }

        Response::json([
            'data' => $rows,
            'meta' => $meta,
        ]);
    }

    public function show(Request $request, array $user, array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $category = $this->resolveCategory($request, $params);
        if ($category === null || $id < 1) {
            Response::error('category and id required', 422);
            return;
        }

        $row = $this->findDetailed($category, $id);
        if ($row === null) {
            Response::error('Asset not found', 404);
            return;
        }
        $this->assertAssetCompanyAccess($user, $row);
        // Slots may exist from imports/edits without asset_handovers rows — backfill so history matches UI
        $this->ensureHandoversFromSlots($category, $id, $row, $user);
        // Rebuild denormalized slots + collapse accidental consecutive same-person handovers
        if (in_array($category, ['laptop', 'mobile_phone', 'pc'], true)) {
            (new HandoverSlotSync($this->pdo))->sync($category, $id);
            $refreshed = $this->findDetailed($category, $id);
            if (is_array($refreshed)) {
                $row = $refreshed;
                $row['company_id'] = $refreshed['company_id'] ?? $row['company_id'];
            }
        }
        $row['handovers'] = $this->handoverHistory($category, $id);
        $current = null;
        foreach ($row['handovers'] as $h) {
            if (! empty($h['is_current'])) {
                $current = $h;
                break;
            }
        }
        if ($current !== null) {
            $row['handover_open'] = true;
            $row['assigned_person_name'] = $current['assigned_person_name'];
            $row['allocated_person'] = $current['assigned_person_name'];
            $row['allocated_on'] = $current['handover_date'] ?? null;
            $row['current_handover_no'] = $current['handover_no'];
            $row['current_handover_label'] = $current['handover_label'];
            $row['handed_over_display'] = $current['handover_date'] ?? $row['handed_over_display'] ?? null;
            $original = trim((string) ($row['original_assigned_person'] ?? ''));
            $holder = trim((string) ($current['assigned_person_name'] ?? ''));
            $row['allocated_is_original'] = $original !== '' && strcasecmp($original, $holder) === 0;
        } else {
            // No open handover — clear current holder (do not fall back to slot 1 / original).
            // Chain history stays on handover_person_* / original_assigned_* for display.
            $row['handover_open'] = false;
            $row['allocated_person'] = null;
            $row['allocated_on'] = null;
            $row['assigned_person_name'] = null;
            $row['current_handover_no'] = null;
            $row['current_handover_label'] = null;
            $row['allocated_is_original'] = false;
        }
        $row['current_holder'] = $row['allocated_person'] ?? $row['assigned_person_name'] ?? null;
        Response::json(['data' => $row]);
    }

    public function store(Request $request, array $user): void
    {
        $companyId = (int) $request->input('company_id', $user['company_id']);
        Auth::assertCompanyAccess($user, $companyId);

        $category = (string) $request->input('category', 'laptop');
        if (! isset(self::TABLES[$category])) {
            Response::error('Valid category required', 422);
            return;
        }

        $table = self::TABLES[$category];
        $locationId = (int) $request->input('location_id', 0);
        if ($category === 'pc' && $locationId < 1) {
            Response::error('Branch / location is required to assign a PC asset ID', 422);
            return;
        }
        if ($category === 'other' && $locationId < 1) {
            Response::error('Branch / location is required to assign an other-asset ID', 422);
            return;
        }

        $isLegacy = in_array($category, ['laptop', 'mobile_phone'], true) && (
            self::toBool($request->input('is_legacy'))
            || strtolower(trim((string) $request->input('entry_type', ''))) === 'old'
        );

        try {
            $assetTag = $this->nextAssetTag(
                $companyId,
                $category,
                $table,
                $locationId > 0 ? $locationId : null,
                $isLegacy
            );
        } catch (\Throwable $e) {
            Response::error($e->getMessage() !== '' ? $e->getMessage() : 'Could not assign asset ID', 422);
            return;
        }
        $supplierId = $this->resolveSupplierId($companyId, $request);
        $payload = $this->buildPayload($request, $user, $companyId, $supplierId, $assetTag, $category);
        $columns = array_values(array_filter(
            self::TABLE_COLUMNS[$table],
            static fn (string $col) => array_key_exists($col, $payload)
        ));

        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s) RETURNING *',
            $table,
            implode(', ', $columns),
            implode(', ', array_map(static fn (string $c) => ':' . $c, $columns))
        );

        $bind = [];
        foreach ($columns as $col) {
            $val = $payload[$col];
            // PDO+pgsql can send PHP false as "" which breaks boolean columns
            if (is_bool($val)) {
                $val = $val ? 'true' : 'false';
            }
            $bind[$col] = $val;
        }

        $stmt = $this->pdo->prepare($sql);
        try {
            $stmt->execute($bind);
        } catch (\Throwable) {
            try {
                $bind['asset_tag'] = $this->nextAssetTag(
                    $companyId,
                    $category,
                    $table,
                    $locationId > 0 ? $locationId : null,
                    $isLegacy
                );
            } catch (\Throwable $e) {
                Response::error($e->getMessage() !== '' ? $e->getMessage() : 'Could not assign asset ID', 422);
                return;
            }
            $stmt->execute($bind);
        }

        $row = $stmt->fetch();
        if (is_array($row)) {
            $row['category'] = $category;
            // On create, holder / 1st handover person becomes originally assigned + handover slot 1
            $person = trim((string) (
                $request->input('first_handover_person')
                ?: $request->input('allocated_person')
                ?: $request->input('assigned_person_name')
                ?: $request->input('original_assigned_person')
                ?: $request->input('name')
                ?: $request->input('pc_name')
                ?: ''
            ));
            if ($person !== '' && in_array($category, ['laptop', 'mobile_phone', 'pc'], true)) {
                $handoverDate = trim((string) (
                    $request->input('handed_over_on')
                    ?: $request->input('handover_date')
                    ?: $request->input('original_assigned_on')
                    ?: $request->input('purchase_date')
                    ?: $request->input('date')
                    ?: ''
                ));
                if ($handoverDate === '') {
                    $handoverDate = date('Y-m-d');
                }
                $this->createInitialHandover(
                    $category,
                    (int) $row['id'],
                    (int) $row['company_id'],
                    $person,
                    $handoverDate,
                    (int) $user['id']
                );
                (new HandoverSlotSync($this->pdo))->sync($category, (int) $row['id']);
                $requestedStatus = trim((string) ($request->input('status') ?: ''));
                $extra = [
                    // Keep explicit status from the form when set; otherwise mark deployed
                    'status' => $requestedStatus !== '' ? $requestedStatus : 'deployed',
                    'handover_person_1' => $person,
                    'handover_on_1' => $handoverDate,
                    'original_assigned_person' => $person,
                    'original_assigned_on' => $handoverDate,
                    'allocated_person' => $person,
                    'allocated_on' => $handoverDate,
                    'updated_at' => date('c'),
                ];
                if ($category === 'mobile_phone') {
                    $extra['first_handover_person'] = $person;
                    $extra['handed_over_on'] = $handoverDate;
                }
                $setParts = [];
                $bindExtra = ['id' => (int) $row['id']];
                foreach ($extra as $col => $val) {
                    if ($col === 'updated_at') {
                        $setParts[] = 'updated_at = NOW()';
                        continue;
                    }
                    $setParts[] = "{$col} = :{$col}";
                    $bindExtra[$col] = $val;
                }
                $this->pdo->prepare("UPDATE {$table} SET " . implode(', ', $setParts) . ' WHERE id = :id')
                    ->execute($bindExtra);
                foreach ($extra as $k => $v) {
                    $row[$k] = $v;
                }
                $row['assigned_person_name'] = $person;
                $row['status'] = 'deployed';
            }
        }
        Response::json(['data' => $row], 201);
    }

    public function update(Request $request, array $user, array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $category = $this->resolveCategory($request, $params);
        if ($category === null || $id < 1) {
            Response::error('category and id required', 422);
            return;
        }

        $asset = $this->find($category, $id);
        if ($asset === null) {
            Response::error('Asset not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $asset['company_id']);

        $table = self::TABLES[$category];
        $body = $this->normalizeBody($request->body);
        if (array_key_exists('supplier', $request->body) || array_key_exists('supplier_name', $request->body)) {
            $body['supplier_id'] = $this->resolveSupplierId((int) $asset['company_id'], $request);
        }

        // Laptops: always derive warranty void date = purchase date + 2 years
        if ($category === 'laptop') {
            $purchase = $body['purchase_date'] ?? $asset['purchase_date'] ?? null;
            if (is_string($purchase) && $purchase !== '') {
                $void = self::addYears($purchase, 2);
                if ($void !== null) {
                    $body['warranty_expires_on'] = $void;
                }
            }
        }

        // Mobile phones: warranty void = originally assigned handover date + 1 year
        if ($category === 'mobile_phone') {
            $anchor = $body['original_assigned_on']
                ?? $asset['original_assigned_on']
                ?? $body['handed_over_on']
                ?? $asset['handed_over_on']
                ?? $asset['handover_on_1']
                ?? $body['purchase_date']
                ?? $asset['purchase_date']
                ?? null;
            if (is_string($anchor) && $anchor !== '') {
                $void = self::addYears($anchor, 1);
                if ($void !== null) {
                    $body['warranty_expires_on'] = $void;
                    if (empty($body['warranty_period']) && empty($asset['warranty_period'])) {
                        $body['warranty_period'] = '1 year';
                    }
                }
            }
        }

        // PCs: derive PC + UPS warranty expiry from period + purchase dates (server source of truth)
        if ($category === 'pc') {
            $pcPurchase = $body['purchase_date'] ?? $asset['purchase_date'] ?? null;
            $pcPeriod = trim((string) ($body['warranty_period'] ?? $asset['warranty_period'] ?? ''));
            if ($pcPeriod !== '' && strcasecmp($pcPeriod, 'Expired') === 0) {
                $body['warranty_expires_on'] = null;
            } elseif (is_string($pcPurchase) && $pcPurchase !== '' && $pcPeriod !== '') {
                $pcExpiry = self::expiryFromPeriod($pcPurchase, $pcPeriod);
                if ($pcExpiry !== null) {
                    $body['warranty_expires_on'] = $pcExpiry;
                }
            }

            $upsOn = array_key_exists('has_ups', $body)
                ? self::toBool($body['has_ups'])
                : self::toBool($asset['has_ups'] ?? false);
            if ($upsOn) {
                $upsPurchase = $body['ups_purchase_date'] ?? $asset['ups_purchase_date'] ?? null;
                $upsPeriod = trim((string) ($body['ups_warranty_period'] ?? $asset['ups_warranty_period'] ?? ''));
                if ($upsPeriod !== '' && strcasecmp($upsPeriod, 'Expired') === 0) {
                    $body['ups_warranty_expires_on'] = null;
                } elseif (is_string($upsPurchase) && $upsPurchase !== '' && $upsPeriod !== '') {
                    $upsExpiry = self::expiryFromPeriod($upsPurchase, $upsPeriod);
                    if ($upsExpiry !== null) {
                        $body['ups_warranty_expires_on'] = $upsExpiry;
                    }
                }
            } else {
                $body['ups_brand'] = null;
                $body['ups_model'] = null;
                $body['ups_purchase_date'] = null;
                $body['ups_warranty_period'] = null;
                $body['ups_warranty_expires_on'] = null;
            }
        }

        // Other assets: warranty void = purchased date + selected period
        if ($category === 'other' || $category === 'printer') {
            $otherPurchase = $body['purchase_date'] ?? $asset['purchase_date'] ?? null;
            $otherPeriod = trim((string) ($body['warranty_period'] ?? $asset['warranty_period'] ?? ''));
            if ($otherPeriod === '') {
                $body['warranty_expires_on'] = null;
            } elseif (is_string($otherPurchase) && $otherPurchase !== '') {
                $otherExpiry = self::expiryFromPeriod($otherPurchase, $otherPeriod);
                if ($otherExpiry !== null) {
                    $body['warranty_expires_on'] = $otherExpiry;
                }
            }
        }

        $sets = ['updated_by = :updated_by', 'updated_at = NOW()'];
        $bind = ['id' => $id, 'updated_by' => $user['id']];
        // Handover person fields are managed via handover sync — don't blank them from the details form
        $skipOnUpdate = ['created_by', 'asset_tag', 'company_id'];
        if (in_array($category, ['laptop', 'mobile_phone', 'pc'], true)) {
            $skipOnUpdate = array_merge($skipOnUpdate, [
                'handover_person_1', 'handover_person_2', 'handover_person_3', 'handover_person_4',
                'handover_person_5', 'handover_person_6', 'handover_person_7', 'handover_person_8',
                'handover_person_9', 'handover_person_10',
                'handover_on_1', 'handover_on_2', 'handover_on_3', 'handover_on_4',
                'handover_on_5', 'handover_on_6', 'handover_on_7', 'handover_on_8',
                'handover_on_9', 'handover_on_10',
                'original_assigned_person', 'original_assigned_on',
                'allocated_person', 'allocated_on',
                'first_handover_person', 'handed_over_on', 'asset_return_date',
            ]);
        }
        // SIMs may move between ITL / IMS / ISP via the company dropdown
        $updatingSim = $category === 'mobile_phone' && (
            self::toBool($body['is_sim'] ?? false) || self::toBool($asset['is_sim'] ?? false)
        );
        if ($updatingSim) {
            $skipOnUpdate = array_values(array_filter(
                $skipOnUpdate,
                static fn (string $col) => $col !== 'company_id'
            ));
        }
        // Other assets: user_name is the first assigned user — keep it once set
        if ($category === 'other') {
            $existingFirst = trim((string) ($asset['user_name'] ?? ''));
            if ($existingFirst !== '') {
                $skipOnUpdate[] = 'user_name';
            }
        }
        $allowed = array_diff(self::TABLE_COLUMNS[$table], $skipOnUpdate);

        foreach ($allowed as $f) {
            if (! array_key_exists($f, $body)) {
                continue;
            }
            $sets[] = "{$f} = :{$f}";
            $val = $body[$f];
            if (in_array($f, ['location_id', 'department_id', 'supplier_id', 'purchase_amount_lkr', 'ram_gb', 'storage_gb', 'hdd_gb', 'ssd_gb'], true)) {
                $val = self::numericOrNull($val);
            }
            if (in_array($f, ['has_power_cable', 'has_vga_cable', 'has_ups', 'has_keyboard', 'has_mouse', 'has_charger', 'has_data_cable', 'has_back_cover', 'newly_purchased', 'is_legacy', 'is_sim'], true)) {
                // PDO+pgsql sends PHP false as "" which breaks boolean columns
                $val = self::toBool($val) ? 'true' : 'false';
            }
            $bind[$f] = $val === '' ? null : $val;
        }

        // Keep UPS model/brand in sync when toggling has_ups on update
        if ($category === 'pc' && array_key_exists('has_ups', $bind)) {
            $upsOn = $bind['has_ups'] === true || $bind['has_ups'] === 'true' || $bind['has_ups'] === 1 || $bind['has_ups'] === '1';
            if ($upsOn) {
                $model = $bind['ups_model'] ?? $body['ups_model'] ?? $asset['ups_model'] ?? null;
                if ($model === null || $model === '') {
                    $bind['ups_model'] = '650';
                    if (! in_array('ups_model = :ups_model', $sets, true)) {
                        $sets[] = 'ups_model = :ups_model';
                    }
                }
            } else {
                $bind['ups_model'] = null;
                $bind['ups_brand'] = null;
                $bind['ups_purchase_date'] = null;
                $bind['ups_warranty_period'] = null;
                $bind['ups_warranty_expires_on'] = null;
                if (! in_array('ups_model = :ups_model', $sets, true)) {
                    $sets[] = 'ups_model = :ups_model';
                }
                if (! in_array('ups_brand = :ups_brand', $sets, true)) {
                    $sets[] = 'ups_brand = :ups_brand';
                }
                if (! in_array('ups_purchase_date = :ups_purchase_date', $sets, true)) {
                    $sets[] = 'ups_purchase_date = :ups_purchase_date';
                }
                if (! in_array('ups_warranty_period = :ups_warranty_period', $sets, true)) {
                    $sets[] = 'ups_warranty_period = :ups_warranty_period';
                }
                if (! in_array('ups_warranty_expires_on = :ups_warranty_expires_on', $sets, true)) {
                    $sets[] = 'ups_warranty_expires_on = :ups_warranty_expires_on';
                }
            }
        }

        $row = null;
        try {
            $this->pdo->beginTransaction();

            $sql = 'UPDATE ' . $table . ' SET ' . implode(', ', $sets) . ' WHERE id = :id RETURNING *';
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($bind);
            $row = $stmt->fetch();
            if (! is_array($row)) {
                throw new \RuntimeException('Update returned no row');
            }

            // Manual status changes — status only; do not clear current holder on Available
            $statusInBody = array_key_exists('status', $body);
            $newStatus = $statusInBody ? strtolower(trim((string) ($body['status'] ?? ''))) : '';
            $oldStatus = strtolower(trim((string) ($asset['status'] ?? '')));
            if ($statusInBody && $newStatus !== '' && $newStatus !== $oldStatus) {
                $note = trim((string) ($request->input('status_note') ?? $body['status_note'] ?? ''));
                $this->recordStatusChange(
                    $category,
                    $id,
                    (int) $asset['company_id'],
                    $oldStatus,
                    $newStatus,
                    $note !== '' ? $note : null,
                    $user,
                    (string) ($asset['asset_tag'] ?? '')
                );
            }
            // Setting Available in inventory → always re-queue on Handover Reports
            // (even if it was already available / previously removed from the list)
            if (
                $statusInBody
                && $newStatus === 'available'
                && in_array($category, ['laptop', 'mobile_phone'], true)
            ) {
                $this->queueHandoverReportOnAvailable($category, $id, $user);
            }

            // Rename / clear current holder from details form (laptop / phone / PC Name field)
            // Available still requires / keeps the current holder name — only disposed/retired drop custody.
            if (in_array($category, ['laptop', 'mobile_phone', 'pc'], true)) {
                $holderProvided = array_key_exists('allocated_person', $body)
                    || array_key_exists('pc_name', $body)
                    || array_key_exists('name', $request->body);
                $holder = trim((string) (
                    $body['allocated_person']
                    ?? $request->input('allocated_person')
                    ?? $body['pc_name']
                    ?? $request->input('pc_name')
                    ?? $request->input('name')
                    ?? ''
                ));
                $effectiveStatus = $newStatus !== '' ? $newStatus : $oldStatus;
                $endsCustody = in_array($effectiveStatus, ['disposed', 'retired'], true);
                $sync = new HandoverSlotSync($this->pdo);

                if ($endsCustody && $holderProvided && $holder === '') {
                    // Disposed/retired with blank Name → clear current holder
                    $this->pdo->prepare(
                        "UPDATE {$table} SET
                            pc_name = NULL,
                            allocated_person = NULL,
                            allocated_on = NULL,
                            updated_at = NOW()
                         WHERE id = :id"
                    )->execute(['id' => $id]);
                    $sync->sync($category, $id);
                } elseif ($holder !== '' || ! $endsCustody) {
                    $handoverCount = $sync->count($category, $id);
                    // Only when there has never been a 2nd/3rd owner may we rename original + slot 1
                    $soleHolder = $handoverCount <= 1;

                    // Keep / reopen open handover so Name survives status-only edits (incl. Available)
                    if (! $endsCustody) {
                        $this->ensureOpenHandoverForDeployed(
                            $category,
                            $id,
                            $holder !== '' ? $holder : null,
                            $user
                        );
                    }

                    $open = $this->pdo->prepare(
                        'SELECT id FROM asset_handovers
                         WHERE asset_id = :id AND asset_type = :type AND is_open = TRUE
                         ORDER BY id DESC LIMIT 1'
                    );
                    $open->execute(['id' => $id, 'type' => $category]);
                    $openId = $open->fetchColumn();

                    if ($openId && $holder !== '') {
                        // Rename ONLY the current open handover — never previous owners
                        $this->pdo->prepare(
                            'UPDATE asset_handovers SET assigned_person_name = :p, updated_at = NOW() WHERE id = :hid'
                        )->execute(['p' => $holder, 'hid' => (int) $openId]);
                    }

                    if ($holder !== '' && $soleHolder) {
                        // Single owner ever: keep original / slot 1 / first history row aligned
                        $first = $this->pdo->prepare(
                            'SELECT id FROM asset_handovers
                             WHERE asset_id = :id AND asset_type = :type
                             ORDER BY id ASC LIMIT 1'
                        );
                        $first->execute(['id' => $id, 'type' => $category]);
                        $firstId = $first->fetchColumn();
                        if ($firstId && (int) $firstId !== (int) ($openId ?: 0)) {
                            $this->pdo->prepare(
                                'UPDATE asset_handovers SET assigned_person_name = :p, updated_at = NOW() WHERE id = :hid'
                            )->execute(['p' => $holder, 'hid' => (int) $firstId]);
                        }

                        $this->pdo->prepare(
                            "UPDATE {$table} SET
                                pc_name = :p_pc,
                                allocated_person = :p_alloc,
                                handover_person_1 = :p_h1,
                                original_assigned_person = :p_orig,
                                allocated_on = COALESCE(allocated_on, CURRENT_DATE),
                                handover_on_1 = COALESCE(handover_on_1, CURRENT_DATE),
                                original_assigned_on = COALESCE(original_assigned_on, CURRENT_DATE),
                                updated_at = NOW()
                             WHERE id = :id"
                        )->execute([
                            'p_pc' => $holder,
                            'p_alloc' => $holder,
                            'p_h1' => $holder,
                            'p_orig' => $holder,
                            'id' => $id,
                        ]);
                    } elseif ($holder !== '') {
                        // Multiple owners in history: only current allocated + display name change
                        $this->pdo->prepare(
                            "UPDATE {$table} SET
                                pc_name = :p_pc,
                                allocated_person = :p_alloc,
                                allocated_on = COALESCE(allocated_on, CURRENT_DATE),
                                updated_at = NOW()
                             WHERE id = :id"
                        )->execute([
                            'p_pc' => $holder,
                            'p_alloc' => $holder,
                            'id' => $id,
                        ]);
                    }

                    $sync->sync($category, $id);
                }
            }

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error(
                'Could not update asset: ' . $e->getMessage(),
                422
            );
            return;
        }

        // Keep Kit tab aligned with PC accessories / storage fields from Asset details
        if ($category === 'pc') {
            try {
                (new PcKitController($this->pdo))->syncPc($id);
            } catch (\Throwable) {
                // kit sync is best-effort
            }
        }

        $detailed = $this->findDetailed($category, $id);
        if (is_array($detailed)) {
            $detailed['category'] = $category;
            // Prefer live open custody; do not fall back to originally-assigned when returned
            $openHolder = $this->pdo->prepare(
                'SELECT assigned_person_name, handover_date FROM asset_handovers
                 WHERE asset_id = :id AND asset_type = :type AND is_open = TRUE
                 ORDER BY id DESC LIMIT 1'
            );
            $openHolder->execute(['id' => $id, 'type' => $category]);
            $openRow = $openHolder->fetch(PDO::FETCH_ASSOC);
            if (is_array($openRow) && trim((string) ($openRow['assigned_person_name'] ?? '')) !== '') {
                $holderOut = trim((string) $openRow['assigned_person_name']);
                $detailed['handover_open'] = true;
                $detailed['allocated_person'] = $holderOut;
                $detailed['assigned_person_name'] = $holderOut;
                $detailed['current_holder'] = $holderOut;
                if (! empty($openRow['handover_date'])) {
                    $detailed['allocated_on'] = $openRow['handover_date'];
                }
            } else {
                $holderOut = trim((string) ($detailed['allocated_person'] ?? ''));
                $detailed['handover_open'] = false;
                $detailed['allocated_person'] = $holderOut !== '' ? $holderOut : null;
                $detailed['assigned_person_name'] = $detailed['allocated_person'];
                $detailed['current_holder'] = $detailed['allocated_person'];
            }
            $origOut = trim((string) ($detailed['original_assigned_person'] ?? ''));
            $detailed['allocated_is_original'] = $origOut !== ''
                && $holderOut !== ''
                && strcasecmp($origOut, $holderOut) === 0;
            $detailed['handovers'] = $this->handoverHistory($category, $id);
            Response::json(['data' => $detailed]);
            return;
        }

        if (is_array($row)) {
            $row['category'] = $category;
        }
        Response::json(['data' => $row]);
    }

    public function destroy(Request $request, array $user, array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $category = $this->resolveCategory($request, $params);
        if ($category === null || $id < 1) {
            Response::error('category and id required', 422);
            return;
        }

        $asset = $this->find($category, $id);
        if ($asset === null) {
            Response::error('Asset not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $asset['company_id']);
        $table = self::TABLES[$category];

        try {
            $this->pdo->beginTransaction();
            $this->pdo->prepare(
                'DELETE FROM handover_peripheral_checklist
                 WHERE handover_id IN (
                    SELECT id FROM asset_handovers WHERE asset_id = :id AND asset_type = :asset_type
                 )'
            )->execute(['id' => $id, 'asset_type' => $category]);
            $this->pdo->prepare(
                'DELETE FROM asset_handovers WHERE asset_id = :id AND asset_type = :asset_type'
            )->execute(['id' => $id, 'asset_type' => $category]);
            $this->pdo->prepare(
                'UPDATE credentials SET asset_id = NULL, asset_type = NULL
                 WHERE asset_id = :id AND (asset_type = :asset_type OR asset_type IS NULL)'
            )->execute(['id' => $id, 'asset_type' => $category]);
            $this->pdo->prepare('DELETE FROM ' . $table . ' WHERE id = :id')->execute(['id' => $id]);
            $this->pdo->commit();
        } catch (\Throwable) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Could not delete asset', 422);
            return;
        }

        Response::json(['ok' => true]);
    }

    /** @return list<string> */
    private function resolveListCategories(string $category): array
    {
        if ($category === 'others') {
            return ['other'];
        }
        return isset(self::TABLES[$category]) ? [$category] : [];
    }

    /** @param array<string, string> $params */
    private function resolveCategory(Request $request, array $params): ?string
    {
        $raw = (string) ($params['category'] ?? $request->input('category', ''));
        if ($raw === 'others') {
            return null;
        }
        return isset(self::TABLES[$raw]) ? $raw : null;
    }

    private function selectListSql(
        string $table,
        string $category,
        string $alias,
        ?string $companyCode = null,
        ?string $companyShort = null
    ): string {
        // Lean list: denormalized assignment fields + location name only (no dept/supplier/handover joins).
        if ($category === 'mobile_phone') {
            $extra = ", {$alias}.imei_number, {$alias}.imei_number_2, {$alias}.phone_number,
                       {$alias}.first_handover_person, {$alias}.handed_over_on, {$alias}.asset_return_date,
                       {$alias}.condition_code, {$alias}.accessories,
                       {$alias}.handover_person_1, {$alias}.handover_person_2, {$alias}.handover_person_3, {$alias}.handover_person_4,
                       {$alias}.handover_person_5, {$alias}.handover_person_6, {$alias}.handover_person_7, {$alias}.handover_person_8,
                       {$alias}.handover_person_9, {$alias}.handover_person_10,
                       {$alias}.handover_on_1, {$alias}.handover_on_2, {$alias}.handover_on_3, {$alias}.handover_on_4,
                       {$alias}.handover_on_5, {$alias}.handover_on_6, {$alias}.handover_on_7, {$alias}.handover_on_8,
                       {$alias}.handover_on_9, {$alias}.handover_on_10,
                       {$alias}.original_assigned_person, {$alias}.original_assigned_on,
                       {$alias}.allocated_person, {$alias}.allocated_on,
                       NULL::varchar AS user_name, NULL::varchar AS item_name,
                       {$alias}.warranty_period, {$alias}.warranty_expires_on,
                       NULL::text AS specification,
                       {$alias}.has_charger, {$alias}.has_data_cable, {$alias}.has_back_cover,
                       {$alias}.is_legacy, {$alias}.is_sim,
                       {$alias}.former_asset_tag, {$alias}.transferred_from_company_id, {$alias}.company_transferred_at,
                       {$alias}.company_id AS current_company_id";
        } elseif ($category === 'laptop') {
            $extra = ", NULL::varchar AS imei_number, NULL::varchar AS imei_number_2, NULL::varchar AS phone_number,
                       NULL::varchar AS first_handover_person, NULL::date AS handed_over_on, NULL::date AS asset_return_date,
                       NULL::varchar AS condition_code, NULL::text AS accessories,
                       {$alias}.handover_person_1, {$alias}.handover_person_2, {$alias}.handover_person_3, {$alias}.handover_person_4,
                       {$alias}.handover_person_5, {$alias}.handover_person_6, {$alias}.handover_person_7, {$alias}.handover_person_8,
                       {$alias}.handover_on_1, {$alias}.handover_on_2, {$alias}.handover_on_3, {$alias}.handover_on_4,
                       {$alias}.handover_on_5, {$alias}.handover_on_6, {$alias}.handover_on_7, {$alias}.handover_on_8,
                       {$alias}.original_assigned_person, {$alias}.original_assigned_on,
                       {$alias}.allocated_person, {$alias}.allocated_on,
                       NULL::varchar AS user_name, NULL::varchar AS item_name,
                       NULL::varchar AS warranty_period, {$alias}.warranty_expires_on,
                       NULL::text AS specification,
                       {$alias}.cpu, {$alias}.ram_gb, {$alias}.storage_gb, {$alias}.purchase_date,
                       {$alias}.hdd_gb, {$alias}.ssd_gb,
                       NULL::boolean AS has_charger, NULL::boolean AS has_data_cable, NULL::boolean AS has_back_cover,
                       NULL::boolean AS has_keyboard, {$alias}.has_mouse,
                       {$alias}.is_legacy,
                       {$alias}.former_asset_tag, {$alias}.transferred_from_company_id, {$alias}.company_transferred_at,
                       {$alias}.company_id AS current_company_id";
        } elseif ($category === 'other') {
            $extra = ", NULL::varchar AS imei_number, NULL::varchar AS imei_number_2, NULL::varchar AS phone_number,
                       NULL::varchar AS first_handover_person, NULL::date AS handed_over_on, NULL::date AS asset_return_date,
                       NULL::varchar AS condition_code, NULL::text AS accessories,
                       NULL::varchar AS handover_person_1, NULL::varchar AS handover_person_2,
                       NULL::varchar AS handover_person_3, NULL::varchar AS handover_person_4,
                       NULL::varchar AS handover_person_5, NULL::varchar AS handover_person_6,
                       NULL::varchar AS handover_person_7, NULL::varchar AS handover_person_8,
                       NULL::date AS handover_on_1, NULL::date AS handover_on_2,
                       NULL::date AS handover_on_3, NULL::date AS handover_on_4,
                       NULL::date AS handover_on_5, NULL::date AS handover_on_6,
                       NULL::date AS handover_on_7, NULL::date AS handover_on_8,
                       NULL::varchar AS original_assigned_person, NULL::date AS original_assigned_on,
                       NULL::varchar AS allocated_person, NULL::date AS allocated_on,
                       {$alias}.user_name, {$alias}.item_name,
                       {$alias}.warranty_period, {$alias}.specification,
                       NULL::varchar AS monitor_brand, NULL::boolean AS has_power_cable,
                       NULL::boolean AS has_vga_cable, NULL::boolean AS has_ups,
                       NULL::varchar AS ups_brand, NULL::varchar AS ups_model,
                       NULL::boolean AS has_keyboard, NULL::boolean AS has_mouse,
                       NULL::boolean AS has_charger, NULL::boolean AS has_data_cable, NULL::boolean AS has_back_cover,
                       NULL::boolean AS is_legacy,
                       {$alias}.former_asset_tag, {$alias}.transferred_from_company_id, {$alias}.company_transferred_at,
                       {$alias}.company_id AS current_company_id";
        } elseif ($category === 'pc') {
            $extra = ", NULL::varchar AS imei_number, NULL::varchar AS imei_number_2, NULL::varchar AS phone_number,
                       NULL::varchar AS first_handover_person, NULL::date AS handed_over_on, NULL::date AS asset_return_date,
                       NULL::varchar AS condition_code, NULL::text AS accessories,
                       {$alias}.handover_person_1, {$alias}.handover_person_2, {$alias}.handover_person_3, {$alias}.handover_person_4,
                       {$alias}.handover_person_5, {$alias}.handover_person_6, {$alias}.handover_person_7, {$alias}.handover_person_8,
                       {$alias}.handover_on_1, {$alias}.handover_on_2, {$alias}.handover_on_3, {$alias}.handover_on_4,
                       {$alias}.handover_on_5, {$alias}.handover_on_6, {$alias}.handover_on_7, {$alias}.handover_on_8,
                       {$alias}.original_assigned_person, {$alias}.original_assigned_on,
                       {$alias}.allocated_person, {$alias}.allocated_on,
                       NULL::varchar AS user_name, NULL::varchar AS item_name,
                       {$alias}.warranty_period, {$alias}.warranty_expires_on,
                       NULL::text AS specification,
                       {$alias}.monitor_brand, {$alias}.has_power_cable, {$alias}.has_vga_cable,
                       {$alias}.has_ups, {$alias}.ups_brand, {$alias}.ups_model,
                       {$alias}.ups_purchase_date, {$alias}.ups_warranty_period, {$alias}.ups_warranty_expires_on,
                       {$alias}.has_keyboard, {$alias}.has_mouse,
                       {$alias}.cpu, {$alias}.ram_gb, {$alias}.storage_gb, {$alias}.purchase_date,
                       {$alias}.hdd_gb, {$alias}.ssd_gb, {$alias}.windows_version,
                       NULL::boolean AS has_charger, NULL::boolean AS has_data_cable, NULL::boolean AS has_back_cover,
                       NULL::boolean AS is_legacy,
                       {$alias}.former_asset_tag, {$alias}.transferred_from_company_id, {$alias}.company_transferred_at,
                       {$alias}.company_id AS current_company_id";
        } else {
            $extra = ", NULL::varchar AS imei_number, NULL::varchar AS imei_number_2, NULL::varchar AS phone_number,
                       NULL::varchar AS first_handover_person, NULL::date AS handed_over_on, NULL::date AS asset_return_date,
                       NULL::varchar AS condition_code, NULL::text AS accessories,
                       NULL::varchar AS handover_person_1, NULL::varchar AS handover_person_2,
                       NULL::varchar AS handover_person_3, NULL::varchar AS handover_person_4,
                       NULL::varchar AS handover_person_5, NULL::varchar AS handover_person_6,
                       NULL::varchar AS handover_person_7, NULL::varchar AS handover_person_8,
                       NULL::date AS handover_on_1, NULL::date AS handover_on_2,
                       NULL::date AS handover_on_3, NULL::date AS handover_on_4,
                       NULL::date AS handover_on_5, NULL::date AS handover_on_6,
                       NULL::date AS handover_on_7, NULL::date AS handover_on_8,
                       NULL::varchar AS original_assigned_person, NULL::date AS original_assigned_on,
                       NULL::varchar AS allocated_person, NULL::date AS allocated_on,
                       NULL::varchar AS user_name, NULL::varchar AS item_name,
                       NULL::varchar AS warranty_period, NULL::text AS specification,
                       NULL::varchar AS monitor_brand, NULL::boolean AS has_power_cable,
                       NULL::boolean AS has_vga_cable, NULL::boolean AS has_ups,
                       NULL::varchar AS ups_brand, NULL::varchar AS ups_model,
                       NULL::boolean AS has_keyboard, NULL::boolean AS has_mouse,
                       NULL::boolean AS has_charger, NULL::boolean AS has_data_cable, NULL::boolean AS has_back_cover,
                       NULL::boolean AS is_legacy,
                       {$alias}.former_asset_tag, {$alias}.transferred_from_company_id, {$alias}.company_transferred_at,
                       {$alias}.company_id AS current_company_id";
        }

        if (in_array($category, ['laptop', 'mobile_phone', 'pc'], true)) {
            // Current holder = open allocation only (do not fall back to slot 1 after return)
            $holderExpr = "NULLIF({$alias}.allocated_person, '')";
            $holderSinceExpr = "{$alias}.allocated_on";
            $isOriginalExpr = "CASE
                 WHEN {$holderExpr} IS NULL OR {$alias}.original_assigned_person IS NULL THEN FALSE
                 WHEN lower({$holderExpr}) = lower({$alias}.original_assigned_person) THEN TRUE
                 ELSE FALSE
               END";
        } else {
            $holderExpr = $category === 'other'
                ? "NULLIF({$alias}.user_name, '')"
                : 'NULL::varchar';
            $holderSinceExpr = $category === 'other'
                ? "{$alias}.handover_date"
                : 'NULL::date';
            $isOriginalExpr = 'FALSE';
        }

        // Always join real company — needed so transferred-away rows show destination (ISP), not the filter tab
        $companySelect = 'c.short_name AS company_short, c.code AS company_code';
        $companyJoin = "JOIN companies c ON c.id = {$alias}.company_id";

        $deptSelect = in_array($category, ['other', 'mobile_phone'], true)
            ? 'd.name AS department_name'
            : 'NULL::varchar AS department_name';
        $deptJoin = in_array($category, ['other', 'mobile_phone'], true)
            ? "LEFT JOIN departments d ON d.id = {$alias}.department_id"
            : '';

        $handoverSelect = $category === 'other'
            ? "{$alias}.handover_date"
            : "{$holderSinceExpr} AS handover_date";

        return "SELECT {$alias}.id, {$alias}.asset_tag, {$alias}.pc_name, {$alias}.serial_number,
                       '{$category}'::text AS category, {$alias}.status,
                       {$alias}.brand, {$alias}.model, {$alias}.purchase_amount_lkr, {$alias}.invoice_no, {$alias}.notes,
                       {$alias}.updated_at
                       {$extra},
                       {$companySelect},
                       {$deptSelect}, l.name AS location_name,
                       NULL::varchar AS supplier_name,
                       {$handoverSelect},
                       NULL::date AS return_date,
                       ({$holderExpr} IS NOT NULL) AS handover_open,
                       {$holderExpr} AS assigned_person_name,
                       {$holderExpr} AS current_holder,
                       {$holderSinceExpr} AS current_holder_since,
                       NULL::int AS handover_no,
                       NULL::text AS current_handover_label,
                       {$isOriginalExpr} AS allocated_is_original
                FROM {$table} {$alias}
                {$companyJoin}
                {$deptJoin}
                LEFT JOIN locations l ON l.id = {$alias}.location_id";
    }

    /** @return array{id:int|string,code:string,short_name:string}|null */
    private function resolveCompanyByCode(string $code): ?array
    {
        static $cache = [];
        if (isset($cache[$code])) {
            return $cache[$code];
        }
        $stmt = $this->pdo->prepare(
            'SELECT id, code, short_name FROM companies WHERE code = :c AND is_active = TRUE LIMIT 1'
        );
        $stmt->execute(['c' => $code]);
        $row = $stmt->fetch();
        if (! is_array($row)) {
            return null;
        }
        $cache[$code] = $row;
        return $row;
    }

    /** @return array{id:int|string,code:string,short_name:string}|null */
    private function resolveCompanyById(int $id): ?array
    {
        static $cache = [];
        if (isset($cache[$id])) {
            return $cache[$id];
        }
        $stmt = $this->pdo->prepare(
            'SELECT id, code, short_name FROM companies WHERE id = :id AND is_active = TRUE LIMIT 1'
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (! is_array($row)) {
            return null;
        }
        $cache[$id] = $row;
        return $row;
    }

    /** @return array<string, mixed>|null */
    private function find(string $category, int $id): ?array
    {
        $table = self::TABLES[$category];
        $stmt = $this->pdo->prepare('SELECT * FROM ' . $table . ' WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (! $row) {
            return null;
        }
        $row['category'] = $category;
        return $row;
    }

    /** @return array<string, mixed>|null */
    private function findDetailed(string $category, int $id): ?array
    {
        $table = self::TABLES[$category];
        $personFallback = $category === 'mobile_phone' ? 'a.first_handover_person' : 'NULL';
        $handedFallback = $category === 'mobile_phone' ? 'a.handed_over_on' : 'NULL';
        $returnFallback = $category === 'mobile_phone' ? 'a.asset_return_date' : 'NULL';
        $supportsTransfer = in_array($category, ['laptop', 'mobile_phone', 'pc', 'other', 'printer'], true);
        $transferSelect = $supportsTransfer
            ? 'tfc.code AS transferred_from_company_code,
                       tfc.short_name AS transferred_from_company_short,'
            : 'NULL::varchar AS transferred_from_company_code,
                       NULL::varchar AS transferred_from_company_short,';
        $transferJoin = $supportsTransfer
            ? 'LEFT JOIN companies tfc ON tfc.id = a.transferred_from_company_id'
            : '';

        $sql = "SELECT a.*,
                       '{$category}'::text AS category,
                       c.short_name AS company_short, c.code AS company_code, c.name AS company_name,
                       d.name AS department_name, l.name AS location_name,
                       s.name AS supplier_name,
                       {$transferSelect}
                       h.return_date,
                       h.return_received_by_id,
                       rb.name AS return_handover_person,
                       h.handover_date,
                       h.is_open AS handover_open,
                       COALESCE(NULLIF(h.assigned_person_name, ''), ae.name, {$personFallback}) AS assigned_person_name,
                       ae.staff_id AS assigned_employee_staff_id,
                       COALESCE(h.handover_date, {$handedFallback}) AS handed_over_display,
                       COALESCE(h.return_date, {$returnFallback}) AS return_date_display
                FROM {$table} a
                JOIN companies c ON c.id = a.company_id
                {$transferJoin}
                LEFT JOIN departments d ON d.id = a.department_id
                LEFT JOIN locations l ON l.id = a.location_id
                LEFT JOIN suppliers s ON s.id = a.supplier_id
                LEFT JOIN LATERAL (
                    SELECT * FROM asset_handovers ah
                    WHERE ah.asset_id = a.id AND ah.asset_type = '{$category}' AND ah.is_open = TRUE
                    ORDER BY ah.id DESC
                    LIMIT 1
                ) h ON TRUE
                LEFT JOIN users rb ON rb.id = h.return_received_by_id
                LEFT JOIN users ae ON ae.id = h.assigned_employee_id
                WHERE a.id = :id
                LIMIT 1";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function nextAssetTag(
        int $companyId,
        string $category,
        string $table,
        ?int $locationId = null,
        bool $isLegacy = false,
    ): string {
        $stmt = $this->pdo->prepare('SELECT code FROM companies WHERE id = :id');
        $stmt->execute(['id' => $companyId]);
        $code = strtoupper((string) ($stmt->fetchColumn() ?: 'IT'));

        // UI / inventory labels: ITL, IMS, ISP, SIM (IT company code → ITL on tags)
        $companyPrefix = match ($code) {
            'IT', 'ITL' => 'ITL',
            'IMS' => 'IMS',
            'ISP' => 'ISP',
            'FOTON' => 'FOTON',
            'SIM' => 'SIM',
            default => $code,
        };

        // Branch desktop PCs: {COMPANY}-{BRANCH}-PC-0001 (sequence restarts per branch)
        if ($category === 'pc') {
            return $this->nextBranchScopedTag($companyId, $table, $companyPrefix, $locationId, 'PC', 4);
        }

        // Other assets share one table — sequence is per company + branch: ITL-KHO-001 (no type token)
        if ($category === 'other') {
            return $this->nextBranchScopedTag($companyId, $table, $companyPrefix, $locationId, '', 3);
        }

        $typeCode = match ($category) {
            'laptop' => 'LAP',
            'mobile_phone' => 'MB',
            'printer' => 'PR',
            default => 'OT',
        };

        // Old / pre-Excel stock: short IDs e.g. IT-LAP-01, IT-MB-01 (separate from ITL-LAP-0001)
        if ($isLegacy && in_array($category, ['laptop', 'mobile_phone'], true)) {
            return $this->nextOldStockTag($companyId, $table, $code, $typeCode);
        }

        $tagPrefix = $companyPrefix . '-' . $typeCode;
        // Also count legacy short codes (e.g. ISP-LP-*, IT-LAP-*) so numbering never restarts at 0001
        // Exclude 1–2 digit old-stock tags (IT-LAP-01) from the main 0001 series
        $legacyType = match ($category) {
            'laptop' => 'LP',
            'mobile_phone' => 'MB',
            'printer' => 'PR',
            default => $typeCode,
        };
        $legacyPrefix = $companyPrefix . '-' . $legacyType;
        $altCompany = $companyPrefix === 'ITL' ? 'IT' : null;

        $patterns = [
            '^' . preg_quote($tagPrefix, '/') . '-[0-9]{3,}$',
        ];
        if ($legacyPrefix !== $tagPrefix) {
            $patterns[] = '^' . preg_quote($legacyPrefix, '/') . '-[0-9]{3,}$';
        }
        if ($altCompany !== null) {
            $patterns[] = '^' . preg_quote($altCompany . '-' . $typeCode, '/') . '-[0-9]{3,}$';
            if ($legacyType !== $typeCode) {
                $patterns[] = '^' . preg_quote($altCompany . '-' . $legacyType, '/') . '-[0-9]{3,}$';
            }
        }

        $maxSeen = 0;
        $maxStmt = $this->pdo->prepare(
            "SELECT COALESCE(MAX(
                CAST(NULLIF(substring(asset_tag from '[0-9]+$'), '') AS INTEGER)
             ), 0)
             FROM {$table}
             WHERE company_id = :company_id
               AND asset_tag ~ :pattern"
        );
        foreach ($patterns as $pattern) {
            $maxStmt->execute([
                'company_id' => $companyId,
                'pattern' => $pattern,
            ]);
            $maxSeen = max($maxSeen, (int) $maxStmt->fetchColumn());
        }
        $next = $maxSeen + 1;

        return sprintf('%s-%04d', $tagPrefix, $next);
    }

    /**
     * Old stock tags: IT-LAP-01 / IMS-MB-01 (2-digit), kept separate from ITL-LAP-0001 series.
     */
    private function nextOldStockTag(
        int $companyId,
        string $table,
        string $companyCode,
        string $typeCode,
    ): string {
        $oldPrefix = match (strtoupper($companyCode)) {
            'IT', 'ITL' => 'IT',
            'IMS' => 'IMS',
            'ISP' => 'ISP',
            'FOTON' => 'FOTON',
            'SIM' => 'SIM',
            default => strtoupper($companyCode),
        };
        $tagPrefix = $oldPrefix . '-' . $typeCode;
        // Only 1–2 digit suffixes count as old-stock series (not IT-LAP-0059)
        $pattern = '^' . preg_quote($tagPrefix, '/') . '-[0-9]{1,2}$';

        $maxStmt = $this->pdo->prepare(
            "SELECT COALESCE(MAX(
                CAST(NULLIF(substring(asset_tag from '[0-9]+$'), '') AS INTEGER)
             ), 0)
             FROM {$table}
             WHERE company_id = :company_id
               AND asset_tag ~ :pattern"
        );
        $maxStmt->execute([
            'company_id' => $companyId,
            'pattern' => $pattern,
        ]);
        $next = ((int) $maxStmt->fetchColumn()) + 1;
        if ($next > 99) {
            throw new \RuntimeException('Old stock ID series is full (01–99)');
        }

        return sprintf('%s-%02d', $tagPrefix, $next);
    }

    /**
     * Branch-scoped tags in shared tables (pcs / other_assets).
     * Examples: ITL-KHO-PC-0001, ITL-KHO-001, IMS-201-001
     * Numbering restarts per company + branch (+ type when set) — never from other branches
     * in the same table.
     */
    private function nextBranchScopedTag(
        int $companyId,
        string $table,
        string $companyPrefix,
        ?int $locationId,
        string $typeCode,
        int $padWidth,
    ): string {
        if ($locationId === null || $locationId < 1) {
            throw new \InvalidArgumentException('location_id is required for branch asset tags');
        }

        $locStmt = $this->pdo->prepare(
            'SELECT code FROM locations WHERE id = :id AND company_id = :company_id'
        );
        $locStmt->execute([
            'id' => $locationId,
            'company_id' => $companyId,
        ]);
        $locationCode = $locStmt->fetchColumn();
        if ($locationCode === false || $locationCode === null || trim((string) $locationCode) === '') {
            throw new \RuntimeException('Branch / location not found for this company');
        }

        $branchCode = $this->locationTagCode((string) $locationCode);
        $type = strtoupper(trim($typeCode));
        $tagPrefix = $type === ''
            ? $companyPrefix . '-' . $branchCode
            : $companyPrefix . '-' . $branchCode . '-' . $type;

        // Match only this exact prefix so other-branch / other-type rows in the same table
        // (and legacy tags like "001" or "ITL-KHO-OTH-001") do not advance the sequence.
        $pattern = '^' . preg_quote($tagPrefix, '/') . '-[0-9]+$';
        $maxStmt = $this->pdo->prepare(
            "SELECT COALESCE(MAX(
                CAST(NULLIF(substring(asset_tag from '[0-9]+$'), '') AS INTEGER)
             ), 0)
             FROM {$table}
             WHERE company_id = :company_id
               AND asset_tag ~ :pattern"
        );
        $maxStmt->execute([
            'company_id' => $companyId,
            'pattern' => $pattern,
        ]);
        $next = ((int) $maxStmt->fetchColumn()) + 1;
        $pad = max(3, min(6, $padWidth));

        return sprintf('%s-%0' . $pad . 'd', $tagPrefix, $next);
    }

    /**
     * Short branch token embedded in PC / other asset tags.
     */
    private function locationTagCode(string $locationCode): string
    {
        $code = strtoupper(trim($locationCode));
        if (preg_match('/^BR_(\d+)$/', $code, $m)) {
            return $m[1];
        }

        $known = [
            'KANDY_HO' => 'KHO',
            'KANDY' => 'KDY',
            'CMB_BR' => 'CMB',
            'RAMANAYAKE' => 'RAM',
            'NEGOMBO' => 'NEG',
            'KELANI' => 'KEL',
            'JA_ELA' => 'JAE',
            'MATHARA' => 'MAT',
            'ANURADHAPURA' => 'ANU',
            'HYDEPARK' => 'HYD',
            'EMBILIPITIYA' => 'EMB',
            'GAMPOLA' => 'GAM',
            'FOTON_JAELA' => 'FJA',
            'FOTON_KANDY' => 'FKD',
            'FOTON_KELANI' => 'FKE',
            'FOTON_JA_ELA' => 'FJA',
        ];
        if (isset($known[$code])) {
            return $known[$code];
        }

        $clean = preg_replace('/[^A-Z0-9]/', '', $code) ?: 'BR';
        return substr((string) $clean, 0, 6);
    }

    private function resolveSupplierId(int $companyId, Request $request): ?int
    {
        if ($request->input('supplier_id')) {
            return (int) $request->input('supplier_id');
        }
        $name = trim((string) ($request->input('supplier_name') ?: $request->input('supplier') ?: ''));
        if ($name === '') {
            return null;
        }
        $find = $this->pdo->prepare(
            'SELECT id FROM suppliers WHERE company_id = :c AND lower(name) = lower(:n) LIMIT 1'
        );
        $find->execute(['c' => $companyId, 'n' => $name]);
        $id = $find->fetchColumn();
        if ($id) {
            return (int) $id;
        }
        $ins = $this->pdo->prepare(
            'INSERT INTO suppliers (company_id, name, is_active) VALUES (:c, :n, TRUE) RETURNING id'
        );
        $ins->execute(['c' => $companyId, 'n' => $name]);
        return (int) $ins->fetchColumn();
    }

    /**
     * @return array<string, mixed>
     */
    private function buildPayload(
        Request $request,
        array $user,
        int $companyId,
        ?int $supplierId,
        string $assetTag,
        string $category
    ): array {
        $all = [
            'company_id' => $companyId,
            'location_id' => $request->input('location_id') ?: null,
            'department_id' => $request->input('department_id') ?: null,
            'supplier_id' => $supplierId,
            'asset_tag' => $assetTag,
            'serial_number' => $request->input('serial_number') ?: null,
            'brand' => $request->input('brand') ?: null,
            'model' => $request->input('model') ?: null,
            'status' => $request->input('status') ?: 'available',
            'pc_name' => $request->input('pc_name') ?: $request->input('name') ?: null,
            'user_name' => $request->input('user_name')
                ?: $request->input('name')
                ?: $request->input('pc_name')
                ?: null,
            'item_name' => $request->input('item_name') ?: $request->input('item') ?: null,
            'cpu' => $request->input('cpu') ?: $request->input('processor') ?: null,
            'ram_gb' => self::numericOrNull($request->input('ram_gb', $request->input('ram'))),
            'hdd_gb' => self::numericOrNull($request->input('hdd_gb', $request->input('hdd'))),
            'ssd_gb' => self::numericOrNull($request->input('ssd_gb', $request->input('ssd'))),
            'storage_gb' => self::numericOrNull($request->input('storage_gb', $request->input('capacity'))),
            'storage_type' => $request->input('storage_type') ?: 'unknown',
            'invoice_no' => $request->input('invoice_no') ?: null,
            'purchase_amount_lkr' => $request->input('purchase_amount_lkr') ?: $request->input('amount') ?: null,
            'purchase_date' => $request->input('purchase_date') ?: $request->input('date') ?: null,
            'warranty_period' => $request->input('warranty_period') ?: null,
            'warranty_expires_on' => $request->input('warranty_expires_on') ?: $request->input('warranty') ?: null,
            'ups_purchase_date' => $request->input('ups_purchase_date') ?: null,
            'ups_warranty_period' => $request->input('ups_warranty_period') ?: null,
            'ups_warranty_expires_on' => $request->input('ups_warranty_expires_on') ?: null,
            'specification' => $request->input('specification') ?: null,
            'handover_date' => $request->input('handover_date') ?: null,
            'imei_number' => $request->input('imei_number') ?: $request->input('imei') ?: null,
            'imei_number_2' => $request->input('imei_number_2') ?: null,
            'phone_number' => $request->input('phone_number') ?: $request->input('phone_no') ?: null,
            'condition_code' => $request->input('condition_code') ?: null,
            'accessories' => $request->input('accessories') ?: null,
            'has_charger' => self::toBool($request->input('has_charger', true)),
            'has_data_cable' => self::toBool($request->input('has_data_cable', true)),
            'has_back_cover' => self::toBool($request->input('has_back_cover', true)),
            'first_handover_person' => $request->input('first_handover_person') ?: null,
            'handed_over_on' => $request->input('handed_over_on') ?: $request->input('handed_over_date') ?: null,
            'asset_return_date' => $request->input('asset_return_date') ?: $request->input('return_date') ?: null,
            'notes' => $request->input('notes') ?: $request->input('other') ?: null,
            'monitor_brand' => $request->input('monitor_brand') ?: null,
            'windows_version' => $request->input('windows_version') ?: null,
            'has_power_cable' => self::toBool($request->input('has_power_cable')),
            'has_vga_cable' => self::toBool($request->input('has_vga_cable')),
            'has_ups' => self::toBool($request->input('has_ups')),
            'has_keyboard' => self::toBool($request->input('has_keyboard')),
            'has_mouse' => self::toBool($request->input('has_mouse')),
            'ups_brand' => $request->input('ups_brand') ?: null,
            'ups_model' => $request->input('ups_model') ?: null,
            // Adding a PC = newly purchased register entry (PCs tab)
            'newly_purchased' => true,
            // Laptop/phone: old (pre-Excel) stock sorts to bottom; new stays at top
            'is_legacy' => self::toBool(
                $request->input('is_legacy', $request->input('entry_type') === 'old')
            ),
            'is_sim' => self::toBool($request->input('is_sim')),
            'created_by' => $user['id'],
            'updated_by' => $user['id'],
        ];

        // SIM cards: default model label when blank
        if ($category === 'mobile_phone' && ! empty($all['is_sim']) && ($all['model'] === null || $all['model'] === '')) {
            $all['model'] = 'SIM';
        }

        // Default UPS model when UPS is present and model left blank
        if (! empty($all['has_ups']) && ($all['ups_model'] === null || $all['ups_model'] === '')) {
            $all['ups_model'] = '650';
        }
        if (empty($all['has_ups'])) {
            $all['ups_model'] = null;
            $all['ups_brand'] = null;
            $all['ups_purchase_date'] = null;
            $all['ups_warranty_period'] = null;
            $all['ups_warranty_expires_on'] = null;
        }

        // PCs / laptops: keep storage_gb as HDD + SSD total for legacy list/export fields
        if (in_array($category, ['pc', 'laptop'], true)) {
            $hdd = is_numeric($all['hdd_gb'] ?? null) ? (float) $all['hdd_gb'] : 0.0;
            $ssd = is_numeric($all['ssd_gb'] ?? null) ? (float) $all['ssd_gb'] : 0.0;
            if ($hdd > 0 || $ssd > 0) {
                $all['storage_gb'] = $hdd + $ssd;
                if ($hdd > 0 && $ssd > 0) {
                    $all['storage_type'] = 'hybrid';
                } elseif ($ssd > 0) {
                    $all['storage_type'] = 'ssd';
                } elseif ($hdd > 0) {
                    $all['storage_type'] = 'hdd';
                }
            }
        }

        // Laptops: fixed 2-year warranty from purchase date
        if ($category === 'laptop' && ! empty($all['purchase_date'])) {
            $void = self::addYears((string) $all['purchase_date'], 2);
            if ($void !== null) {
                $all['warranty_expires_on'] = $void;
            }
        }

        // Mobile phones: fixed 1-year warranty from originally assigned handover date
        if ($category === 'mobile_phone') {
            $handoverAnchor = $all['original_assigned_on']
                ?? $all['handed_over_on']
                ?? $all['purchase_date']
                ?? null;
            if (is_string($handoverAnchor) && $handoverAnchor !== '') {
                $void = self::addYears($handoverAnchor, 1);
                if ($void !== null) {
                    $all['warranty_expires_on'] = $void;
                    if (empty($all['warranty_period'])) {
                        $all['warranty_period'] = '1 year';
                    }
                }
            }
        }

        // Other assets: warranty void = purchased date + selected period
        if (($category === 'other' || $category === 'printer')
            && ! empty($all['purchase_date'])
            && ! empty($all['warranty_period'])
        ) {
            $otherExpiry = self::expiryFromPeriod(
                (string) $all['purchase_date'],
                (string) $all['warranty_period']
            );
            if ($otherExpiry !== null) {
                $all['warranty_expires_on'] = $otherExpiry;
            }
        }

        $table = self::TABLES[$category];
        $payload = [];
        foreach (self::TABLE_COLUMNS[$table] as $col) {
            if (array_key_exists($col, $all)) {
                $payload[$col] = $all[$col];
            }
        }
        return $payload;
    }

    /**
     * When an asset is marked available (returned / free), put its latest handover
     * back on the Handover Reports queue (clear printed flag; close any open row).
     */
    private function queueHandoverReportOnAvailable(string $category, int $assetId, array $user): void
    {
        if (! isset(self::TABLES[$category])) {
            return;
        }

        $open = $this->pdo->prepare(
            'SELECT id FROM asset_handovers
             WHERE asset_id = :id AND asset_type = :type AND is_open = TRUE
             ORDER BY id DESC LIMIT 1'
        );
        $open->execute(['id' => $assetId, 'type' => $category]);
        $openId = $open->fetchColumn();

        if ($openId) {
            $uid = isset($user['id']) ? (int) $user['id'] : 1;
            $this->pdo->prepare(
                'UPDATE asset_handovers SET
                    is_open = FALSE,
                    return_date = COALESCE(return_date, CURRENT_DATE),
                    return_received_by_id = COALESCE(return_received_by_id, :uid),
                    return_condition = COALESCE(return_condition, :condition),
                    acceptance_form_printed_at = NULL,
                    updated_at = NOW()
                 WHERE id = :hid'
            )->execute([
                'uid' => $uid,
                'condition' => 'good',
                'hid' => (int) $openId,
            ]);
        } else {
            $latest = $this->pdo->prepare(
                'SELECT id FROM asset_handovers
                 WHERE asset_id = :id AND asset_type = :type
                 ORDER BY id DESC LIMIT 1'
            );
            $latest->execute(['id' => $assetId, 'type' => $category]);
            $latestId = $latest->fetchColumn();
            if ($latestId) {
                $this->pdo->prepare(
                    'UPDATE asset_handovers SET
                        acceptance_form_printed_at = NULL,
                        updated_at = NOW()
                     WHERE id = :hid'
                )->execute(['hid' => (int) $latestId]);
            }
        }

        // Show again on Handover Reports when marked available
        if (in_array($category, ['laptop', 'mobile_phone'], true)) {
            $table = self::TABLES[$category];
            $this->pdo->prepare(
                "UPDATE {$table}
                 SET handover_report_hidden_at = NULL,
                     updated_at = NOW()
                 WHERE id = :id"
            )->execute(['id' => $assetId]);
        }

        (new HandoverSlotSync($this->pdo))->sync($category, $assetId);
    }

    /**
     * When status is Assigned/deployed (or any in-custody status), guarantee one open handover
     * so allocated_person / Name column survive status-only edits.
     */
    private function ensureOpenHandoverForDeployed(
        string $category,
        int $assetId,
        ?string $holderName,
        array $user
    ): void {
        if (! isset(self::TABLES[$category])) {
            return;
        }

        $open = $this->pdo->prepare(
            'SELECT id FROM asset_handovers
             WHERE asset_id = :id AND asset_type = :type AND is_open = TRUE
             LIMIT 1'
        );
        $open->execute(['id' => $assetId, 'type' => $category]);
        if ($open->fetchColumn()) {
            return;
        }

        $latest = $this->pdo->prepare(
            'SELECT id, assigned_person_name FROM asset_handovers
             WHERE asset_id = :id AND asset_type = :type
             ORDER BY id DESC LIMIT 1'
        );
        $latest->execute(['id' => $assetId, 'type' => $category]);
        $row = $latest->fetch(PDO::FETCH_ASSOC);

        if (is_array($row) && ! empty($row['id'])) {
            $this->pdo->prepare(
                'UPDATE asset_handovers SET
                    return_date = NULL,
                    return_received_by_id = NULL,
                    return_condition = NULL,
                    is_open = TRUE,
                    assigned_person_name = COALESCE(NULLIF(:person, \'\'), assigned_person_name),
                    updated_at = NOW()
                 WHERE id = :hid'
            )->execute([
                'person' => $holderName ?? '',
                'hid' => (int) $row['id'],
            ]);
            return;
        }

        // No history at all — create an open handover from the name on the form
        $name = trim((string) ($holderName ?? ''));
        if ($name === '') {
            return;
        }
        $cStmt = $this->pdo->prepare(
            'SELECT company_id FROM ' . self::TABLES[$category] . ' WHERE id = :id'
        );
        $cStmt->execute(['id' => $assetId]);
        $companyId = (int) ($cStmt->fetchColumn() ?: 0);
        $uid = (int) ($user['id'] ?? 0) ?: 1;
        $this->pdo->prepare(
            'INSERT INTO asset_handovers (
                company_id, asset_id, asset_type, handover_date, assigned_person_name,
                assigned_by_it_staff_id, checkout_condition, gate_pass_no, is_open
             ) VALUES (
                :cid, :aid, :atype, CURRENT_DATE, :person,
                :uid, \'good\', :gp, TRUE
             )'
        )->execute([
            'cid' => $companyId,
            'aid' => $assetId,
            'atype' => $category,
            'person' => $name,
            'uid' => $uid,
            'gp' => 'GP-' . date('Ymd') . '-' . $assetId,
        ]);
    }

    private static function addYears(string $ymd, int $years): ?string
    {
        $dt = \DateTimeImmutable::createFromFormat('Y-m-d', substr($ymd, 0, 10));
        if ($dt === false) {
            return null;
        }
        return $dt->modify('+' . $years . ' years')->format('Y-m-d');
    }

    /** Warranty periods: 3/6 months, 1/2/3 years from a start date; Expired → no date. */
    private static function expiryFromPeriod(string $ymd, string $period): ?string
    {
        $p = strtolower(trim($period));
        if ($p === 'expired') {
            return null;
        }
        $dt = \DateTimeImmutable::createFromFormat('Y-m-d', substr($ymd, 0, 10));
        if ($dt === false) {
            return null;
        }
        $modified = match ($p) {
            '3 months', '3 month' => $dt->modify('+3 months'),
            '6 months', '6 month' => $dt->modify('+6 months'),
            '1 year', '1 years' => $dt->modify('+1 year'),
            '2 years', '2 year' => $dt->modify('+2 years'),
            '3 years', '3 year' => $dt->modify('+3 years'),
            default => false,
        };
        if ($modified === false) {
            return null;
        }

        return $modified->format('Y-m-d');
    }

    private static function toBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if ($value === null || $value === '') {
            return false;
        }
        $filtered = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        return $filtered ?? false;
    }

    private static function numericOrNull(mixed $value): int|float|null
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_int($value) || is_float($value)) {
            return $value;
        }
        if (! is_numeric($value)) {
            // Accept "8GB" / "500 GB"
            if (is_string($value) && preg_match('/-?\d+(?:\.\d+)?/', $value, $m)) {
                return str_contains($m[0], '.') ? (float) $m[0] : (int) $m[0];
            }
            return null;
        }
        return str_contains((string) $value, '.') ? (float) $value : (int) $value;
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    private function normalizeBody(array $body): array
    {
        if (array_key_exists('name', $body) && ! array_key_exists('pc_name', $body)) {
            $body['pc_name'] = $body['name'];
        }
        if (array_key_exists('name', $body) && ! array_key_exists('user_name', $body)) {
            $body['user_name'] = $body['name'];
        }
        if (array_key_exists('item', $body) && ! array_key_exists('item_name', $body)) {
            $body['item_name'] = $body['item'];
        }
        if (array_key_exists('remark', $body) && ! array_key_exists('notes', $body)) {
            $body['notes'] = $body['remark'];
        }
        if (array_key_exists('amount', $body) && ! array_key_exists('purchase_amount_lkr', $body)) {
            $body['purchase_amount_lkr'] = $body['amount'];
        }
        if (array_key_exists('processor', $body) && ! array_key_exists('cpu', $body)) {
            $body['cpu'] = $body['processor'];
        }
        if (array_key_exists('ram', $body) && ! array_key_exists('ram_gb', $body)) {
            $body['ram_gb'] = $body['ram'];
        }
        if (array_key_exists('capacity', $body) && ! array_key_exists('storage_gb', $body)) {
            $hasDiskFields = array_key_exists('hdd', $body)
                || array_key_exists('ssd', $body)
                || array_key_exists('hdd_gb', $body)
                || array_key_exists('ssd_gb', $body);
            if ($body['capacity'] !== null && $body['capacity'] !== '') {
                $body['storage_gb'] = $body['capacity'];
            } elseif (! $hasDiskFields) {
                // Laptop/phone: empty capacity clears storage. PCs send HDD/SSD instead.
                $body['storage_gb'] = null;
            }
        }
        if (array_key_exists('hdd', $body) && ! array_key_exists('hdd_gb', $body)) {
            $body['hdd_gb'] = $body['hdd'];
        }
        if (array_key_exists('ssd', $body) && ! array_key_exists('ssd_gb', $body)) {
            $body['ssd_gb'] = $body['ssd'];
        }
        // PC HDD/SSD → combined storage_gb. Never wipe laptop capacity when hdd/ssd are null.
        $hddNumeric = is_numeric($body['hdd_gb'] ?? null);
        $ssdNumeric = is_numeric($body['ssd_gb'] ?? null);
        if ($hddNumeric || $ssdNumeric) {
            $hdd = $hddNumeric ? (float) $body['hdd_gb'] : 0.0;
            $ssd = $ssdNumeric ? (float) $body['ssd_gb'] : 0.0;
            $body['storage_gb'] = $hdd + $ssd;
            if ($hdd > 0 && $ssd > 0) {
                $body['storage_type'] = 'hybrid';
            } elseif ($ssd > 0) {
                $body['storage_type'] = 'ssd';
            } elseif ($hdd > 0) {
                $body['storage_type'] = 'hdd';
            }
        } elseif (
            array_key_exists('hdd_gb', $body)
            && array_key_exists('ssd_gb', $body)
            && ! array_key_exists('storage_gb', $body)
            && ! array_key_exists('capacity', $body)
        ) {
            // PC form cleared both disks with no capacity alias
            $body['storage_gb'] = null;
        }
        if (array_key_exists('other', $body) && ! array_key_exists('notes', $body)) {
            $body['notes'] = $body['other'];
        }
        if (array_key_exists('date', $body) && ! array_key_exists('purchase_date', $body)) {
            $body['purchase_date'] = $body['date'];
        }
        if (array_key_exists('warranty', $body) && ! array_key_exists('warranty_expires_on', $body)) {
            $body['warranty_expires_on'] = $body['warranty'];
        }
        if (array_key_exists('return_date', $body) && ! array_key_exists('asset_return_date', $body)) {
            $body['asset_return_date'] = $body['return_date'];
        }
        if (array_key_exists('handed_over_date', $body) && ! array_key_exists('handed_over_on', $body)) {
            $body['handed_over_on'] = $body['handed_over_date'];
        }
        return $body;
    }

    /**
     * Keep asset_handovers aligned with denormalized handover_person_* slots.
     * - Empty history → create rows from all slots
     * - History shorter than slots → append missing people (imports / partial edits)
     *
     * @param array<string, mixed> $asset
     * @param array<string, mixed> $user
     */
    private function ensureHandoversFromSlots(string $category, int $assetId, array $asset, array $user): void
    {
        if (! in_array($category, ['laptop', 'mobile_phone', 'pc'], true)) {
            return;
        }

        $slots = [];
        for ($i = 1; $i <= HandoverSlotSync::maxPersonsFor($category, $asset); $i++) {
            $name = trim((string) ($asset["handover_person_{$i}"] ?? ''));
            if ($name === '' && $i === 1) {
                $name = trim((string) ($asset['original_assigned_person'] ?? ''));
            }
            if ($name === '' && $i === 1) {
                $name = trim((string) ($asset['allocated_person'] ?? $asset['pc_name'] ?? ''));
            }
            if ($name === '') {
                continue;
            }
            // Excel sometimes put lost notes (e.g. "Missing in Jaffna") in person columns
            if (preg_match('/\bmissing\s+in\b/i', $name) || preg_match('/\bing\s+in\s+jaffna\b/i', $name)) {
                continue;
            }
            $date = (string) ($asset["handover_on_{$i}"] ?? '');
            if ($date === '' && $i === 1) {
                $date = (string) ($asset['original_assigned_on'] ?? $asset['allocated_on'] ?? '');
            }
            if ($date === '') {
                $date = date('Y-m-d');
            }
            $slots[] = ['name' => $name, 'date' => substr($date, 0, 10)];
        }

        if ($slots === []) {
            return;
        }

        $histStmt = $this->pdo->prepare(
            'SELECT id, assigned_person_name, handover_date, is_open
             FROM asset_handovers
             WHERE asset_id = :id AND asset_type = :type
             ORDER BY id ASC'
        );
        $histStmt->execute(['id' => $assetId, 'type' => $category]);
        $history = $histStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        // Already have at least as many history rows as slot people — nothing to backfill
        if (count($history) >= count($slots)) {
            return;
        }

        $companyId = (int) ($asset['company_id'] ?? 0);
        $userId = (int) ($user['id'] ?? 1);
        $status = strtolower((string) ($asset['status'] ?? ''));
        $wantOpenLast = $status !== 'available' && $status !== 'disposed';

        try {
            $this->pdo->beginTransaction();

            // Close any currently open row before appending (only one open allowed).
            // Never invent a return_date from the next person's handover date.
            if (count($history) > 0 && count($history) < count($slots)) {
                $this->pdo->prepare(
                    'UPDATE asset_handovers SET
                        is_open = FALSE,
                        updated_at = NOW()
                     WHERE asset_id = :aid AND asset_type = :atype AND is_open = TRUE'
                )->execute([
                    'aid' => $assetId,
                    'atype' => $category,
                ]);
            }

            for ($i = count($history); $i < count($slots); $i++) {
                $slot = $slots[$i];
                $isLast = $i === count($slots) - 1;
                $isOpen = $isLast && $wantOpenLast;
                // Return dates are independent of the next handover — leave null for manual entry
                $returnedOn = null;

                $stmt = $this->pdo->prepare(
                    'INSERT INTO asset_handovers (
                        company_id, asset_id, asset_type, handover_date, assigned_person_name,
                        assigned_by_it_staff_id, checkout_condition, gate_pass_no, is_open,
                        return_date, return_received_by_id, return_condition
                     ) VALUES (
                        :company_id, :asset_id, :asset_type, :handover_date, :assigned_person_name,
                        :assigned_by_it_staff_id, \'good\', :gate_pass_no, :is_open,
                        :return_date, :return_received_by_id, :return_condition
                     )'
                );
                $stmt->execute([
                    'company_id' => $companyId,
                    'asset_id' => $assetId,
                    'asset_type' => $category,
                    'handover_date' => $slot['date'],
                    'assigned_person_name' => $slot['name'],
                    'assigned_by_it_staff_id' => $userId,
                    'gate_pass_no' => 'GP-' . date('Ymd') . '-' . $assetId . '-' . ($i + 1),
                    'is_open' => $isOpen ? 'true' : 'false',
                    'return_date' => $returnedOn,
                    'return_received_by_id' => null,
                    'return_condition' => null,
                ]);
            }

            if ($wantOpenLast) {
                $table = self::TABLES[$category];
                $this->pdo->prepare(
                    "UPDATE {$table} SET status = 'deployed', updated_at = NOW() WHERE id = :id AND status = 'available'"
                )->execute(['id' => $assetId]);
            }

            $this->pdo->commit();
            (new HandoverSlotSync($this->pdo))->sync($category, $assetId);
        } catch (\Throwable) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
        }
    }

    /** @return list<array<string, mixed>> */
    private function handoverHistory(string $category, int $assetId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT h.id, h.handover_date, h.return_date, h.is_open, h.checkout_remarks, h.return_remarks,
                    COALESCE(NULLIF(h.assigned_person_name, \'\'), e.name) AS assigned_person_name,
                    rb.name AS return_received_by_name
             FROM asset_handovers h
             LEFT JOIN users e ON e.id = h.assigned_employee_id
             LEFT JOIN users rb ON rb.id = h.return_received_by_id
             WHERE h.asset_id = :asset_id AND h.asset_type = :asset_type
             ORDER BY h.id ASC'
        );
        $stmt->execute(['asset_id' => $assetId, 'asset_type' => $category]);
        $rows = $stmt->fetchAll();
        $n = 0;
        foreach ($rows as &$row) {
            $n++;
            $row['handover_no'] = $n;
            $row['handover_label'] = HandoverController::ordinal($n) . ' handover';
            $row['is_current'] = self::truthyOpen($row['is_open'] ?? false);
            // Normalize for JSON clients (pgsql may return 't'/'f')
            $row['is_open'] = $row['is_current'];
        }
        unset($row);
        return $rows;
    }

    private static function truthyOpen(mixed $value): bool
    {
        if ($value === true || $value === 1 || $value === '1') {
            return true;
        }
        if ($value === false || $value === 0 || $value === '0' || $value === null) {
            return false;
        }
        $s = strtolower(trim((string) $value));
        return $s === 't' || $s === 'true' || $s === 'yes';
    }

    private function createInitialHandover(
        string $category,
        int $assetId,
        int $companyId,
        string $personName,
        string $handoverDate,
        int $userId
    ): void {
        $stmt = $this->pdo->prepare(
            'INSERT INTO asset_handovers (
                company_id, asset_id, asset_type, handover_date, assigned_person_name,
                assigned_by_it_staff_id, checkout_condition, gate_pass_no, is_open
             ) VALUES (
                :company_id, :asset_id, :asset_type, :handover_date, :assigned_person_name,
                :assigned_by_it_staff_id, \'good\', :gate_pass_no, TRUE
             )'
        );
        $stmt->execute([
            'company_id' => $companyId,
            'asset_id' => $assetId,
            'asset_type' => $category,
            'handover_date' => $handoverDate !== '' ? $handoverDate : date('Y-m-d'),
            'assigned_person_name' => $personName,
            'assigned_by_it_staff_id' => $userId,
            'gate_pass_no' => 'GP-' . date('Ymd') . '-' . $assetId,
        ]);
    }

    public function export(Request $request, array $user): void
    {
        $category = (string) $request->input('category', 'laptop');
        if ($category === 'all') {
            $category = 'pc';
        }
        if ($category === 'mobile-phones' || $category === 'mobile_phones') {
            $category = 'mobile_phone';
        }
        if ($category === 'others') {
            $category = 'other';
        }
        if (! isset(self::TABLES[$category])) {
            Response::error('Valid category required', 422);
            return;
        }

        $table = self::TABLES[$category];
        $sql = "SELECT a.*, c.code AS company_code, c.short_name AS company_short,
                       loc.name AS location_name, d.name AS department_name
                FROM {$table} a
                JOIN companies c ON c.id = a.company_id
                LEFT JOIN locations loc ON loc.id = a.location_id
                LEFT JOIN departments d ON d.id = a.department_id
                WHERE TRUE";
        $params = [];
        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND a.company_id = :cid';
            $params['cid'] = (int) $user['company_id'];
        } elseif ($request->input('company_code')) {
            $sql .= ' AND c.code = :ccode';
            $params['ccode'] = strtoupper((string) $request->input('company_code'));
        }
        $newlyPurchased = $category === 'pc' && (
            $request->input('newly_purchased') === '1'
            || $request->input('newly_purchased') === 1
            || $request->input('newly_purchased') === true
        );
        if ($newlyPurchased) {
            $sql .= ' AND a.newly_purchased = TRUE';
        } elseif ($request->input('status')) {
            $sql .= ' AND a.status = :status';
            $params['status'] = (string) $request->input('status');
        }
        if ($request->input('location_id')) {
            $sql .= ' AND a.location_id = :lid';
            $params['lid'] = (int) $request->input('location_id');
        }
        $sql .= ' ORDER BY a.asset_tag';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $headers = [
            'asset_tag', 'category', 'company_code', 'location_name', 'department_name',
            'brand', 'model', 'serial_number', 'status', 'pc_name',
            'allocated_person', 'original_assigned_person', 'purchase_date',
            'warranty_expires_on', 'invoice_no', 'purchase_amount_lkr', 'notes',
        ];
        $filename = 'itams-' . $category . '-' . date('Ymd') . '.csv';
        http_response_code(200);
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        echo "\xEF\xBB\xBF";
        $out = fopen('php://output', 'w');
        if ($out === false) {
            return;
        }
        fputcsv($out, $headers);
        foreach ($rows as $row) {
            $line = [];
            foreach ($headers as $h) {
                if ($h === 'category') {
                    $line[] = $category;
                } else {
                    $line[] = $row[$h] ?? '';
                }
            }
            fputcsv($out, $line);
        }
        fclose($out);
    }

    public function import(Request $request, array $user): void
    {
        $category = (string) ($request->input('category') ?: 'laptop');
        if ($category === 'mobile-phones') {
            $category = 'mobile_phone';
        }
        if (! isset(self::TABLES[$category])) {
            Response::error('Valid category required (laptop, mobile_phone, pc, other)', 422);
            return;
        }

        $rows = $request->input('rows');
        if (! is_array($rows) || $rows === []) {
            // Multipart CSV
            $file = $_FILES['file'] ?? null;
            if (! is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                Response::error('Upload a CSV file or send JSON rows', 422);
                return;
            }
            $rows = $this->parseCsvFile((string) $file['tmp_name']);
        }

        $created = 0;
        $updated = 0;
        $errors = [];
        $table = self::TABLES[$category];
        $companies = $this->pdo->query('SELECT id, code, short_name FROM companies')->fetchAll(PDO::FETCH_ASSOC);
        $byCode = [];
        foreach ($companies as $c) {
            $byCode[strtoupper((string) $c['code'])] = (int) $c['id'];
            $byCode[strtoupper((string) $c['short_name'])] = (int) $c['id'];
        }

        foreach ($rows as $i => $raw) {
            if (! is_array($raw)) {
                continue;
            }
            $row = [];
            foreach ($raw as $k => $v) {
                $row[strtolower(trim((string) $k))] = is_string($v) ? trim($v) : $v;
            }
            $tag = (string) ($row['asset_tag'] ?? $row['asset id'] ?? $row['asset_id'] ?? '');
            if ($tag === '') {
                $errors[] = 'Row ' . ($i + 1) . ': missing asset_tag';
                continue;
            }
            $companyCode = strtoupper((string) ($row['company_code'] ?? $row['company'] ?? ''));
            $companyId = $byCode[$companyCode] ?? null;
            if ($companyId === null && ($user['role'] ?? '') !== 'super_admin') {
                $companyId = (int) $user['company_id'];
            }
            if ($companyId === null) {
                $errors[] = "Row {$tag}: unknown company";
                continue;
            }
            Auth::assertCompanyAccess($user, $companyId);

            $status = strtolower((string) ($row['status'] ?? 'available'));
            $statusMap = [
                'available' => 'available',
                'deployed' => 'deployed',
                'assigned' => 'deployed',
                'under_repair' => 'under_repair',
                'maintenance' => 'under_repair',
                'repair' => 'under_repair',
                'lost' => 'lost',
                'stolen' => 'lost',
                'lost/stolen' => 'lost',
                'disposed' => 'disposed',
                'retired' => 'disposed',
            ];
            $status = $statusMap[$status] ?? 'available';

            $existing = $this->pdo->prepare("SELECT id FROM {$table} WHERE asset_tag = :t LIMIT 1");
            $existing->execute(['t' => $tag]);
            $existId = $existing->fetchColumn();

            $fields = [
                'company_id' => $companyId,
                'asset_tag' => $tag,
                'serial_number' => $row['serial_number'] ?? $row['s/n'] ?? $row['sn'] ?? null,
                'brand' => $row['brand'] ?? null,
                'model' => $row['model'] ?? null,
                'status' => $status,
                'pc_name' => $row['pc_name'] ?? $row['name'] ?? null,
                'invoice_no' => $row['invoice_no'] ?? null,
                'purchase_amount_lkr' => $row['purchase_amount_lkr'] ?? $row['amount'] ?? null,
                'purchase_date' => $this->normalizeDate($row['purchase_date'] ?? null),
                'warranty_expires_on' => $this->normalizeDate($row['warranty_expires_on'] ?? $row['warranty'] ?? null),
                'notes' => $row['notes'] ?? $row['remark'] ?? null,
                'updated_by' => $user['id'],
            ];
            if (in_array($category, ['laptop', 'mobile_phone'], true)) {
                $holder = (string) ($row['allocated_person'] ?? $row['name'] ?? $row['pc_name'] ?? '');
                if ($holder !== '') {
                    $fields['allocated_person'] = $holder;
                    $fields['pc_name'] = $fields['pc_name'] ?: $holder;
                }
                $orig = (string) ($row['original_assigned_person'] ?? '');
                if ($orig !== '') {
                    $fields['original_assigned_person'] = $orig;
                }
            }

            try {
                if ($existId) {
                    $sets = [];
                    $bind = ['id' => (int) $existId];
                    foreach ($fields as $col => $val) {
                        if ($col === 'asset_tag' || $col === 'company_id') {
                            continue;
                        }
                        $sets[] = "{$col} = :{$col}";
                        $bind[$col] = $val === '' ? null : $val;
                    }
                    $sets[] = 'updated_at = NOW()';
                    $this->pdo->prepare(
                        "UPDATE {$table} SET " . implode(', ', $sets) . ' WHERE id = :id'
                    )->execute($bind);
                    $updated++;
                } else {
                    $fields['created_by'] = $user['id'];
                    $cols = array_keys($fields);
                    $placeholders = array_map(static fn ($c) => ':' . $c, $cols);
                    $bind = [];
                    foreach ($fields as $col => $val) {
                        $bind[$col] = $val === '' ? null : $val;
                    }
                    $this->pdo->prepare(
                        'INSERT INTO ' . $table . ' (' . implode(', ', $cols) . ')
                         VALUES (' . implode(', ', $placeholders) . ')'
                    )->execute($bind);
                    $created++;
                }
            } catch (\Throwable $e) {
                $errors[] = "{$tag}: " . $e->getMessage();
            }
        }

        Response::json([
            'created' => $created,
            'updated' => $updated,
            'errors' => array_slice($errors, 0, 50),
            'error_count' => count($errors),
        ]);
    }

    public function importTemplate(Request $request, array $user): void
    {
        unset($request, $user);
        $headers = [
            'asset_tag', 'company_code', 'brand', 'model', 'serial_number', 'status',
            'pc_name', 'allocated_person', 'original_assigned_person',
            'purchase_date', 'warranty_expires_on', 'invoice_no', 'purchase_amount_lkr', 'notes',
        ];
        http_response_code(200);
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="itams-import-template.csv"');
        echo "\xEF\xBB\xBF";
        $out = fopen('php://output', 'w');
        if ($out === false) {
            return;
        }
        fputcsv($out, $headers);
        fputcsv($out, [
            'IT-LAP-9999', 'IT', 'Dell', 'Latitude 5420', 'SN123', 'available',
            'Sample User', 'Sample User', 'Sample User',
            '2024-01-15', '2026-01-15', 'INV-001', '250000', 'Sample row — delete before import',
        ]);
        fclose($out);
    }

    public function statusHistory(Request $request, array $user, array $params): void
    {
        unset($request);
        $category = (string) ($params['category'] ?? '');
        $id = (int) ($params['id'] ?? 0);
        if (! isset(self::TABLES[$category]) || $id < 1) {
            Response::error('Not found', 404);
            return;
        }
        $asset = $this->find($category, $id);
        if ($asset === null) {
            Response::error('Asset not found', 404);
            return;
        }
        $this->assertAssetCompanyAccess($user, $asset);

        try {
            $stmt = $this->pdo->prepare(
                'SELECT h.id, h.from_status, h.to_status, h.note, h.created_at, u.name AS changed_by_name
                 FROM asset_status_history h
                 LEFT JOIN users u ON u.id = h.changed_by
                 WHERE h.asset_type = :t AND h.asset_id = :id
                 ORDER BY h.created_at DESC, h.id DESC
                 LIMIT 100'
            );
            $stmt->execute(['t' => $category, 'id' => $id]);
            Response::json(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        } catch (\Throwable) {
            Response::json(['data' => []]);
        }
    }

    /**
     * Unified lifecycle timeline: register, assignments, kit add/replace/dispose (not routine status flips).
     * GET /api/assets/{category}/{id}/lifecycle
     */
    public function lifecycle(Request $request, array $user, array $params): void
    {
        unset($request);
        $category = (string) ($params['category'] ?? '');
        $id = (int) ($params['id'] ?? 0);
        if (! isset(self::TABLES[$category]) || $id < 1) {
            Response::error('Not found', 404);
            return;
        }
        $asset = $this->find($category, $id);
        if ($asset === null) {
            Response::error('Asset not found', 404);
            return;
        }
        $this->assertAssetCompanyAccess($user, $asset);

        $events = $this->buildLifecycleEvents($category, $id, $asset);
        // Oldest first: Asset Registered & Tagged, then assignments / kit / disposal
        usort($events, static function (array $a, array $b): int {
            $da = (string) ($a['at'] ?? '');
            $db = (string) ($b['at'] ?? '');
            if ($da === $db) {
                return ((int) ($a['sort'] ?? 0)) <=> ((int) ($b['sort'] ?? 0));
            }
            return strcmp($da, $db);
        });

        Response::json(['data' => array_values(array_map(static function (array $e): array {
            unset($e['sort']);
            return $e;
        }, $events))]);
    }

    /**
     * @param array<string, mixed> $asset
     * @return list<array<string, mixed>>
     */
    private function buildLifecycleEvents(string $category, int $id, array $asset): array
    {
        $events = [];
        $tag = trim((string) ($asset['asset_tag'] ?? ''));
        $loc = trim((string) ($asset['location_name'] ?? $asset['work_location'] ?? ''));
        $created = (string) ($asset['created_at'] ?? '');
        if ($created !== '') {
            $locBit = $loc !== '' ? " ({$loc})." : '.';
            $events[] = [
                'id' => 'registered-' . $id,
                'type' => 'registered',
                'tone' => 'success',
                'title' => 'Asset Registered & Tagged',
                'detail' => $tag !== ''
                    ? "Logged into Fixed Asset Register · {$tag}{$locBit}"
                    : 'Logged into Fixed Asset Register' . $locBit,
                'at' => $created,
                'date' => substr($created, 0, 10),
                'sort' => 10,
            ];
        }

        // Custody from asset_handovers
        try {
            $stmt = $this->pdo->prepare(
                'SELECT h.id, h.handover_date, h.return_date, h.is_open, h.assigned_person_name,
                        h.checkout_remarks, h.return_remarks, h.created_at,
                        u.name AS assigned_by_name
                 FROM asset_handovers h
                 LEFT JOIN users u ON u.id = h.assigned_by_it_staff_id
                 WHERE h.asset_type = :t AND h.asset_id = :id
                 ORDER BY h.handover_date ASC NULLS LAST, h.id ASC'
            );
            $stmt->execute(['t' => $category, 'id' => $id]);
            $hands = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $n = 0;
            foreach ($hands as $h) {
                $n++;
                $person = trim((string) ($h['assigned_person_name'] ?? ''));
                if ($person === '') {
                    $person = 'Unknown user';
                }
                $hDate = (string) ($h['handover_date'] ?? substr((string) ($h['created_at'] ?? ''), 0, 10));
                $label = $category === 'pc'
                    ? ($n === 1 ? 'Assigned to user' : 'Reassigned to new user')
                    : ($n === 1 ? 'Assigned to user' : 'Handed over to new user');
                $events[] = [
                    'id' => 'handover-' . $h['id'],
                    'type' => 'assigned',
                    'tone' => 'info',
                    'title' => $label,
                    'detail' => "Custody granted to {$person}" . ($hDate !== '' ? " · {$hDate}." : '.'),
                    'at' => $hDate !== '' ? $hDate . 'T12:00:00' : (string) ($h['created_at'] ?? ''),
                    'date' => $hDate !== '' ? substr($hDate, 0, 10) : null,
                    'sort' => 20 + $n,
                ];
                $ret = trim((string) ($h['return_date'] ?? ''));
                if ($ret !== '') {
                    $events[] = [
                        'id' => 'return-' . $h['id'],
                        'type' => 'returned',
                        'tone' => 'neutral',
                        'title' => $category === 'pc' ? 'Assignment ended' : 'Returned to IT',
                        'detail' => "Returned from {$person} · {$ret}.",
                        'at' => $ret . 'T12:00:00',
                        'date' => $ret,
                        'sort' => 20 + $n + 1,
                    ];
                }
            }
        } catch (\Throwable) {
            // table may be unavailable
        }

        // Slot chain fallback when no handover rows (imports / PC slots)
        if ($category === 'pc' || $category === 'laptop' || $category === 'mobile_phone') {
            $slotEvents = $this->lifecycleFromSlots($category, $id, $asset);
            // Prefer real handover rows; only add slots if no handover assignment events
            $hasAssign = false;
            foreach ($events as $e) {
                if (($e['type'] ?? '') === 'assigned') {
                    $hasAssign = true;
                    break;
                }
            }
            if (! $hasAssign) {
                foreach ($slotEvents as $se) {
                    $events[] = $se;
                }
            }
        }

        // PC kit environment
        if ($category === 'pc') {
            try {
                $this->pdo->query('SELECT 1 FROM pc_kit_components LIMIT 1');
                $kstmt = $this->pdo->prepare(
                    'SELECT k.*, u.name AS created_by_name, ru.name AS replaced_by_name
                     FROM pc_kit_components k
                     LEFT JOIN users u ON u.id = k.created_by
                     LEFT JOIN users ru ON ru.id = k.replaced_by
                     WHERE k.pc_id = :id
                     ORDER BY k.created_at ASC, k.id ASC'
                );
                $kstmt->execute(['id' => $id]);
                foreach ($kstmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $k) {
                    $kind = $this->kitKindLabel((string) ($k['component_kind'] ?? ''));
                    $serial = trim((string) ($k['serial_number'] ?? ''));
                    $brand = trim(trim((string) ($k['brand'] ?? '')) . ' ' . trim((string) ($k['model'] ?? '')));
                    $cap = $k['capacity_gb'] ?? null;
                    $parts = array_filter([
                        $brand !== '' ? $brand : null,
                        $serial !== '' ? "SN {$serial}" : null,
                        $cap !== null && $cap !== '' ? "{$cap} GB" : null,
                    ]);
                    $what = $kind . ($parts !== [] ? ' · ' . implode(' · ', $parts) : '');
                    $notes = (string) ($k['notes'] ?? '');
                    $reason = trim((string) ($k['replace_reason'] ?? ''));

                    // Standard bundle (mouse/keyboard/cables/SSD that ship with the PC) — not logged as "added"
                    // Only explicit Kit-tab assigns (created_by set, or serial/invoice recorded, not auto-import) show.
                    $isStandardBundle = str_contains($notes, 'Imported from PC')
                        || (
                            ($k['created_by'] ?? null) === null
                            && $serial === ''
                            && trim((string) ($k['invoice_no'] ?? '')) === ''
                        );

                    $cAt = (string) ($k['created_at'] ?? '');
                    if (! $isStandardBundle) {
                        $events[] = [
                            'id' => 'kit-add-' . $k['id'],
                            'type' => 'kit_added',
                            'tone' => 'primary',
                            'title' => "Added to PC environment · {$kind}",
                            'detail' => $what . ($cAt !== '' ? '.' : ''),
                            'at' => $cAt,
                            'date' => $cAt !== '' ? substr($cAt, 0, 10) : null,
                            'sort' => 40,
                        ];
                    }

                    $disp = strtolower((string) ($k['disposition'] ?? ''));
                    $rAt = (string) ($k['replaced_at'] ?? $k['disposed_at'] ?? '');
                    if ($rAt === '') {
                        continue;
                    }
                    $cur = $k['is_current'] ?? true;
                    $isCur = $cur === true || $cur === 't' || $cur === 1 || $cur === '1';
                    if ($isCur && ($disp === '' || $disp === '0' || $disp === 'f')) {
                        continue;
                    }
                    if ($disp === '' || $disp === '0' || $disp === 'f') {
                        $disp = 'replaced';
                    }
                    // Checkbox cleared on Asset details — not a separate kit lifecycle event
                    if ($disp === 'removed' && str_contains($reason, 'Cleared on Asset details')) {
                        continue;
                    }
                    // Disposing/replacing a standard bundle part still belongs in lifecycle
                    if ($disp === 'disposed') {
                        $events[] = [
                            'id' => 'kit-dispose-' . $k['id'],
                            'type' => 'disposed',
                            'tone' => 'danger',
                            'title' => "Disposed · {$kind}",
                            'detail' => $what . ($reason !== '' ? " · {$reason}." : '.'),
                            'at' => $rAt,
                            'date' => substr($rAt, 0, 10),
                            'sort' => 50,
                        ];
                    } elseif ($disp === 'removed') {
                        $events[] = [
                            'id' => 'kit-remove-' . $k['id'],
                            'type' => 'kit_removed',
                            'tone' => 'warning',
                            'title' => "Removed from PC · {$kind}",
                            'detail' => $what . ($reason !== '' ? " · {$reason}." : '.'),
                            'at' => $rAt,
                            'date' => substr($rAt, 0, 10),
                            'sort' => 45,
                        ];
                    } else {
                        $events[] = [
                            'id' => 'kit-replace-' . $k['id'],
                            'type' => 'kit_replaced',
                            'tone' => 'warning',
                            'title' => "Replaced · {$kind}",
                            'detail' => $what . ($reason !== '' ? " · {$reason}." : '.'),
                            'at' => $rAt,
                            'date' => substr($rAt, 0, 10),
                            'sort' => 45,
                        ];
                    }
                }
            } catch (\Throwable) {
                // kit table optional
            }

            // Full PC hardware replacements (same tag, new chassis / specs)
            try {
                $this->ensurePcHardwareReplacementsTable();
                $hwStmt = $this->pdo->prepare(
                    'SELECT r.*, u.name AS replaced_by_name
                     FROM pc_hardware_replacements r
                     LEFT JOIN users u ON u.id = r.replaced_by
                     WHERE r.pc_id = :id
                     ORDER BY r.replaced_at ASC, r.id ASC'
                );
                $hwStmt->execute(['id' => $id]);
                foreach ($hwStmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
                    $old = $this->decodeJsonObject($r['old_specs'] ?? null);
                    $new = $this->decodeJsonObject($r['new_specs'] ?? null);
                    $was = $this->formatPcHardwareSummary($old);
                    $now = $this->formatPcHardwareSummary($new);
                    $reason = trim((string) ($r['replace_reason'] ?? ''));
                    $by = trim((string) ($r['replaced_by_name'] ?? ''));
                    $note = trim((string) ($r['notes'] ?? ''));
                    $detail = "Was: {$was} → Now: {$now}";
                    if ($reason !== '') {
                        $detail .= " · {$reason}";
                    }
                    if ($note !== '') {
                        $detail .= " · {$note}";
                    }
                    if ($by !== '') {
                        $detail .= " · by {$by}";
                    }
                    $at = (string) ($r['replaced_at'] ?? '');
                    $events[] = [
                        'id' => 'pc-hw-replace-' . $r['id'],
                        'type' => 'pc_replaced',
                        'tone' => 'warning',
                        'title' => 'PC hardware replaced',
                        'detail' => $detail . '.',
                        'at' => $at,
                        'date' => $at !== '' ? substr($at, 0, 10) : null,
                        'sort' => 48,
                        'old_specs' => $old,
                        'new_specs' => $new,
                        'replace_reason' => $reason !== '' ? $reason : null,
                    ];
                }
            } catch (\Throwable) {
                // replacement table optional
            }
        }

        // Whole-asset disposal only (skip routine status flips)
        try {
            $stmt = $this->pdo->prepare(
                'SELECT h.id, h.to_status, h.note, h.created_at, u.name AS changed_by_name
                 FROM asset_status_history h
                 LEFT JOIN users u ON u.id = h.changed_by
                 WHERE h.asset_type = :t AND h.asset_id = :id
                   AND lower(h.to_status) IN (\'disposed\', \'lost\')
                 ORDER BY h.created_at ASC'
            );
            $stmt->execute(['t' => $category, 'id' => $id]);
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $h) {
                $to = strtolower((string) ($h['to_status'] ?? ''));
                $when = (string) ($h['created_at'] ?? '');
                $note = trim((string) ($h['note'] ?? ''));
                $by = trim((string) ($h['changed_by_name'] ?? ''));
                $events[] = [
                    'id' => 'status-' . $h['id'],
                    'type' => $to === 'lost' ? 'lost' : 'disposed',
                    'tone' => 'danger',
                    'title' => $to === 'lost' ? 'Reported lost / stolen' : 'Asset disposed',
                    'detail' => trim(
                        ($note !== '' ? $note : ($to === 'lost' ? 'Marked lost or stolen.' : 'Removed from active register.'))
                        . ($by !== '' ? " · {$by}" : '')
                    ),
                    'at' => $when,
                    'date' => $when !== '' ? substr($when, 0, 10) : null,
                    'sort' => 60,
                ];
            }
        } catch (\Throwable) {
            // ignore
        }

        // If currently disposed but history missing
        $st = strtolower((string) ($asset['status'] ?? ''));
        if (in_array($st, ['disposed', 'lost'], true)) {
            $hasDisp = false;
            foreach ($events as $e) {
                if (in_array($e['type'] ?? '', ['disposed', 'lost'], true) && str_starts_with((string) ($e['id'] ?? ''), 'status-')) {
                    $hasDisp = true;
                    break;
                }
            }
            if (! $hasDisp) {
                $when = (string) ($asset['updated_at'] ?? $asset['created_at'] ?? '');
                $events[] = [
                    'id' => 'status-current',
                    'type' => $st === 'lost' ? 'lost' : 'disposed',
                    'tone' => 'danger',
                    'title' => $st === 'lost' ? 'Reported lost / stolen' : 'Asset disposed',
                    'detail' => $st === 'lost' ? 'Marked lost or stolen.' : 'Removed from active register.',
                    'at' => $when,
                    'date' => $when !== '' ? substr($when, 0, 10) : null,
                    'sort' => 60,
                ];
            }
        }

        return $events;
    }

    /**
     * @param array<string, mixed> $asset
     * @return list<array<string, mixed>>
     */
    private function lifecycleFromSlots(string $category, int $id, array $asset): array
    {
        $events = [];
        $max = $category === 'pc' ? 8 : 8;
        for ($i = 1; $i <= $max; $i++) {
            $person = trim((string) ($asset["handover_person_{$i}"] ?? ''));
            if ($person === '' && $i === 1) {
                $person = trim((string) ($asset['original_assigned_person'] ?? ''));
            }
            if ($person === '') {
                continue;
            }
            $date = trim((string) ($asset["handover_on_{$i}"] ?? ''));
            if ($date === '' && $i === 1) {
                $date = trim((string) ($asset['original_assigned_on'] ?? $asset['allocated_on'] ?? ''));
            }
            $date = $date !== '' ? substr($date, 0, 10) : '';
            $title = $i === 1
                ? ($category === 'pc' ? 'Assigned to user' : 'Assigned to user')
                : ($category === 'pc' ? 'Reassigned to new user' : 'Handed over to new user');
            $events[] = [
                'id' => "slot-{$id}-{$i}",
                'type' => 'assigned',
                'tone' => 'info',
                'title' => $title,
                'detail' => "Custody granted to {$person}" . ($date !== '' ? " · {$date}." : '.'),
                'at' => $date !== '' ? $date . 'T12:00:00' : (string) ($asset['created_at'] ?? ''),
                'date' => $date !== '' ? $date : null,
                'sort' => 20 + $i,
            ];
        }
        return $events;
    }

    private function kitKindLabel(string $kind): string
    {
        return match ($kind) {
            'ssd' => 'SSD',
            'hdd' => 'HDD',
            'mouse' => 'Mouse',
            'keyboard' => 'Keyboard',
            'ups' => 'UPS',
            'monitor' => 'Monitor',
            'power_cable' => 'Power cable',
            'vga_cable' => 'VGA / display cable',
            default => $kind !== '' ? ucfirst($kind) : 'Component',
        };
    }

    /**
     * Completely replace a PC's hardware while keeping the same asset tag, branch, and assignment history.
     * Old specs are snapshotted for the Lifecycle timeline.
     * POST /api/assets/pc/{id}/replace-hardware
     *
     * @param array<string, mixed> $user
     * @param array<string, mixed> $params
     */
    public function replaceHardware(Request $request, array $user, array $params): void
    {
        $role = (string) ($user['role'] ?? '');
        if (! in_array($role, ['super_admin', 'it_admin', 'it_staff'], true)) {
            Response::error('Only IT staff can replace PC hardware', 403);
            return;
        }

        $id = (int) ($params['id'] ?? 0);
        if ($id < 1) {
            Response::error('PC id required', 422);
            return;
        }

        $asset = $this->find('pc', $id);
        if ($asset === null) {
            Response::error('PC not found', 404);
            return;
        }
        $this->assertAssetCompanyAccess($user, $asset);
        $this->ensurePcHardwareReplacementsTable();

        $reason = trim((string) ($request->input('replace_reason') ?: $request->input('reason') ?: ''));
        if ($reason === '') {
            Response::error('Replace reason is required', 422);
            return;
        }
        $notes = trim((string) ($request->input('notes') ?: ''));

        $old = $this->pcHardwareSnapshot($asset);
        $new = $this->pcHardwareSnapshotFromRequest($request, $old);

        // Require at least one meaningful hardware change (not just a reason note)
        if ($this->pcHardwareSnapshotsEqual($old, $new)) {
            Response::error('Enter the new PC specs (serial, brand, model, CPU, RAM, or storage)', 422);
            return;
        }

        // Derive warranty expiry from period + purchase when possible
        $purchase = $new['purchase_date'] ?? null;
        $period = trim((string) ($new['warranty_period'] ?? ''));
        if ($period !== '' && strcasecmp($period, 'Expired') === 0) {
            $new['warranty_expires_on'] = null;
        } elseif (is_string($purchase) && $purchase !== '' && $period !== '') {
            $expiry = self::expiryFromPeriod($purchase, $period);
            if ($expiry !== null) {
                $new['warranty_expires_on'] = $expiry;
            }
        }

        $hdd = $this->nullableFloat($new['hdd_gb'] ?? null);
        $ssd = $this->nullableFloat($new['ssd_gb'] ?? null);
        if ($hdd !== null || $ssd !== null) {
            $new['storage_gb'] = ($hdd ?? 0) + ($ssd ?? 0);
            if (($ssd ?? 0) > 0 && ($hdd ?? 0) <= 0) {
                $new['storage_type'] = 'ssd';
            } elseif (($hdd ?? 0) > 0 && ($ssd ?? 0) <= 0) {
                $new['storage_type'] = 'hdd';
            } elseif (($hdd ?? 0) > 0 && ($ssd ?? 0) > 0) {
                $new['storage_type'] = 'hybrid';
            }
        }

        $uid = (int) ($user['id'] ?? 0) ?: null;
        $companyId = (int) ($asset['company_id'] ?? 0);

        $this->pdo->beginTransaction();
        try {
            $ins = $this->pdo->prepare(
                'INSERT INTO pc_hardware_replacements
                    (pc_id, company_id, old_specs, new_specs, replace_reason, notes, replaced_by, replaced_at)
                 VALUES
                    (:pc_id, :company_id, CAST(:old_specs AS jsonb), CAST(:new_specs AS jsonb),
                     :reason, :notes, :replaced_by, NOW())
                 RETURNING id, replaced_at'
            );
            $ins->execute([
                'pc_id' => $id,
                'company_id' => $companyId,
                'old_specs' => json_encode($old, JSON_UNESCAPED_UNICODE),
                'new_specs' => json_encode($new, JSON_UNESCAPED_UNICODE),
                'reason' => $reason,
                'notes' => $notes !== '' ? $notes : null,
                'replaced_by' => $uid,
            ]);
            $row = $ins->fetch(PDO::FETCH_ASSOC) ?: [];

            $upd = $this->pdo->prepare(
                'UPDATE pcs SET
                    serial_number = :serial_number,
                    brand = :brand,
                    model = :model,
                    cpu = :cpu,
                    ram_gb = :ram_gb,
                    hdd_gb = :hdd_gb,
                    ssd_gb = :ssd_gb,
                    storage_gb = :storage_gb,
                    storage_type = CAST(:storage_type AS storage_type),
                    windows_version = :windows_version,
                    invoice_no = :invoice_no,
                    purchase_amount_lkr = :purchase_amount_lkr,
                    purchase_date = :purchase_date,
                    warranty_period = :warranty_period,
                    warranty_expires_on = :warranty_expires_on,
                    newly_purchased = TRUE,
                    updated_by = :updated_by,
                    updated_at = NOW()
                 WHERE id = :id'
            );
            $storageType = $new['storage_type'] ?? $old['storage_type'] ?? 'unknown';
            if (! in_array((string) $storageType, ['ssd', 'hdd', 'hybrid', 'unknown'], true)) {
                $storageType = 'unknown';
            }
            $upd->execute([
                'serial_number' => $this->nullStr($new['serial_number'] ?? null),
                'brand' => $this->nullStr($new['brand'] ?? null),
                'model' => $this->nullStr($new['model'] ?? null),
                'cpu' => $this->nullStr($new['cpu'] ?? null),
                'ram_gb' => $this->nullableFloat($new['ram_gb'] ?? null),
                'hdd_gb' => $hdd,
                'ssd_gb' => $ssd,
                'storage_gb' => $this->nullableFloat($new['storage_gb'] ?? null),
                'storage_type' => $storageType,
                'windows_version' => $this->nullStr($new['windows_version'] ?? null),
                'invoice_no' => $this->nullStr($new['invoice_no'] ?? null),
                'purchase_amount_lkr' => $this->nullableFloat($new['purchase_amount_lkr'] ?? null),
                'purchase_date' => $this->nullStr($new['purchase_date'] ?? null),
                'warranty_period' => $this->nullStr($new['warranty_period'] ?? null),
                'warranty_expires_on' => $this->nullStr($new['warranty_expires_on'] ?? null),
                'updated_by' => $uid,
                'id' => $id,
            ]);

            // Audit note (not shown as disposed/lost on lifecycle — dedicated pc_replaced event covers UI)
            $status = (string) ($asset['status'] ?? 'available');
            $this->recordStatusChange(
                'pc',
                $id,
                $companyId,
                $status,
                $status,
                'PC hardware replaced: ' . $reason
                    . ' | Was: ' . $this->formatPcHardwareSummary($old)
                    . ' | Now: ' . $this->formatPcHardwareSummary($new),
                $user,
                (string) ($asset['asset_tag'] ?? ''),
            );

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Could not replace PC hardware: ' . $e->getMessage(), 422);
            return;
        }

        try {
            (new PcKitController($this->pdo))->syncPc($id);
        } catch (\Throwable) {
            // best-effort kit capacity sync
        }

        $detailed = $this->findDetailed('pc', $id);
        if (is_array($detailed)) {
            $detailed['category'] = 'pc';
        }

        Response::json([
            'data' => $detailed ?: $this->find('pc', $id),
            'replacement' => [
                'id' => $row['id'] ?? null,
                'replaced_at' => $row['replaced_at'] ?? null,
                'old_specs' => $old,
                'new_specs' => $new,
                'replace_reason' => $reason,
            ],
            'message' => 'PC hardware replaced — asset tag and assignment history kept',
        ]);
    }

    private function ensurePcHardwareReplacementsTable(): void
    {
        static $ready = false;
        if ($ready) {
            return;
        }
        try {
            $this->pdo->query('SELECT 1 FROM pc_hardware_replacements LIMIT 1');
            $ready = true;
            return;
        } catch (\Throwable) {
            // create
        }
        $path = dirname(__DIR__, 3) . '/database/migrations/create_pc_hardware_replacements.sql';
        $sql = @file_get_contents($path);
        if (is_string($sql) && $sql !== '') {
            $this->pdo->exec($sql);
        }
        $ready = true;
    }

    /**
     * @param array<string, mixed> $asset
     * @return array<string, mixed>
     */
    private function pcHardwareSnapshot(array $asset): array
    {
        return [
            'serial_number' => $this->nullStr($asset['serial_number'] ?? null),
            'brand' => $this->nullStr($asset['brand'] ?? null),
            'model' => $this->nullStr($asset['model'] ?? null),
            'cpu' => $this->nullStr($asset['cpu'] ?? $asset['processor'] ?? null),
            'ram_gb' => $this->nullableFloat($asset['ram_gb'] ?? $asset['ram'] ?? null),
            'hdd_gb' => $this->nullableFloat($asset['hdd_gb'] ?? $asset['hdd'] ?? null),
            'ssd_gb' => $this->nullableFloat($asset['ssd_gb'] ?? $asset['ssd'] ?? null),
            'storage_gb' => $this->nullableFloat($asset['storage_gb'] ?? null),
            'storage_type' => $this->nullStr($asset['storage_type'] ?? null) ?? 'unknown',
            'windows_version' => $this->nullStr($asset['windows_version'] ?? null),
            'invoice_no' => $this->nullStr($asset['invoice_no'] ?? null),
            'purchase_amount_lkr' => $this->nullableFloat($asset['purchase_amount_lkr'] ?? $asset['amount'] ?? null),
            'purchase_date' => $this->nullDate($asset['purchase_date'] ?? $asset['date'] ?? null),
            'warranty_period' => $this->nullStr($asset['warranty_period'] ?? null),
            'warranty_expires_on' => $this->nullDate($asset['warranty_expires_on'] ?? null),
        ];
    }

    /**
     * @param array<string, mixed> $old
     * @return array<string, mixed>
     */
    private function pcHardwareSnapshotFromRequest(Request $request, array $old): array
    {
        $new = $old;
        $body = is_array($request->body) ? $request->body : [];
        $map = [
            'serial_number' => 'serial_number',
            'brand' => 'brand',
            'model' => 'model',
            'cpu' => 'cpu',
            'processor' => 'cpu',
            'windows_version' => 'windows_version',
            'invoice_no' => 'invoice_no',
            'warranty_period' => 'warranty_period',
        ];
        foreach ($map as $input => $field) {
            if (! array_key_exists($input, $body)) {
                continue;
            }
            $new[$field] = $this->nullStr($body[$input]);
        }
        foreach (['ram_gb' => 'ram_gb', 'ram' => 'ram_gb', 'hdd_gb' => 'hdd_gb', 'hdd' => 'hdd_gb',
            'ssd_gb' => 'ssd_gb', 'ssd' => 'ssd_gb', 'purchase_amount_lkr' => 'purchase_amount_lkr',
            'amount' => 'purchase_amount_lkr'] as $input => $field) {
            if (! array_key_exists($input, $body)) {
                continue;
            }
            $raw = $body[$input];
            $new[$field] = ($raw === '' || $raw === null) ? null : $this->nullableFloat($raw);
        }
        foreach (['purchase_date' => 'purchase_date', 'date' => 'purchase_date',
            'warranty_expires_on' => 'warranty_expires_on', 'warranty' => 'warranty_expires_on'] as $input => $field) {
            if (! array_key_exists($input, $body)) {
                continue;
            }
            $new[$field] = $this->nullDate($body[$input]);
        }
        return $new;
    }

    /**
     * @param array<string, mixed> $a
     * @param array<string, mixed> $b
     */
    private function pcHardwareSnapshotsEqual(array $a, array $b): bool
    {
        $keys = [
            'serial_number', 'brand', 'model', 'cpu', 'ram_gb', 'hdd_gb', 'ssd_gb',
            'windows_version', 'invoice_no', 'purchase_amount_lkr', 'purchase_date',
            'warranty_period', 'warranty_expires_on',
        ];
        foreach ($keys as $k) {
            $av = $a[$k] ?? null;
            $bv = $b[$k] ?? null;
            if (is_numeric($av) || is_numeric($bv)) {
                if ($av === null && $bv === null) {
                    continue;
                }
                if ($av === null || $bv === null || (float) $av !== (float) $bv) {
                    return false;
                }
                continue;
            }
            if (strcasecmp(trim((string) ($av ?? '')), trim((string) ($bv ?? ''))) !== 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * @param array<string, mixed> $specs
     */
    private function formatPcHardwareSummary(array $specs): string
    {
        $parts = [];
        $bm = trim(implode(' ', array_filter([
            trim((string) ($specs['brand'] ?? '')),
            trim((string) ($specs['model'] ?? '')),
        ])));
        if ($bm !== '') {
            $parts[] = $bm;
        }
        $sn = trim((string) ($specs['serial_number'] ?? ''));
        if ($sn !== '') {
            $parts[] = 'SN ' . $sn;
        }
        $cpu = trim((string) ($specs['cpu'] ?? ''));
        if ($cpu !== '') {
            $parts[] = $cpu;
        }
        $ram = $specs['ram_gb'] ?? null;
        if ($ram !== null && $ram !== '' && (float) $ram > 0) {
            $parts[] = rtrim(rtrim(number_format((float) $ram, 1, '.', ''), '0'), '.') . 'GB RAM';
        }
        $ssd = $specs['ssd_gb'] ?? null;
        if ($ssd !== null && $ssd !== '' && (float) $ssd > 0) {
            $parts[] = 'SSD ' . rtrim(rtrim(number_format((float) $ssd, 1, '.', ''), '0'), '.') . 'GB';
        }
        $hdd = $specs['hdd_gb'] ?? null;
        if ($hdd !== null && $hdd !== '' && (float) $hdd > 0) {
            $parts[] = 'HDD ' . rtrim(rtrim(number_format((float) $hdd, 1, '.', ''), '0'), '.') . 'GB';
        }
        $win = trim((string) ($specs['windows_version'] ?? ''));
        if ($win !== '') {
            $parts[] = $win;
        }
        return $parts !== [] ? implode(' · ', $parts) : '—';
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeJsonObject(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }
        if (! is_string($raw) || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function nullStr(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        $s = trim((string) $v);
        return $s === '' ? null : $s;
    }

    private function nullDate(mixed $v): ?string
    {
        $s = $this->nullStr($v);
        if ($s === null) {
            return null;
        }
        return substr($s, 0, 10);
    }

    private function nullableFloat(mixed $v): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (is_string($v)) {
            $v = str_replace(',', '', $v);
        }
        if (! is_numeric($v)) {
            return null;
        }
        return (float) $v;
    }

    /**
     * Move an asset to another Indra company, assign a new company asset tag, keep custody history.
     * POST /api/assets/{category}/{id}/transfer-company
     * body: company_id|company_code, location_id, department_id?, transfer_date, note?
     */
    public function transferCompany(Request $request, array $user, array $params): void
    {
        $category = (string) ($params['category'] ?? '');
        $id = (int) ($params['id'] ?? 0);
        if (! in_array($category, ['laptop', 'mobile_phone', 'pc', 'other', 'printer'], true) || $id < 1) {
            Response::error('Company transfer is only for laptops, phones, PCs, and other assets', 422);
            return;
        }

        $table = self::TABLES[$category];
        $asset = $this->find($category, $id);
        if ($asset === null) {
            Response::error('Asset not found', 404);
            return;
        }
        $this->assertAssetCompanyAccess($user, $asset);

        $toCompanyId = (int) $request->input('company_id', 0);
        if ($toCompanyId < 1) {
            $code = strtoupper(trim((string) $request->input('company_code', '')));
            if ($code === 'ITL') {
                $code = 'IT';
            }
            $co = $code !== '' ? $this->resolveCompanyByCode($code) : null;
            if ($co === null) {
                Response::error('Select the destination company', 422);
                return;
            }
            $toCompanyId = (int) $co['id'];
        }
        Auth::assertCompanyAccess($user, $toCompanyId);

        $fromCompanyId = (int) $asset['company_id'];
        if ($toCompanyId === $fromCompanyId) {
            Response::error('Asset is already in that company', 422);
            return;
        }

        $toLocationId = (int) $request->input('location_id', 0);
        if ($toLocationId < 1) {
            Response::error('Select a branch / location in the new company', 422);
            return;
        }
        $locCheck = $this->pdo->prepare(
            'SELECT id FROM locations WHERE id = :id AND company_id = :cid LIMIT 1'
        );
        $locCheck->execute(['id' => $toLocationId, 'cid' => $toCompanyId]);
        if (! $locCheck->fetchColumn()) {
            Response::error('Location does not belong to the destination company', 422);
            return;
        }

        $toDepartmentId = $request->input('department_id');
        $toDepartmentId = $toDepartmentId !== null && $toDepartmentId !== ''
            ? (int) $toDepartmentId
            : null;
        if (in_array($category, ['other', 'printer'], true) && ($toDepartmentId === null || $toDepartmentId < 1)) {
            Response::error('Department is required when transferring other assets', 422);
            return;
        }
        if ($toDepartmentId !== null && $toDepartmentId > 0) {
            $deptCheck = $this->pdo->prepare(
                'SELECT id FROM departments WHERE id = :id AND company_id = :cid LIMIT 1'
            );
            $deptCheck->execute(['id' => $toDepartmentId, 'cid' => $toCompanyId]);
            if (! $deptCheck->fetchColumn()) {
                Response::error('Department does not belong to the destination company', 422);
                return;
            }
        } else {
            $toDepartmentId = null;
        }

        $note = trim((string) $request->input('note', ''));
        $transferDate = $this->normalizeDate(
            $request->input('transfer_date') ?? $request->input('transferred_on')
        );
        if ($transferDate === null) {
            Response::error('Transfer date is required', 422);
            return;
        }
        $oldTag = trim((string) ($asset['asset_tag'] ?? ''));
        $fromLocationId = isset($asset['location_id']) ? (int) $asset['location_id'] : null;
        if ($fromLocationId !== null && $fromLocationId < 1) {
            $fromLocationId = null;
        }

        try {
            $newTag = $this->nextAssetTag($toCompanyId, $category, $table, $toLocationId);
        } catch (\Throwable $e) {
            Response::error($e->getMessage() !== '' ? $e->getMessage() : 'Could not generate new asset tag', 422);
            return;
        }

        $fromCo = $this->resolveCompanyById($fromCompanyId);
        $toCo = $this->resolveCompanyById($toCompanyId);
        $fromLabel = $this->companyUiLabel((string) ($fromCo['code'] ?? ''));
        $toLabel = $this->companyUiLabel((string) ($toCo['code'] ?? ''));

        try {
            $this->pdo->beginTransaction();

            $upd = $this->pdo->prepare(
                "UPDATE {$table} SET
                    company_id = :to_cid,
                    location_id = :to_loc,
                    department_id = :to_dept,
                    asset_tag = :new_tag,
                    former_asset_tag = :old_tag,
                    transferred_from_company_id = :from_cid,
                    company_transferred_at = CAST(:xfer_at AS timestamptz),
                    updated_by = :uid,
                    updated_at = NOW()
                 WHERE id = :id"
            );
            $upd->execute([
                'to_cid' => $toCompanyId,
                'to_loc' => $toLocationId,
                'to_dept' => $toDepartmentId,
                'new_tag' => $newTag,
                'old_tag' => $oldTag !== '' ? $oldTag : null,
                'from_cid' => $fromCompanyId,
                'xfer_at' => $transferDate . ' 12:00:00',
                'uid' => $user['id'] ?? null,
                'id' => $id,
            ]);

            // Keep custody rows editable under the new company (assertCompanyAccess uses handover.company_id)
            if (in_array($category, ['laptop', 'mobile_phone', 'pc'], true)) {
                $this->pdo->prepare(
                    'UPDATE asset_handovers
                     SET company_id = :to_cid, updated_at = NOW()
                     WHERE asset_id = :aid AND asset_type = :atype'
                )->execute([
                    'to_cid' => $toCompanyId,
                    'aid' => $id,
                    'atype' => $category,
                ]);
            }

            try {
                $this->pdo->prepare(
                    'INSERT INTO asset_company_transfers
                        (asset_type, asset_id, from_company_id, to_company_id,
                         from_location_id, to_location_id, from_asset_tag, to_asset_tag,
                         note, transferred_by)
                     VALUES
                        (:t, :aid, :from_c, :to_c, :from_l, :to_l, :from_tag, :to_tag, :note, :uid)'
                )->execute([
                    't' => $category,
                    'aid' => $id,
                    'from_c' => $fromCompanyId,
                    'to_c' => $toCompanyId,
                    'from_l' => $fromLocationId,
                    'to_l' => $toLocationId,
                    'from_tag' => $oldTag !== '' ? $oldTag : $newTag,
                    'to_tag' => $newTag,
                    'note' => $note !== '' ? $note : null,
                    'uid' => $user['id'] ?? null,
                ]);
            } catch (\Throwable) {
                // history table optional
            }

            $status = (string) ($asset['status'] ?? 'available');
            $historyNote = sprintf(
                'Company transfer %s → %s on %s. Former tag %s · Now under %s.%s',
                $fromLabel,
                $toLabel,
                $transferDate,
                $oldTag !== '' ? $oldTag : '—',
                $newTag,
                $note !== '' ? ' ' . $note : ''
            );
            $this->recordStatusChange(
                $category,
                $id,
                $toCompanyId,
                $status,
                $status,
                $historyNote,
                $user,
                $newTag
            );

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Could not transfer asset: ' . $e->getMessage(), 500);
            return;
        }

        $detailed = $this->findDetailed($category, $id);
        if ($detailed === null) {
            Response::json([
                'data' => [
                    'id' => $id,
                    'category' => $category,
                    'asset_tag' => $newTag,
                    'former_asset_tag' => $oldTag,
                ],
                'message' => $historyNote,
            ]);
            return;
        }
        $detailed['handovers'] = $this->handoverHistory($category, $id);
        Response::json([
            'data' => $detailed,
            'message' => $historyNote,
        ]);
    }

    /** @param array<string, mixed> $asset */
    private function assertAssetCompanyAccess(array $user, array $asset): void
    {
        if (($user['role'] ?? '') === 'super_admin') {
            return;
        }
        $userCompany = (int) ($user['company_id'] ?? 0);
        $current = (int) ($asset['company_id'] ?? 0);
        $from = (int) ($asset['transferred_from_company_id'] ?? 0);
        if ($userCompany === $current || ($from > 0 && $userCompany === $from)) {
            return;
        }
        Response::error('Cross-company access denied', 403);
        exit;
    }

    private function companyUiLabel(string $code): string
    {
        $c = strtoupper(trim($code));
        return match ($c) {
            'IT', 'ITL' => 'ITL',
            'IMS' => 'IMS',
            'ISP' => 'ISP',
            'FOTON' => 'Foton',
            'SIM' => 'SIM',
            default => $c !== '' ? $c : '—',
        };
    }

    private function recordStatusChange(
        string $category,
        int $assetId,
        int $companyId,
        string $from,
        string $to,
        ?string $note,
        array $user,
        string $assetTag,
    ): void {
        try {
            $this->pdo->prepare(
                'INSERT INTO asset_status_history
                    (asset_type, asset_id, company_id, from_status, to_status, note, changed_by)
                 VALUES (:t, :aid, :cid, :fr, :to, :note, :uid)'
            )->execute([
                't' => $category,
                'aid' => $assetId,
                'cid' => $companyId,
                'fr' => $from !== '' ? $from : null,
                'to' => $to,
                'note' => $note,
                'uid' => $user['id'] ?? null,
            ]);
        } catch (\Throwable) {
            // Table may not exist yet — skip quietly
            return;
        }

        try {
            (new NotificationService($this->pdo))->notifyStatusChange(
                $category,
                $assetId,
                $companyId,
                $assetTag !== '' ? $assetTag : ('#' . $assetId),
                $to,
                isset($user['id']) ? (int) $user['id'] : null
            );
        } catch (\Throwable) {
            // ignore
        }
    }

    /** @return list<array<string, string>> */
    private function parseCsvFile(string $path): array
    {
        $fh = fopen($path, 'r');
        if ($fh === false) {
            return [];
        }
        $header = null;
        $rows = [];
        while (($data = fgetcsv($fh)) !== false) {
            if ($data === [null] || $data === false) {
                continue;
            }
            // Strip BOM
            if ($header === null) {
                $data[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string) ($data[0] ?? '')) ?? (string) ($data[0] ?? '');
                $header = array_map(static fn ($h) => strtolower(trim((string) $h)), $data);
                continue;
            }
            $row = [];
            foreach ($header as $i => $key) {
                if ($key === '') {
                    continue;
                }
                $row[$key] = $data[$i] ?? '';
            }
            if ($row !== []) {
                $rows[] = $row;
            }
        }
        fclose($fh);
        return $rows;
    }

    private function normalizeDate(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $s = trim((string) $value);
        if (preg_match('/^\d{4}-\d{2}-\d{2}/', $s)) {
            return substr($s, 0, 10);
        }
        $ts = strtotime($s);
        return $ts ? date('Y-m-d', $ts) : null;
    }
}
