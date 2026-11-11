<?php

declare(strict_types=1);

namespace Indra\Itam\Services;

use PDO;

/**
 * Keeps denormalized handover slots + original/allocated users in sync.
 *
 * - original_assigned_* = 1st handover person (never overwritten by later handovers)
 * - allocated_*         = current open handover person (cleared when returned)
 * - handover_person_1..10 + handover_on_1..10 = full chain (each person has a date)
 *
 * Consecutive duplicate handovers to the same person (e.g. double-click transfer)
 * are collapsed so the chain only lists each distinct custodian once in sequence.
 */
final class HandoverSlotSync
{
    /** Absolute column capacity (SIMs use up to this; PC uses MAX_PERSONS_PC). */
    public const MAX_PERSONS = 10;

    /** Laptops & phones: 4 custodians max. */
    public const MAX_PERSONS_DEFAULT = 4;

    /** Branch PCs: longer assignment history. */
    public const MAX_PERSONS_PC = 8;

    /** SIM cards: can be passed across up to 10 employees. */
    public const MAX_PERSONS_SIM = 10;

    /** @var array<string, string> */
    private const TABLES = [
        'laptop' => 'laptops',
        'mobile_phone' => 'mobile_phones',
        'pc' => 'pcs',
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function supports(string $assetType): bool
    {
        return isset(self::TABLES[$assetType]);
    }

    /** Max chain length for this asset type (PC = 8, SIM = 10, laptop/phone = 4). */
    public static function maxPersonsFor(string $assetType, ?array $asset = null): int
    {
        if ($assetType === 'pc') {
            return self::MAX_PERSONS_PC;
        }
        if ($assetType === 'mobile_phone' && self::assetIsSim($asset)) {
            return self::MAX_PERSONS_SIM;
        }
        return self::MAX_PERSONS_DEFAULT;
    }

    /**
     * How many handover_person_N / handover_on_N columns exist on the asset table.
     * SIMs need 10; PCs and laptops only have columns 1–8.
     */
    public static function slotColumnCount(string $assetType): int
    {
        return $assetType === 'mobile_phone' ? self::MAX_PERSONS_SIM : self::MAX_PERSONS_PC;
    }

    /** @param array<string, mixed>|null $asset */
    public static function assetIsSim(?array $asset): bool
    {
        if ($asset === null) {
            return false;
        }
        $flag = $asset['is_sim'] ?? false;
        if ($flag === true || $flag === 1 || $flag === '1' || $flag === 't' || $flag === 'true') {
            return true;
        }
        return strtoupper(trim((string) ($asset['model'] ?? ''))) === 'SIM';
    }

    public function count(string $assetType, int $assetId): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*) FROM asset_handovers WHERE asset_id = :id AND asset_type = :type'
        );
        $stmt->execute(['id' => $assetId, 'type' => $assetType]);
        return (int) $stmt->fetchColumn();
    }

    public function sync(string $assetType, int $assetId): void
    {
        if (! $this->supports($assetType)) {
            return;
        }

        $table = self::TABLES[$assetType];
        $stmt = $this->pdo->prepare(
            'SELECT id, assigned_person_name, handover_date, return_date, return_received_by_id,
                    return_condition, assigned_by_it_staff_id, is_open
             FROM asset_handovers
             WHERE asset_id = :id AND asset_type = :type
             ORDER BY id ASC'
        );
        $stmt->execute(['id' => $assetId, 'type' => $assetType]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // No history rows yet — do not blank denormalized name/slot fields on the asset
        if ($rows === []) {
            return;
        }

        // Merge accidental consecutive same-person rows (double-submit / re-transfer to self)
        $rows = $this->collapseConsecutiveDuplicates($rows);

        // Only UPDATE columns that exist on this table (pcs/laptops: 1–8; phones/SIMs: 1–10)
        $maxSlots = self::slotColumnCount($assetType);
        $assetMeta = null;
        if ($assetType === 'mobile_phone') {
            $metaStmt = $this->pdo->prepare('SELECT is_sim, model FROM mobile_phones WHERE id = :id');
            $metaStmt->execute(['id' => $assetId]);
            $assetMeta = $metaStmt->fetch(PDO::FETCH_ASSOC) ?: null;
        }
        $chainCap = self::maxPersonsFor($assetType, is_array($assetMeta) ? $assetMeta : null);
        $persons = [];
        $dates = [];
        for ($i = 1; $i <= $maxSlots; $i++) {
            $persons[$i] = null;
            $dates[$i] = null;
        }
        $allocatedPerson = null;
        $allocatedOn = null;
        $slot = 0;

        foreach ($rows as $row) {
            $name = trim((string) ($row['assigned_person_name'] ?? ''));
            if ($name === '') {
                continue;
            }
            // Skip lost-location notes that were wrongly stored as person names
            if (preg_match('/\bmissing\s+in\b/i', $name) || preg_match('/\bing\s+in\s+jaffna\b/i', $name)) {
                continue;
            }
            $slot++;
            $date = $row['handover_date'] ?: null;
            if ($date === null || $date === '') {
                $date = date('Y-m-d');
            }
            if ($slot <= $chainCap) {
                $persons[$slot] = $name;
                $dates[$slot] = $date;
            }
            if ($this->isOpenFlag($row['is_open'] ?? false)) {
                $allocatedPerson = $name;
                $allocatedOn = $date;
            }
        }

        $setParts = [];
        $bind = [
            'original_person' => $persons[1],
            'original_on' => $dates[1],
            'allocated_person' => $allocatedPerson,
            'allocated_on' => $allocatedOn,
            'id' => $assetId,
        ];
        for ($i = 1; $i <= $maxSlots; $i++) {
            $setParts[] = "handover_person_{$i} = :p{$i}";
            $setParts[] = "handover_on_{$i} = :d{$i}";
            $bind["p{$i}"] = $persons[$i];
            $bind["d{$i}"] = $dates[$i];
        }

        $origClause = $persons[1] !== null
            ? 'original_assigned_person = :original_person,
               original_assigned_on = COALESCE(:original_on, original_assigned_on),'
            : 'original_assigned_person = COALESCE(:original_person, original_assigned_person),
               original_assigned_on = COALESCE(:original_on, original_assigned_on),';

        $sql = 'UPDATE ' . $table . ' SET '
            . implode(', ', $setParts) . ', '
            . $origClause . '
               allocated_person = :allocated_person,
               allocated_on = :allocated_on,
               updated_at = NOW()';

        if ($assetType === 'mobile_phone') {
            $sql .= ', first_handover_person = :legacy_person, handed_over_on = :legacy_date';
            $bind['legacy_person'] = $persons[1];
            $bind['legacy_date'] = $dates[1];
        }

        // Keep list "Name" column aligned with current open holder (cleared when returned / Available)
        if (in_array($assetType, ['pc', 'laptop', 'mobile_phone'], true)) {
            $sql .= ', pc_name = :pc_holder_name';
            $bind['pc_holder_name'] = $allocatedPerson;
        }

        $sql .= ' WHERE id = :id';
        $upd = $this->pdo->prepare($sql);
        foreach ($bind as $key => $value) {
            if ($value === null) {
                $upd->bindValue(':' . $key, null, PDO::PARAM_NULL);
            } elseif (is_int($value)) {
                $upd->bindValue(':' . $key, $value, PDO::PARAM_INT);
            } else {
                $upd->bindValue(':' . $key, $value);
            }
        }
        $upd->execute();
    }

    /**
     * Collapse consecutive asset_handovers rows for the same person into one.
     * Keeps the earliest handover date; if any row in the group is open, the kept row stays open.
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function collapseConsecutiveDuplicates(array $rows): array
    {
        if (count($rows) < 2) {
            return $rows;
        }

        $groups = [];
        foreach ($rows as $row) {
            $nameKey = mb_strtolower(trim((string) ($row['assigned_person_name'] ?? '')));
            $last = $groups === [] ? null : $groups[count($groups) - 1];
            if ($last !== null && $nameKey !== '' && $nameKey === $last['key']) {
                $groups[count($groups) - 1]['rows'][] = $row;
            } else {
                $groups[] = ['key' => $nameKey, 'rows' => [$row]];
            }
        }

        $collapsed = [];
        $deleteIds = [];

        foreach ($groups as $group) {
            $members = $group['rows'];
            if (count($members) === 1) {
                $collapsed[] = $members[0];
                continue;
            }

            // Prefer the already-open row (avoids uq_open_handover_per_asset when merging).
            // Otherwise keep the earliest row and drop later duplicates.
            $keepIdx = 0;
            foreach ($members as $i => $m) {
                if ($this->isOpenFlag($m['is_open'] ?? false)) {
                    $keepIdx = $i;
                    break;
                }
            }
            $keep = $members[$keepIdx];
            $anyOpen = $this->isOpenFlag($keep['is_open'] ?? false);
            $lastReturn = null;
            foreach ($members as $i => $m) {
                if (! empty($m['return_date'])) {
                    $lastReturn = $m['return_date'];
                }
                if ($i !== $keepIdx) {
                    $deleteIds[] = (int) $m['id'];
                }
            }

            // Use the earliest handover date for the kept person
            $earliestDate = $keep['handover_date'] ?? null;
            foreach ($members as $m) {
                $d = $m['handover_date'] ?? null;
                if ($d && ($earliestDate === null || $d < $earliestDate)) {
                    $earliestDate = $d;
                }
            }
            if ($earliestDate) {
                $keep['handover_date'] = $earliestDate;
            }

            if ($anyOpen) {
                $keep['is_open'] = true;
                $keep['return_date'] = null;
                $keep['return_received_by_id'] = null;
                $keep['return_condition'] = null;
            } elseif ($lastReturn) {
                $keep['return_date'] = $lastReturn;
                $keep['is_open'] = false;
            }

            $collapsed[] = $keep;
        }

        if ($deleteIds !== []) {
            $placeholders = implode(',', array_fill(0, count($deleteIds), '?'));
            $del = $this->pdo->prepare("DELETE FROM asset_handovers WHERE id IN ({$placeholders})");
            $del->execute($deleteIds);
        }

        // Persist merged open/return fields on kept rows
        foreach ($collapsed as $row) {
            if (! isset($row['id'])) {
                continue;
            }
            $upd = $this->pdo->prepare(
                'UPDATE asset_handovers SET
                    handover_date = :hd,
                    return_date = :rd,
                    return_received_by_id = :rr,
                    return_condition = :rc,
                    is_open = :io,
                    updated_at = NOW()
                 WHERE id = :id'
            );
            $upd->execute([
                'hd' => $row['handover_date'] ?? null,
                'rd' => $row['return_date'] ?? null,
                'rr' => $row['return_received_by_id'] ?? null,
                'rc' => $row['return_condition'] ?? null,
                'io' => $this->isOpenFlag($row['is_open'] ?? false) ? 1 : 0,
                'id' => (int) $row['id'],
            ]);
        }

        return $collapsed;
    }

    private function isOpenFlag(mixed $v): bool
    {
        if (is_bool($v)) {
            return $v;
        }
        if (is_int($v) || is_float($v)) {
            return (int) $v === 1;
        }
        $s = strtolower(trim((string) $v));

        return in_array($s, ['1', 't', 'true', 'yes', 'y'], true);
    }
}
