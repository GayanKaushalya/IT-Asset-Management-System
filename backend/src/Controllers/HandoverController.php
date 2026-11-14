<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Services\HandoverSlotSync;
use Indra\Itam\Support\Auth;
use PDO;
use Throwable;

final class HandoverController
{
    /** @var array<string, string> */
    private const TABLES = [
        'laptop' => 'laptops',
        'mobile_phone' => 'mobile_phones',
        'pc' => 'pcs',
        'printer' => 'printers',
        'other' => 'other_assets',
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function index(Request $request, array $user): void
    {
        $sql = 'SELECT h.*, a.asset_tag, a.pc_name, a.category, a.status AS asset_status,
                       COALESCE(NULLIF(h.assigned_person_name, \'\'), e.name) AS assigned_person_name,
                       e.staff_id AS employee_staff_id, e.name AS employee_name,
                       it.name AS it_staff_name, c.short_name AS company_short
                FROM asset_handovers h
                JOIN v_assets a ON a.id = h.asset_id AND a.category = h.asset_type
                LEFT JOIN users e ON e.id = h.assigned_employee_id
                JOIN users it ON it.id = h.assigned_by_it_staff_id
                JOIN companies c ON c.id = h.company_id
                WHERE 1=1';
        $params = [];

        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND h.company_id = :company_id';
            $params['company_id'] = $user['company_id'];
        } elseif ($request->input('company_id')) {
            $sql .= ' AND h.company_id = :company_id';
            $params['company_id'] = (int) $request->input('company_id');
        }

        if ($request->input('open') === '1' || $request->input('open') === 'true') {
            $sql .= ' AND h.is_open = TRUE';
        }

        // Handover Reports queue:
        // - open handovers not yet printed, or
        // - latest handover for an asset that is available again
        // Always only the newest handover row per asset.
        if ($request->input('pending_acceptance_form') === '1' || $request->input('pending_acceptance_form') === 'true') {
            $sql .= ' AND h.acceptance_form_printed_at IS NULL
                      AND (h.is_open = TRUE OR a.status = \'available\')
                      AND h.id = (
                          SELECT MAX(h2.id)
                          FROM asset_handovers h2
                          WHERE h2.asset_id = h.asset_id
                            AND h2.asset_type = h.asset_type
                      )';
        }

        // Optional: only handovers whose asset is currently available (returned / free)
        if ($request->input('asset_status') !== null && $request->input('asset_status') !== '') {
            $sql .= ' AND a.status = :asset_status';
            $params['asset_status'] = (string) $request->input('asset_status');
        }

        if ($request->input('asset_type')) {
            $sql .= ' AND h.asset_type = :filter_asset_type';
            $params['filter_asset_type'] = (string) $request->input('asset_type');
        }

        if ($request->input('asset_id') && $request->input('asset_type')) {
            $sql .= ' AND h.asset_id = :asset_id AND h.asset_type = :asset_type';
            $params['asset_id'] = (int) $request->input('asset_id');
            $params['asset_type'] = (string) $request->input('asset_type');
        }

        $sql .= ' ORDER BY h.id DESC LIMIT 500';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        // Number handovers chronologically per asset for labels
        $perAsset = [];
        foreach ($rows as $row) {
            $key = $row['asset_type'] . ':' . $row['asset_id'];
            $perAsset[$key][] = $row;
        }
        $labeled = [];
        foreach ($perAsset as $group) {
            usort($group, static fn ($a, $b) => ((int) $a['id']) <=> ((int) $b['id']));
            $n = 0;
            foreach ($group as $row) {
                $n++;
                $row['handover_no'] = $n;
                $row['handover_label'] = self::ordinal($n) . ' handover';
                $open = $row['is_open'];
                $row['is_current'] = $open === true || $open === 1 || $open === '1'
                    || strtolower((string) $open) === 't'
                    || strtolower((string) $open) === 'true';
                $row['is_open'] = $row['is_current'];
                $labeled[] = $row;
            }
        }
        usort($labeled, static fn ($a, $b) => ((int) $b['id']) <=> ((int) $a['id']));

        Response::json(['data' => $labeled]);
    }

    /**
     * Handover Reports queue: laptops, mobile phones, and other assets
     * (available, or open unprinted handover / allocated — unless removed).
     */
    public function availablePersonDevices(Request $request, array $user): void
    {
        $sql = "SELECT a.id AS asset_id,
                       a.category AS asset_type,
                       a.asset_tag,
                       a.pc_name,
                       a.status AS asset_status,
                       a.brand,
                       a.model,
                       oa.item_name,
                       c.short_name AS company_short,
                       c.code AS company_code,
                       COALESCE(l.name, emp.work_location) AS location_name,
                       h.id,
                       COALESCE(h.handover_date, lap.allocated_on, mb.allocated_on, oa.handover_date) AS handover_date,
                       COALESCE(
                           NULLIF(btrim(lap.allocated_person), ''),
                           NULLIF(btrim(mb.allocated_person), ''),
                           NULLIF(btrim(oa.pc_name), ''),
                           NULLIF(btrim(oa.user_name), ''),
                           NULLIF(btrim(h.assigned_person_name), ''),
                           CASE
                             WHEN emp.title IS NOT NULL AND emp.title <> '' THEN emp.title || '. ' || emp.name
                             ELSE emp.name
                           END
                       ) AS assigned_person_name,
                       h.is_open,
                       h.gate_pass_no,
                       h.acceptance_form_printed_at,
                       it.name AS it_staff_name,
                       emp.staff_id AS employee_staff_id,
                       emp.designation AS employee_designation,
                       emp.department_name AS employee_department_name,
                       emp.work_location AS employee_work_location,
                       emp.epf_number AS employee_epf_number,
                       emp.id AS employee_id
                FROM v_assets a
                JOIN companies c ON c.id = a.company_id
                LEFT JOIN locations l ON l.id = a.location_id
                LEFT JOIN laptops lap ON a.category = 'laptop' AND lap.id = a.id
                LEFT JOIN mobile_phones mb ON a.category = 'mobile_phone' AND mb.id = a.id
                LEFT JOIN other_assets oa ON a.category = 'other' AND oa.id = a.id
                LEFT JOIN LATERAL (
                    SELECT h2.*
                    FROM asset_handovers h2
                    WHERE h2.asset_id = a.id
                      AND h2.asset_type = a.category
                    ORDER BY h2.id DESC
                    LIMIT 1
                ) h ON TRUE
                LEFT JOIN users it ON it.id = h.assigned_by_it_staff_id
                LEFT JOIN LATERAL (
                    SELECT e.*
                    FROM employees e
                    WHERE e.is_active = TRUE
                      AND (
                        lower(btrim(e.name)) = lower(regexp_replace(
                            btrim(COALESCE(
                              NULLIF(btrim(lap.allocated_person), ''),
                              NULLIF(btrim(mb.allocated_person), ''),
                              NULLIF(btrim(oa.pc_name), ''),
                              NULLIF(btrim(oa.user_name), ''),
                              NULLIF(btrim(h.assigned_person_name), ''),
                              ''
                            )),
                            '^(mr|mrs|ms|miss)\\.?\\s+', '', 'i'
                        ))
                        OR (
                          e.title IS NOT NULL AND e.title <> ''
                          AND lower(btrim(e.title || '. ' || e.name)) = lower(btrim(COALESCE(
                              NULLIF(btrim(lap.allocated_person), ''),
                              NULLIF(btrim(mb.allocated_person), ''),
                              NULLIF(btrim(oa.pc_name), ''),
                              NULLIF(btrim(oa.user_name), ''),
                              NULLIF(btrim(h.assigned_person_name), ''),
                              ''
                          )))
                        )
                        OR COALESCE(
                              NULLIF(btrim(lap.allocated_person), ''),
                              NULLIF(btrim(mb.allocated_person), ''),
                              NULLIF(btrim(oa.pc_name), ''),
                              NULLIF(btrim(oa.user_name), ''),
                              NULLIF(btrim(h.assigned_person_name), '')
                            )
                            ILIKE ('%' || e.name || '%')
                      )
                    ORDER BY
                      CASE WHEN e.company_id = a.company_id THEN 0 ELSE 1 END,
                      e.id
                    LIMIT 1
                ) emp ON TRUE
                WHERE a.category IN ('laptop', 'mobile_phone', 'other')
                  -- Once removed/printed, stay off this queue until status changes
                  -- (return → available, or new handover → deployed clears the hide flag)
                  AND COALESCE(
                        lap.handover_report_hidden_at,
                        mb.handover_report_hidden_at,
                        oa.handover_report_hidden_at
                      ) IS NULL
                  AND (
                    a.status = 'available'
                    OR (
                      h.id IS NOT NULL
                      AND h.is_open = TRUE
                      AND h.acceptance_form_printed_at IS NULL
                    )
                    OR (
                      a.category IN ('laptop', 'mobile_phone')
                      AND (
                        NULLIF(btrim(lap.allocated_person), '') IS NOT NULL
                        OR NULLIF(btrim(mb.allocated_person), '') IS NOT NULL
                      )
                    )
                  )";
        $params = [];

        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND a.company_id = :company_id';
            $params['company_id'] = $user['company_id'];
        } elseif ($request->input('company_id')) {
            $sql .= ' AND a.company_id = :company_id';
            $params['company_id'] = (int) $request->input('company_id');
        }

        if ($request->input('asset_type')) {
            $type = (string) $request->input('asset_type');
            if (in_array($type, ['laptop', 'mobile_phone', 'other'], true)) {
                $sql .= ' AND a.category = :asset_type';
                $params['asset_type'] = $type;
            }
        }

        $sql .= ' ORDER BY a.created_at DESC, a.asset_tag ASC LIMIT 1000';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
        } catch (\Throwable) {
            Response::error('Could not load handover report devices', 500);
            return;
        }

        $seen = [];
        $unique = [];
        foreach ($rows as $row) {
            $key = (string) ($row['asset_type'] ?? '') . ':' . (string) ($row['asset_id'] ?? '');
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $unique[] = $row;
        }

        Response::json(['data' => $unique, 'meta' => ['source' => 'database', 'total' => count($unique)]]);
    }

    /**
     * Hide laptops / mobile phones / other assets from the Handover Reports list
     * (manual remove or after print).
     * Body: { items: [{ asset_id, asset_type }] }
     */
    public function hideFromReports(Request $request, array $user): void
    {
        $rawItems = $request->input('items', []);
        if (! is_array($rawItems) || $rawItems === []) {
            Response::error('items must be a non-empty array', 422);
            return;
        }

        $tables = [
            'laptop' => 'laptops',
            'mobile_phone' => 'mobile_phones',
            'other' => 'other_assets',
        ];
        $hidden = [];

        foreach ($rawItems as $raw) {
            if (! is_array($raw)) {
                continue;
            }
            $assetId = (int) ($raw['asset_id'] ?? 0);
            $type = (string) ($raw['asset_type'] ?? $raw['category'] ?? '');
            if ($assetId < 1 || ! isset($tables[$type])) {
                continue;
            }

            $table = $tables[$type];
            $find = $this->pdo->prepare("SELECT id, company_id FROM {$table} WHERE id = :id");
            $find->execute(['id' => $assetId]);
            $row = $find->fetch();
            if (! $row) {
                continue;
            }
            Auth::assertCompanyAccess($user, (int) $row['company_id']);

            $this->pdo->prepare(
                "UPDATE {$table}
                 SET handover_report_hidden_at = COALESCE(handover_report_hidden_at, NOW()),
                     updated_at = NOW()
                 WHERE id = :id"
            )->execute(['id' => $assetId]);

            // Also mark latest unprinted handover so it does not reappear while still open
            $latest = $this->pdo->prepare(
                'SELECT id FROM asset_handovers
                 WHERE asset_id = :aid AND asset_type = :atype
                 ORDER BY id DESC LIMIT 1'
            );
            $latest->execute(['aid' => $assetId, 'atype' => $type]);
            $latestId = $latest->fetchColumn();
            if ($latestId) {
                $this->pdo->prepare(
                    'UPDATE asset_handovers
                     SET acceptance_form_printed_at = COALESCE(acceptance_form_printed_at, NOW()),
                         updated_at = NOW()
                     WHERE id = :hid AND acceptance_form_printed_at IS NULL'
                )->execute(['hid' => (int) $latestId]);
            }

            $hidden[] = ['asset_id' => $assetId, 'asset_type' => $type];
        }

        Response::json(['data' => ['hidden' => $hidden, 'count' => count($hidden)]]);
    }

    public function acceptanceForm(Request $request, array $user, array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $form = $this->loadAcceptanceForm($id, $user);
        if ($form === null) {
            return;
        }
        Response::json(['data' => $form]);
    }

    public function acceptanceFormCombined(Request $request, array $user): void
    {
        $rawIds = $request->input('ids', $request->input('handover_ids', []));
        $rawItems = $request->input('items', []);

        $ids = [];
        if (is_array($rawIds)) {
            foreach ($rawIds as $raw) {
                $id = (int) $raw;
                if ($id > 0 && ! in_array($id, $ids, true)) {
                    $ids[] = $id;
                }
            }
        }

        // Allow building forms from asset rows that do not yet have an asset_handovers row
        if (is_array($rawItems)) {
            foreach ($rawItems as $item) {
                if (! is_array($item)) {
                    continue;
                }
                $assetId = (int) ($item['asset_id'] ?? 0);
                $assetType = (string) ($item['asset_type'] ?? '');
                if ($assetId < 1 || ! isset(self::TABLES[$assetType])) {
                    continue;
                }
                $hid = $this->ensureOpenHandoverForAsset($assetId, $assetType, $user);
                if ($hid > 0 && ! in_array($hid, $ids, true)) {
                    $ids[] = $hid;
                }
            }
        }

        if ($ids === []) {
            Response::error('Select at least one handover or asset', 422);
            return;
        }
        if (count($ids) > 20) {
            Response::error('You can include at most 20 handovers on one form', 422);
            return;
        }

        $forms = [];
        foreach ($ids as $id) {
            $form = $this->loadAcceptanceForm($id, $user);
            if ($form === null) {
                return; // loadAcceptanceForm already sent the error response
            }
            $forms[] = $form;
        }

        $primary = $forms[0];
        $equipment = [];
        $locations = [];
        $gatePasses = [];
        $remarks = [];
        $handoverIds = [];
        $assets = [];
        $dates = [];
        $itNames = [];

        foreach ($forms as $form) {
            foreach ($form['equipment'] as $row) {
                $equipment[] = $row;
            }
            if (($form['location_name'] ?? '') !== '') {
                $locations[] = (string) $form['location_name'];
            }
            if (($form['gate_pass_no'] ?? '') !== '') {
                $gatePasses[] = (string) $form['gate_pass_no'];
            }
            if (($form['checkout_remarks'] ?? '') !== '') {
                $remarks[] = (string) $form['checkout_remarks'];
            }
            $handoverIds[] = (int) $form['handover_id'];
            if (! empty($form['asset'])) {
                $assets[] = $form['asset'];
            }
            $d = (string) ($form['signatures']['employee_date'] ?? '');
            if ($d !== '') {
                $dates[] = $d;
            }
            $it = (string) ($form['signatures']['it_representative_name'] ?? '');
            if ($it !== '') {
                $itNames[] = $it;
            }
        }

        // Drop duplicate equipment rows if the same asset was resolved more than once
        $seenEq = [];
        $deduped = [];
        foreach ($equipment as $row) {
            $key = strtolower(trim((string) ($row['equipment_type'] ?? '')))
                . '|' . strtolower(trim((string) ($row['asset_tag'] ?? '')))
                . '|' . strtolower(trim((string) ($row['serial_imei'] ?? '')))
                . '|' . strtolower(trim((string) ($row['make_model'] ?? '')));
            if (isset($seenEq[$key])) {
                continue;
            }
            $seenEq[$key] = true;
            $deduped[] = $row;
        }
        $equipment = $deduped;

        // Prefer richest employee fields across selected handovers
        $employee = $primary['employee'];
        foreach ($forms as $form) {
            foreach (['name', 'staff_id', 'designation', 'department', 'contact_number', 'company_email'] as $key) {
                if (($employee[$key] ?? '') === '' && ($form['employee'][$key] ?? '') !== '') {
                    $employee[$key] = $form['employee'][$key];
                }
            }
        }

        $formDate = $dates !== [] ? max($dates) : '';

        Response::json([
            'data' => [
                'handover_id' => $primary['handover_id'],
                'handover_ids' => $handoverIds,
                'form_title' => 'IT Hardware Acceptance Form',
                'company_name' => $primary['company_name'],
                'company_short' => $primary['company_short'],
                'employee' => $employee,
                'equipment' => $equipment,
                'location_name' => implode(' · ', array_values(array_unique($locations))),
                'gate_pass_no' => implode(', ', array_values(array_unique($gatePasses))),
                'checkout_remarks' => implode(' | ', array_values(array_unique($remarks))),
                'assets' => $assets,
                'asset' => $primary['asset'],
                'signatures' => [
                    'employee_date' => $formDate,
                    'it_representative_name' => $itNames[0] ?? '',
                    'it_date' => $formDate,
                ],
            ],
        ]);
    }

    /**
     * Mark acceptance forms as printed so they leave the Handover Reports queue.
     */
    public function markAcceptanceFormPrinted(Request $request, array $user): void
    {
        $rawIds = $request->input('ids', $request->input('handover_ids', []));
        if (! is_array($rawIds)) {
            Response::error('ids must be an array of handover ids', 422);
            return;
        }

        $ids = [];
        foreach ($rawIds as $raw) {
            $id = (int) $raw;
            if ($id > 0 && ! in_array($id, $ids, true)) {
                $ids[] = $id;
            }
        }

        if ($ids === []) {
            Response::error('Select at least one handover', 422);
            return;
        }

        $placeholders = [];
        $params = [];
        foreach ($ids as $i => $id) {
            $key = 'id' . $i;
            $placeholders[] = ':' . $key;
            $params[$key] = $id;
        }

        $sql = 'SELECT id, company_id FROM asset_handovers WHERE id IN (' . implode(',', $placeholders) . ')';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        if (count($rows) !== count($ids)) {
            Response::error('One or more handovers were not found', 404);
            return;
        }

        foreach ($rows as $row) {
            Auth::assertCompanyAccess($user, (int) $row['company_id']);
        }

        $upd = $this->pdo->prepare(
            'UPDATE asset_handovers
             SET acceptance_form_printed_at = COALESCE(acceptance_form_printed_at, NOW()),
                 updated_at = NOW()
             WHERE id IN (' . implode(',', $placeholders) . ')'
        );
        $upd->execute($params);

        // Remove related laptops / mobile phones / other assets from the Handover Reports queue
        $assets = $this->pdo->prepare(
            'SELECT asset_id, asset_type FROM asset_handovers WHERE id IN (' . implode(',', $placeholders) . ')'
        );
        $assets->execute($params);
        $hideTables = [
            'laptop' => 'laptops',
            'mobile_phone' => 'mobile_phones',
            'other' => 'other_assets',
        ];
        foreach ($assets->fetchAll() as $asset) {
            $type = (string) ($asset['asset_type'] ?? '');
            $table = $hideTables[$type] ?? null;
            if ($table === null) {
                continue;
            }
            $this->pdo->prepare(
                "UPDATE {$table}
                 SET handover_report_hidden_at = COALESCE(handover_report_hidden_at, NOW()),
                     updated_at = NOW()
                 WHERE id = :id"
            )->execute(['id' => (int) $asset['asset_id']]);
        }

        Response::json([
            'data' => [
                'printed_ids' => $ids,
                'count' => count($ids),
            ],
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function loadAcceptanceForm(int $id, array $user): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT h.*,
                    COALESCE(NULLIF(h.assigned_person_name, \'\'), u.name) AS assigned_person_name,
                    u.email AS user_email,
                    u.phone AS user_phone,
                    ud.name AS user_department_name,
                    it.name AS it_staff_name,
                    c.name AS company_name,
                    c.short_name AS company_short,
                    c.code AS company_code
             FROM asset_handovers h
             LEFT JOIN users u ON u.id = h.assigned_employee_id
             LEFT JOIN departments ud ON ud.id = u.department_id
             LEFT JOIN users it ON it.id = h.assigned_by_it_staff_id
             JOIN companies c ON c.id = h.company_id
             WHERE h.id = :id'
        );
        $stmt->execute(['id' => $id]);
        $handover = $stmt->fetch();
        if (! $handover) {
            Response::error('Handover not found', 404);
            return null;
        }
        Auth::assertCompanyAccess($user, (int) $handover['company_id']);

        $assetType = (string) ($handover['asset_type'] ?? '');
        if (! isset(self::TABLES[$assetType])) {
            Response::error('Unsupported asset type', 422);
            return null;
        }

        $table = self::TABLES[$assetType];
        $assetStmt = $this->pdo->prepare(
            "SELECT a.*,
                    d.name AS department_name,
                    l.name AS location_name,
                    s.name AS supplier_name
             FROM {$table} a
             LEFT JOIN departments d ON d.id = a.department_id
             LEFT JOIN locations l ON l.id = a.location_id
             LEFT JOIN suppliers s ON s.id = a.supplier_id
             WHERE a.id = :id"
        );
        $assetStmt->execute(['id' => (int) $handover['asset_id']]);
        $asset = $assetStmt->fetch();
        if (! $asset) {
            Response::error('Asset not found', 404);
            return null;
        }

        // Enrich from Organization HR employees table (Excel directory)
        $personName = trim((string) (
            $asset['allocated_person']
            ?? $handover['assigned_person_name']
            ?? ''
        ));
        $hr = $this->findEmployeeByPersonName($personName, (int) ($handover['company_id'] ?? 0));
        if ($hr) {
            $handover['employee_staff_id'] = $hr['staff_id'] ?? '';
            $handover['employee_name'] = $hr['name'] ?? '';
            $handover['employee_designation'] = $hr['designation'] ?? '';
            $handover['employee_department_name'] = $hr['department_name']
                ?? $handover['user_department_name']
                ?? '';
            $handover['employee_work_location'] = $hr['work_location'] ?? '';
            $handover['employee_epf_number'] = $hr['epf_number'] ?? '';
            if (trim((string) ($handover['assigned_person_name'] ?? '')) === '') {
                $title = trim((string) ($hr['title'] ?? ''));
                $handover['assigned_person_name'] = $title !== ''
                    ? $title . '. ' . $hr['name']
                    : (string) $hr['name'];
            }
        } else {
            $handover['employee_staff_id'] = $handover['employee_staff_id'] ?? '';
            $handover['employee_department_name'] = $handover['user_department_name'] ?? '';
            $handover['employee_email'] = $handover['user_email'] ?? '';
            $handover['employee_phone'] = $handover['user_phone'] ?? '';
        }

        return $this->buildAcceptanceFormPayload($handover, $asset, $assetType);
    }

    /**
     * Match a free-text person name to the HR employees directory.
     *
     * @return array<string, mixed>|null
     */
    private function findEmployeeByPersonName(string $personName, int $companyId = 0): ?array
    {
        $personName = trim($personName);
        if ($personName === '') {
            return null;
        }
        $bare = trim((string) preg_replace('/^(mr|mrs|ms|miss)\.?\s+/i', '', $personName));
        if ($bare === '') {
            return null;
        }

        $sql = "SELECT id, company_id, staff_id, name, title, epf_number, designation,
                       work_location, department_name
                FROM employees
                WHERE is_active = TRUE
                  AND (
                    lower(btrim(name)) = lower(:bare)
                    OR lower(btrim(COALESCE(title, '') || '. ' || name)) = lower(:full)
                    OR :person ILIKE ('%' || name || '%')
                    OR name ILIKE :like
                  )";
        $params = [
            'bare' => $bare,
            'full' => $personName,
            'person' => $personName,
            'like' => '%' . $bare . '%',
        ];
        if ($companyId > 0) {
            $sql .= ' ORDER BY CASE WHEN company_id = :cid THEN 0 ELSE 1 END, id ASC LIMIT 1';
            $params['cid'] = $companyId;
        } else {
            $sql .= ' ORDER BY id ASC LIMIT 1';
        }

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $row = $stmt->fetch();
            return $row ?: null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Ensure an open handover row exists for an asset (create from allocated_person if needed).
     */
    private function ensureOpenHandoverForAsset(int $assetId, string $assetType, array $user): int
    {
        if ($assetId < 1 || ! isset(self::TABLES[$assetType])) {
            return 0;
        }

        $existing = $this->pdo->prepare(
            'SELECT id FROM asset_handovers
             WHERE asset_id = :aid AND asset_type = :atype AND is_open = TRUE
             ORDER BY id DESC LIMIT 1'
        );
        $existing->execute(['aid' => $assetId, 'atype' => $assetType]);
        $openId = (int) $existing->fetchColumn();
        if ($openId > 0) {
            return $openId;
        }

        $table = self::TABLES[$assetType];
        $assetStmt = $this->pdo->prepare("SELECT * FROM {$table} WHERE id = :id LIMIT 1");
        $assetStmt->execute(['id' => $assetId]);
        $asset = $assetStmt->fetch();
        if (! $asset) {
            return 0;
        }

        Auth::assertCompanyAccess($user, (int) $asset['company_id']);

        $person = trim((string) (
            $asset['allocated_person']
            ?? $asset['original_assigned_person']
            ?? $asset['pc_name']
            ?? $asset['user_name']
            ?? ''
        ));
        if ($person === '') {
            // Still create a stub so the form can be edited later
            $person = 'Unassigned';
        }
        $date = substr((string) (
            $asset['allocated_on']
            ?? $asset['handover_date']
            ?? date('Y-m-d')
        ), 0, 10);
        if ($date === '') {
            $date = date('Y-m-d');
        }

        $itStaffId = (int) ($user['id'] ?? 0);
        if ($itStaffId < 1) {
            return 0;
        }

        $ins = $this->pdo->prepare(
            'INSERT INTO asset_handovers (
                company_id, asset_id, asset_type, handover_date, assigned_employee_id, assigned_person_name,
                assigned_by_it_staff_id, checkout_condition, is_open
             ) VALUES (
                :company_id, :asset_id, :asset_type, :handover_date, NULL, :assigned_person_name,
                :assigned_by_it_staff_id, \'good\', TRUE
             ) RETURNING id'
        );
        $ins->execute([
            'company_id' => (int) $asset['company_id'],
            'asset_id' => $assetId,
            'asset_type' => $assetType,
            'handover_date' => $date,
            'assigned_person_name' => $person,
            'assigned_by_it_staff_id' => $itStaffId,
        ]);

        return (int) $ins->fetchColumn();
    }

    /**
     * @param array<string, mixed> $handover
     * @param array<string, mixed> $asset
     * @return array<string, mixed>
     */
    private function buildAcceptanceFormPayload(array $handover, array $asset, string $assetType): array
    {
        $condition = self::conditionLabel((string) ($handover['checkout_condition'] ?? 'good'));
        $typeLabel = match ($assetType) {
            'laptop' => 'Laptop',
            'mobile_phone' => 'Mobile Phone',
            'pc' => 'Desktop PC',
            'printer' => 'Printer',
            'other' => 'Other Asset',
            default => ucfirst(str_replace('_', ' ', $assetType)),
        };

        $makeModel = trim(implode(' ', array_filter([
            (string) ($asset['brand'] ?? ''),
            (string) ($asset['model'] ?? ''),
        ])));
        if ($assetType === 'other' && $makeModel === '') {
            $makeModel = trim((string) ($asset['item_name'] ?? ''));
        }

        $serial = (string) ($asset['serial_number'] ?? '');
        if ($assetType === 'mobile_phone') {
            $imeiParts = array_filter([
                (string) ($asset['imei_number'] ?? ''),
                (string) ($asset['imei_number_2'] ?? ''),
            ]);
            if ($imeiParts !== []) {
                $serial = $serial !== ''
                    ? $serial . ' / ' . implode(' · ', $imeiParts)
                    : implode(' · ', $imeiParts);
            }
        }

        $equipmentType = $typeLabel;
        if ($assetType === 'other') {
            $itemName = trim((string) ($asset['item_name'] ?? ''));
            if ($itemName !== '') {
                $equipmentType = $itemName;
            }
        }

        $equipment = [[
            'equipment_type' => $equipmentType,
            'make_model' => $makeModel !== '' ? $makeModel : '—',
            'serial_imei' => $serial !== '' ? $serial : '—',
            'asset_tag' => (string) ($asset['asset_tag'] ?? '—'),
            'condition' => $condition,
        ]];

        if ($assetType === 'laptop') {
            // Standard laptop kit — always listed on the acceptance form
            $equipment[] = [
                'equipment_type' => 'Laptop charger',
                'make_model' => '—',
                'serial_imei' => '—',
                'asset_tag' => '—',
                'condition' => $condition,
            ];
            $equipment[] = [
                'equipment_type' => 'Laptop backpack',
                'make_model' => '—',
                'serial_imei' => '—',
                'asset_tag' => '—',
                'condition' => $condition,
            ];
        }

        if ($assetType === 'pc') {
            if (! empty($asset['monitor_brand'])) {
                $equipment[] = [
                    'equipment_type' => 'Monitor',
                    'make_model' => (string) $asset['monitor_brand'],
                    'serial_imei' => '—',
                    'asset_tag' => '—',
                    'condition' => $condition,
                ];
            }
            if (self::isTruthy($asset['has_power_cable'] ?? false)) {
                $equipment[] = [
                    'equipment_type' => 'Power cable',
                    'make_model' => '—',
                    'serial_imei' => '—',
                    'asset_tag' => '—',
                    'condition' => $condition,
                ];
            }
            if (self::isTruthy($asset['has_vga_cable'] ?? false)) {
                $equipment[] = [
                    'equipment_type' => 'VGA cable',
                    'make_model' => '—',
                    'serial_imei' => '—',
                    'asset_tag' => '—',
                    'condition' => $condition,
                ];
            }
            if (self::isTruthy($asset['has_keyboard'] ?? false)) {
                $equipment[] = [
                    'equipment_type' => 'Keyboard',
                    'make_model' => '—',
                    'serial_imei' => '—',
                    'asset_tag' => '—',
                    'condition' => $condition,
                ];
            }
            if (self::isTruthy($asset['has_mouse'] ?? false)) {
                $equipment[] = [
                    'equipment_type' => 'Mouse',
                    'make_model' => '—',
                    'serial_imei' => '—',
                    'asset_tag' => '—',
                    'condition' => $condition,
                ];
            }
            if (self::isTruthy($asset['has_ups'] ?? false)) {
                $ups = trim(implode(' ', array_filter([
                    (string) ($asset['ups_brand'] ?? ''),
                    (string) ($asset['ups_model'] ?? ''),
                ])));
                $equipment[] = [
                    'equipment_type' => 'UPS',
                    'make_model' => $ups !== '' ? $ups : '650',
                    'serial_imei' => '—',
                    'asset_tag' => '—',
                    'condition' => $condition,
                ];
            }
        }

        if ($assetType === 'mobile_phone') {
            $phoneNumber = trim((string) ($asset['phone_number'] ?? ''));
            if ($phoneNumber !== '') {
                $equipment[] = [
                    'equipment_type' => 'Mobile number',
                    'make_model' => $phoneNumber,
                    'serial_imei' => '—',
                    'asset_tag' => '—',
                    'condition' => $condition,
                ];
            }

            $parts = [];
            if (self::isTruthy($asset['has_charger'] ?? true)) {
                $parts[] = 'Charger';
            }
            if (self::isTruthy($asset['has_data_cable'] ?? true)) {
                $parts[] = 'Data cable';
            }
            if (self::isTruthy($asset['has_back_cover'] ?? false)) {
                $parts[] = 'Back cover';
            }
            if ($parts !== []) {
                $equipment[] = [
                    'equipment_type' => implode(' & ', $parts),
                    'make_model' => '—',
                    'serial_imei' => '—',
                    'asset_tag' => '—',
                    'condition' => $condition,
                ];
            }
        }

        // Do not auto-include other devices (e.g. the employee's mobile on a laptop form).
        // Combined forms only list equipment from the handovers / assets the user selected.

        $handoverDate = substr((string) ($handover['handover_date'] ?? ''), 0, 10);
        $employeeName = $this->resolveAcceptanceEmployeeName($handover, $asset, $assetType);

        // Prefer the current holder's open handover date when available
        if (in_array($assetType, ['laptop', 'mobile_phone'], true)) {
            $allocOn = trim((string) ($asset['allocated_on'] ?? ''));
            if ($allocOn !== '') {
                $handoverDate = substr($allocOn, 0, 10);
            }
        }

        return [
            'handover_id' => (int) $handover['id'],
            'form_title' => 'IT Hardware Acceptance Form',
            'company_name' => (string) ($handover['company_name'] ?? 'Indra Group'),
            'company_short' => (string) ($handover['company_short'] ?? ''),
            'employee' => [
                'name' => $employeeName !== ''
                    ? $employeeName
                    : (string) ($handover['assigned_person_name'] ?? ''),
                'staff_id' => (string) ($handover['employee_staff_id'] ?? ''),
                'designation' => (string) ($handover['employee_designation'] ?? ''),
                'department' => (string) (
                    $handover['employee_department_name']
                    ?? $asset['department_name']
                    ?? ''
                ),
                'contact_number' => (string) (
                    $handover['employee_phone']
                    ?? $asset['phone_number']
                    ?? ''
                ),
                'company_email' => (string) ($handover['employee_email'] ?? ''),
                'work_location' => (string) ($handover['employee_work_location'] ?? ''),
                'epf_number' => (string) ($handover['employee_epf_number'] ?? ''),
            ],
            'equipment' => $equipment,
            'location_name' => (string) (
                $asset['location_name']
                ?? $handover['employee_work_location']
                ?? ''
            ),
            'gate_pass_no' => (string) ($handover['gate_pass_no'] ?? ''),
            'checkout_remarks' => (string) ($handover['checkout_remarks'] ?? ''),
            'asset' => [
                'id' => (int) $asset['id'],
                'category' => $assetType,
                'asset_tag' => (string) ($asset['asset_tag'] ?? ''),
                'name' => (string) ($asset['pc_name'] ?? $asset['user_name'] ?? ''),
            ],
            'signatures' => [
                'employee_date' => $handoverDate,
                'it_representative_name' => (string) ($handover['it_staff_name'] ?? ''),
                'it_date' => $handoverDate,
            ],
        ];
    }

    /**
     * Employee name on the acceptance form = current holder (2nd/3rd/… handover),
     * not the originally assigned person when the asset was passed on.
     *
     * @param array<string, mixed> $handover
     * @param array<string, mixed> $asset
     */
    private function resolveAcceptanceEmployeeName(array $handover, array $asset, string $assetType): string
    {
        // 1) Current allocated / open holder on the asset
        $allocated = trim((string) ($asset['allocated_person'] ?? ''));
        if ($allocated === '') {
            $allocated = trim((string) ($asset['pc_name'] ?? $asset['user_name'] ?? ''));
        }
        if ($allocated !== '') {
            return $allocated;
        }

        // 2) Latest filled handover slot (person 8 → 1) — covers returned assets
        if (in_array($assetType, ['laptop', 'mobile_phone', 'pc'], true)) {
            for ($n = 8; $n >= 1; $n--) {
                $slot = trim((string) ($asset['handover_person_' . $n] ?? ''));
                if ($slot !== '') {
                    return $slot;
                }
            }
            $legacy = trim((string) ($asset['first_handover_person'] ?? ''));
            if ($legacy !== '' && $assetType === 'mobile_phone') {
                // Prefer allocated already handled; first_handover is original only
            }
        }

        // 3) Latest open handover row for this asset (authoritative current holder)
        $latest = $this->pdo->prepare(
            'SELECT assigned_person_name
             FROM asset_handovers
             WHERE asset_id = :aid AND asset_type = :atype
             ORDER BY is_open DESC, id DESC
             LIMIT 1'
        );
        $latest->execute([
            'aid' => (int) ($asset['id'] ?? $handover['asset_id'] ?? 0),
            'atype' => $assetType,
        ]);
        $latestName = trim((string) ($latest->fetchColumn() ?: ''));
        if ($latestName !== '') {
            return $latestName;
        }

        // 4) Fall back to the handover row used to build the form
        return trim((string) ($handover['assigned_person_name'] ?? ''));
    }

    private static function conditionLabel(string $code): string
    {
        return match ($code) {
            'excellent' => 'Excellent',
            'good' => 'Good',
            'fair' => 'Fair',
            'damaged' => 'Damaged',
            'missing_parts' => 'Missing parts',
            default => $code !== '' ? ucfirst(str_replace('_', ' ', $code)) : 'Good',
        };
    }

    private static function isTruthy(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 't' || $value === 'true';
    }

    /**
     * Assign asset to a person. If already checked out, closes the previous
     * open handover first so multiple sequential people are recorded (1st, 2nd, 3rd…).
     */
    public function checkout(Request $request, array $user): void
    {
        $assetId = (int) $request->input('asset_id', 0);
        $assetType = (string) $request->input('asset_type', $request->input('category', ''));
        $personName = trim((string) $request->input('assigned_person_name', ''));
        $handoverDate = trim((string) $request->input('handover_date', ''));

        if ($assetId < 1 || $personName === '' || ! isset(self::TABLES[$assetType])) {
            Response::error('asset_id, asset_type and assigned_person_name required', 422);
            return;
        }
        if ($handoverDate === '') {
            Response::error('handover_date is required for every handover person', 422);
            return;
        }

        $table = self::TABLES[$assetType];
        $asset = $this->pdo->prepare('SELECT * FROM ' . $table . ' WHERE id = :id');
        $asset->execute(['id' => $assetId]);
        $assetRow = $asset->fetch();
        if (! $assetRow) {
            Response::error('Asset not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $assetRow['company_id']);

        $slots = new HandoverSlotSync($this->pdo);
        $maxPersons = HandoverSlotSync::maxPersonsFor($assetType, is_array($assetRow) ? $assetRow : null);
        if ($slots->count($assetType, $assetId) >= $maxPersons) {
            Response::error(
                "Maximum of {$maxPersons} handover persons reached for this asset",
                422
            );
            return;
        }

        $isPgsql = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql';

        try {
            $this->pdo->beginTransaction();

            $openStmt = $this->pdo->prepare(
                'SELECT id, assigned_person_name FROM asset_handovers
                 WHERE asset_id = :asset_id AND asset_type = :asset_type AND is_open = TRUE
                 LIMIT 1'
            );
            $openStmt->execute(['asset_id' => $assetId, 'asset_type' => $assetType]);
            $open = $openStmt->fetch();

            if ($open) {
                $currentHolder = trim((string) ($open['assigned_person_name'] ?? ''));
                // Do not create a new chain slot when handing over to the same person again
                if ($currentHolder !== '' && strcasecmp($currentHolder, $personName) === 0) {
                    $this->pdo->rollBack();
                    Response::error(
                        'This asset is already allocated to ' . $currentHolder . '. Pick a different person for the next handover.',
                        422
                    );
                    return;
                }
                // Previous return date is independent of the next handover date — only set when
                // explicitly provided. Otherwise leave return blank so it can be entered manually.
                $prevReturn = trim((string) $request->input('previous_return_date', ''));
                $prevRemarks = trim((string) ($request->input('previous_return_remarks')
                    ?: ('Transferred to ' . $personName)));
                if ($prevReturn !== '') {
                    $close = $this->pdo->prepare(
                        'UPDATE asset_handovers SET
                            return_date = :return_date,
                            return_received_by_id = :received_by,
                            return_condition = :condition,
                            return_remarks = :remarks,
                            is_open = FALSE,
                            updated_at = NOW()
                         WHERE id = :id'
                    );
                    $close->execute([
                        'return_date' => $prevReturn,
                        'received_by' => $user['id'],
                        'condition' => $request->input('previous_return_condition') ?: 'good',
                        'remarks' => $prevRemarks,
                        'id' => $open['id'],
                    ]);
                } else {
                    $close = $this->pdo->prepare(
                        'UPDATE asset_handovers SET
                            return_date = NULL,
                            return_received_by_id = NULL,
                            return_condition = NULL,
                            return_remarks = :remarks,
                            is_open = FALSE,
                            updated_at = NOW()
                         WHERE id = :id'
                    );
                    $close->execute([
                        'remarks' => $prevRemarks,
                        'id' => $open['id'],
                    ]);
                }
            }

            $sql = 'INSERT INTO asset_handovers (
                        company_id, asset_id, asset_type, handover_date, assigned_employee_id, assigned_person_name,
                        assigned_by_it_staff_id, checkout_condition, checkout_remarks, gate_pass_no, is_open
                    ) VALUES (
                        :company_id, :asset_id, :asset_type, :handover_date, NULL, :assigned_person_name,
                        :assigned_by_it_staff_id, :checkout_condition, :checkout_remarks, :gate_pass_no, TRUE
                    )';
            if ($isPgsql) {
                $sql .= ' RETURNING *';
            }

            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                'company_id' => $assetRow['company_id'],
                'asset_id' => $assetId,
                'asset_type' => $assetType,
                'handover_date' => $handoverDate,
                'assigned_person_name' => $personName,
                'assigned_by_it_staff_id' => $user['id'],
                'checkout_condition' => $request->input('checkout_condition') ?: 'good',
                'checkout_remarks' => $request->input('checkout_remarks') ?: null,
                'gate_pass_no' => $request->input('gate_pass_no') ?: ('GP-' . date('Ymd') . '-' . $assetId),
            ]);

            if ($isPgsql) {
                $created = $stmt->fetch() ?: [];
            } else {
                $newId = (int) $this->pdo->lastInsertId();
                $fetch = $this->pdo->prepare('SELECT * FROM asset_handovers WHERE id = :id');
                $fetch->execute(['id' => $newId]);
                $created = $fetch->fetch() ?: [];
            }

            // New holder (any slot) must reappear on Handover Reports for printing
            if (in_array($assetType, ['laptop', 'mobile_phone', 'other'], true)) {
                $this->pdo->prepare(
                    "UPDATE {$table}
                     SET status = 'deployed',
                         handover_report_hidden_at = NULL,
                         updated_at = NOW()
                     WHERE id = :id"
                )->execute(['id' => $assetId]);
            } else {
                $this->pdo->prepare("UPDATE {$table} SET status = 'deployed', updated_at = NOW() WHERE id = :id")
                    ->execute(['id' => $assetId]);
            }

            // Mobile phone next-handover: optional branch / dept / SIM / accessories updates
            if ($assetType === 'mobile_phone') {
                $sets = [];
                $bind = ['id' => $assetId];
                if (array_key_exists('location_id', $request->body)) {
                    $lid = $request->input('location_id');
                    $sets[] = 'location_id = :location_id';
                    $bind['location_id'] = ($lid === null || $lid === '') ? null : (int) $lid;
                }
                if (array_key_exists('department_id', $request->body)) {
                    $did = $request->input('department_id');
                    $sets[] = 'department_id = :department_id';
                    $bind['department_id'] = ($did === null || $did === '') ? null : (int) $did;
                }
                if (array_key_exists('phone_number', $request->body)) {
                    $pn = trim((string) $request->input('phone_number', ''));
                    $sets[] = 'phone_number = :phone_number';
                    $bind['phone_number'] = $pn === '' ? null : $pn;
                }
                if (array_key_exists('has_charger', $request->body)) {
                    $sets[] = 'has_charger = :has_charger';
                    $bind['has_charger'] = self::isTruthy($request->input('has_charger'));
                }
                if (array_key_exists('has_data_cable', $request->body)) {
                    $sets[] = 'has_data_cable = :has_data_cable';
                    $bind['has_data_cable'] = self::isTruthy($request->input('has_data_cable'));
                }
                if (array_key_exists('has_back_cover', $request->body)) {
                    $sets[] = 'has_back_cover = :has_back_cover';
                    $bind['has_back_cover'] = self::isTruthy($request->input('has_back_cover'));
                }
                if ($sets !== []) {
                    $sets[] = 'updated_at = NOW()';
                    $this->pdo->prepare('UPDATE mobile_phones SET ' . implode(', ', $sets) . ' WHERE id = :id')
                        ->execute($bind);
                }
            }

            $slots->sync($assetType, $assetId);

            $countStmt = $this->pdo->prepare(
                'SELECT COUNT(*) FROM asset_handovers WHERE asset_id = :asset_id AND asset_type = :asset_type'
            );
            $countStmt->execute(['asset_id' => $assetId, 'asset_type' => $assetType]);
            $handoverNo = (int) $countStmt->fetchColumn();

            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Handover failed: ' . $e->getMessage(), 422);
            return;
        }

        $created['handover_no'] = $handoverNo;
        $created['handover_label'] = self::ordinal($handoverNo) . ' handover';
        $created['is_current'] = true;
        $created['assigned_person_name'] = $personName;

        Response::json(['data' => $created], 201);
    }

    /**
     * PUT /api/handovers/{id}
     * Edit a handover history row: person, assigned/handover date, and optional Left/Ended (return_date).
     * Does not rewrite other owners' names, and never copies this row's handover_date onto
     * a previous assignee's return_date (those stay independent / manual).
     */
    public function update(Request $request, array $user, array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $stmt = $this->pdo->prepare('SELECT * FROM asset_handovers WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $h = $stmt->fetch();
        if (! $h) {
            Response::error('Handover not found', 404);
            return;
        }
        $this->assertHandoverCompanyAccess($user, $h);

        $person = trim((string) $request->input('assigned_person_name', $h['assigned_person_name'] ?? ''));
        $date = trim((string) $request->input('handover_date', (string) ($h['handover_date'] ?? '')));

        if ($person === '') {
            Response::error('assigned_person_name is required', 422);
            return;
        }
        if ($date === '') {
            Response::error('handover_date is required', 422);
            return;
        }

        $assetType = (string) ($h['asset_type'] ?? 'laptop');
        $assetId = (int) $h['asset_id'];
        $uid = (int) ($user['id'] ?? 0) ?: null;

        // Update only this row — sibling return_date / handover_date values are untouched
        $this->pdo->prepare(
            'UPDATE asset_handovers SET
                assigned_person_name = :person,
                handover_date = :handover_date,
                updated_at = NOW()
             WHERE id = :id'
        )->execute([
            'person' => $person,
            'handover_date' => $date,
            'id' => $id,
        ]);

        $closedByReturn = false;
        $reopened = false;

        if (array_key_exists('return_date', $request->body)) {
            $rd = trim((string) $request->input('return_date', ''));
            if ($rd === '') {
                // Clear Left/Ended — reopen only if no other open handover exists for this asset
                $otherOpen = $this->pdo->prepare(
                    'SELECT id FROM asset_handovers
                     WHERE asset_id = :aid AND asset_type = :atype AND is_open = TRUE AND id <> :id
                     LIMIT 1'
                );
                $otherOpen->execute([
                    'aid' => $assetId,
                    'atype' => $assetType,
                    'id' => $id,
                ]);
                $canReopen = ! $otherOpen->fetchColumn();

                if ($canReopen) {
                    $this->pdo->prepare(
                        'UPDATE asset_handovers SET
                            return_date = NULL,
                            return_received_by_id = NULL,
                            return_condition = NULL,
                            is_open = TRUE,
                            updated_at = NOW()
                         WHERE id = :id'
                    )->execute(['id' => $id]);
                    $reopened = true;
                } else {
                    $this->pdo->prepare(
                        'UPDATE asset_handovers SET
                            return_date = NULL,
                            return_received_by_id = NULL,
                            return_condition = NULL,
                            updated_at = NOW()
                         WHERE id = :id'
                    )->execute(['id' => $id]);
                }
            } else {
                if ($rd < $date) {
                    Response::error('Left / returned date cannot be before the assigned / handover date', 422);
                    return;
                }
                // chk_return_complete requires received_by + condition with return_date
                $this->pdo->prepare(
                    'UPDATE asset_handovers SET
                        return_date = :rd,
                        return_received_by_id = COALESCE(return_received_by_id, :uid),
                        return_condition = COALESCE(return_condition, \'good\'),
                        is_open = FALSE,
                        updated_at = NOW()
                     WHERE id = :id'
                )->execute([
                    'rd' => $rd,
                    'uid' => $uid,
                    'id' => $id,
                ]);
                $closedByReturn = true;
            }
        }

        if (isset(self::TABLES[$assetType])) {
            $table = self::TABLES[$assetType];
            if ($closedByReturn) {
                // Same as check-in: asset becomes available when current holder ends
                $stillOpen = $this->pdo->prepare(
                    'SELECT 1 FROM asset_handovers
                     WHERE asset_id = :aid AND asset_type = :atype AND is_open = TRUE
                     LIMIT 1'
                );
                $stillOpen->execute(['aid' => $assetId, 'atype' => $assetType]);
                if (! $stillOpen->fetchColumn()) {
                    if (in_array($assetType, ['laptop', 'mobile_phone', 'other'], true)) {
                        $this->pdo->prepare(
                            "UPDATE {$table}
                             SET status = 'available',
                                 handover_report_hidden_at = NULL,
                                 updated_at = NOW()
                             WHERE id = :id"
                        )->execute(['id' => $assetId]);
                    } else {
                        $this->pdo->prepare(
                            "UPDATE {$table} SET status = 'available', updated_at = NOW() WHERE id = :id"
                        )->execute(['id' => $assetId]);
                    }
                }
            } elseif ($reopened) {
                $this->pdo->prepare(
                    "UPDATE {$table} SET status = 'deployed', updated_at = NOW() WHERE id = :id"
                )->execute(['id' => $assetId]);
            }
        }

        (new HandoverSlotSync($this->pdo))->sync($assetType, $assetId);

        // If return closed the last open handover, park custody under IT Department
        if ($closedByReturn && isset(self::TABLES[$assetType])) {
            $stillOpen2 = $this->pdo->prepare(
                'SELECT 1 FROM asset_handovers
                 WHERE asset_id = :aid AND asset_type = :atype AND is_open = TRUE
                 LIMIT 1'
            );
            $stillOpen2->execute(['aid' => $assetId, 'atype' => $assetType]);
            if (! $stillOpen2->fetchColumn() && in_array($assetType, ['laptop', 'mobile_phone', 'pc'], true)) {
                $table = self::TABLES[$assetType];
                $this->pdo->prepare(
                    "UPDATE {$table}
                     SET allocated_person = :holder,
                         pc_name = :holder,
                         allocated_on = COALESCE(allocated_on, CURRENT_DATE),
                         updated_at = NOW()
                     WHERE id = :id"
                )->execute([
                    'holder' => 'IT Department',
                    'id' => $assetId,
                ]);
            }
        }

        $out = $this->pdo->prepare('SELECT * FROM asset_handovers WHERE id = :id');
        $out->execute(['id' => $id]);
        $updated = $out->fetch() ?: $h;

        // Full history so the client can refresh the chain without a racey second GET
        $histStmt = $this->pdo->prepare(
            'SELECT h.id, h.handover_date, h.return_date, h.is_open, h.checkout_remarks, h.return_remarks,
                    COALESCE(NULLIF(h.assigned_person_name, \'\'), e.name) AS assigned_person_name
             FROM asset_handovers h
             LEFT JOIN users e ON e.id = h.assigned_employee_id
             WHERE h.asset_id = :aid AND h.asset_type = :atype
             ORDER BY h.id ASC'
        );
        $histStmt->execute(['aid' => $assetId, 'atype' => $assetType]);
        $history = $histStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $n = 0;
        foreach ($history as &$hr) {
            $n++;
            $hr['handover_no'] = $n;
            $hr['handover_label'] = self::ordinal($n) . ' handover';
            $open = $hr['is_open'] ?? false;
            $hr['is_current'] = $open === true || $open === 1 || $open === '1'
                || strtolower((string) $open) === 't'
                || strtolower((string) $open) === 'true';
            $hr['is_open'] = $hr['is_current'];
        }
        unset($hr);

        $assetSnap = null;
        if (isset(self::TABLES[$assetType])) {
            $aStmt = $this->pdo->prepare('SELECT * FROM ' . self::TABLES[$assetType] . ' WHERE id = :id');
            $aStmt->execute(['id' => $assetId]);
            $assetSnap = $aStmt->fetch(PDO::FETCH_ASSOC) ?: null;
            if (is_array($assetSnap)) {
                $assetSnap['category'] = $assetType;
                $assetSnap['handovers'] = $history;
                $current = null;
                foreach ($history as $hr) {
                    if (! empty($hr['is_current'])) {
                        $current = $hr;
                        break;
                    }
                }
                if ($current !== null) {
                    $assetSnap['handover_open'] = true;
                    $assetSnap['allocated_person'] = $current['assigned_person_name'];
                    $assetSnap['assigned_person_name'] = $current['assigned_person_name'];
                    $assetSnap['current_holder'] = $current['assigned_person_name'];
                    $assetSnap['allocated_on'] = $current['handover_date'] ?? null;
                    $assetSnap['current_handover_no'] = $current['handover_no'];
                } else {
                    $assetSnap['handover_open'] = false;
                    $assetSnap['allocated_person'] = null;
                    $assetSnap['assigned_person_name'] = null;
                    $assetSnap['current_holder'] = null;
                    $assetSnap['allocated_on'] = null;
                    $assetSnap['current_handover_no'] = null;
                }
            }
        }

        Response::json([
            'data' => $updated,
            'asset' => $assetSnap,
            'handovers' => $history,
            'message' => 'Handover updated',
        ]);
    }

    public function checkin(Request $request, array $user, array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $stmt = $this->pdo->prepare('SELECT * FROM asset_handovers WHERE id = :id AND is_open = TRUE');
        $stmt->execute(['id' => $id]);
        $h = $stmt->fetch();
        if (! $h) {
            Response::error('Open handover not found', 404);
            return;
        }
        $this->assertHandoverCompanyAccess($user, $h);

        $condition = (string) $request->input('return_condition', 'good');
        $returnRemarks = trim((string) ($request->input('return_remarks') ?: ''));
        if ($returnRemarks === '') {
            Response::error('Return remarks are required', 422);
            return;
        }
        $isPgsql = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql';
        $updSql = 'UPDATE asset_handovers SET
                return_date = :return_date,
                return_received_by_id = :received_by,
                return_condition = :condition,
                return_remarks = :remarks,
                is_open = FALSE,
                acceptance_form_printed_at = NULL,
                updated_at = NOW()
             WHERE id = :id';
        if ($isPgsql) {
            $updSql .= ' RETURNING *';
        }
        $upd = $this->pdo->prepare($updSql);
        $upd->execute([
            'return_date' => $request->input('return_date') ?: date('Y-m-d'),
            'received_by' => $user['id'],
            'condition' => $condition,
            'remarks' => $returnRemarks,
            'id' => $id,
        ]);

        $assetType = (string) ($h['asset_type'] ?? 'laptop');
        if (isset(self::TABLES[$assetType])) {
            $table = self::TABLES[$assetType];
            // Returned / available again — allow a fresh handover report print
            if (in_array($assetType, ['laptop', 'mobile_phone', 'other'], true)) {
                $this->pdo->prepare(
                    "UPDATE {$table}
                     SET status = 'available',
                         handover_report_hidden_at = NULL,
                         updated_at = NOW()
                     WHERE id = :id"
                )->execute(['id' => $h['asset_id']]);
            } else {
                $this->pdo->prepare("UPDATE {$table} SET status = 'available', updated_at = NOW() WHERE id = :id")
                    ->execute(['id' => $h['asset_id']]);
            }
        }

        (new HandoverSlotSync($this->pdo))->sync($assetType, (int) $h['asset_id']);

        // While Available, show temporary custody as IT Department (not a person).
        // Original handover history rows are unchanged. Cleared on next checkout sync.
        if (isset(self::TABLES[$assetType])) {
            $table = self::TABLES[$assetType];
            $itCustody = 'IT Department';
            if (in_array($assetType, ['laptop', 'mobile_phone', 'pc'], true)) {
                $this->pdo->prepare(
                    "UPDATE {$table}
                     SET allocated_person = :holder,
                         pc_name = :holder,
                         allocated_on = COALESCE(allocated_on, CURRENT_DATE),
                         updated_at = NOW()
                     WHERE id = :id"
                )->execute([
                    'holder' => $itCustody,
                    'id' => $h['asset_id'],
                ]);
            }
        }

        $row = $isPgsql ? ($upd->fetch() ?: $h) : $h;
        Response::json([
            'data' => $row,
            'message' => 'Asset returned to IT Department',
        ]);
    }

    /**
     * Allow access if user may act on the handover's company OR the asset's current company
     * (handover.company_id can lag after inter-company transfer until synced).
     *
     * @param array<string, mixed> $user
     * @param array<string, mixed> $handover
     */
    private function assertHandoverCompanyAccess(array $user, array $handover): void
    {
        if (($user['role'] ?? '') === 'super_admin') {
            return;
        }
        $handoverCid = (int) ($handover['company_id'] ?? 0);
        $userCid = (int) ($user['company_id'] ?? 0);
        if ($userCid > 0 && $userCid === $handoverCid) {
            return;
        }
        $assetType = (string) ($handover['asset_type'] ?? '');
        $assetId = (int) ($handover['asset_id'] ?? 0);
        if ($assetId > 0 && isset(self::TABLES[$assetType])) {
            $table = self::TABLES[$assetType];
            $stmt = $this->pdo->prepare("SELECT company_id FROM {$table} WHERE id = :id LIMIT 1");
            $stmt->execute(['id' => $assetId]);
            $assetCid = (int) ($stmt->fetchColumn() ?: 0);
            if ($userCid > 0 && $userCid === $assetCid) {
                // Heal stale handover company after transfer
                if ($handoverCid !== $assetCid && $assetCid > 0) {
                    $this->pdo->prepare(
                        'UPDATE asset_handovers SET company_id = :cid, updated_at = NOW() WHERE id = :id'
                    )->execute([
                        'cid' => $assetCid,
                        'id' => (int) ($handover['id'] ?? 0),
                    ]);
                }
                return;
            }
        }
        Auth::assertCompanyAccess($user, $handoverCid);
    }

    public static function ordinal(int $n): string
    {
        $mod100 = $n % 100;
        if ($mod100 >= 11 && $mod100 <= 13) {
            return $n . 'th';
        }
        return match ($n % 10) {
            1 => $n . 'st',
            2 => $n . 'nd',
            3 => $n . 'rd',
            default => $n . 'th',
        };
    }
}
