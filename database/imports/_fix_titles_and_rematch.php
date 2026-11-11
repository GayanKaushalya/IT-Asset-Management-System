<?php

declare(strict_types=1);

/**
 * 1) Fix double/broken title prefixes on asset person fields
 * 2) Second-pass fuzzy match remaining short names → Excel employees (with title)
 */

$config = require dirname(__DIR__, 2) . '/backend/config/config.php';
$db = $config['db'];
$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $db['host'],
    $db['port'],
    $db['name'],
    $db['sslmode'] ?? 'disable'
);
$pdo = new PDO($dsn, $db['user'], $db['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

$personFields = [
    'laptops' => [
        'allocated_person',
        'original_assigned_person',
        'handover_person_1',
        'handover_person_2',
        'handover_person_3',
        'handover_person_4',
    ],
    'mobile_phones' => [
        'allocated_person',
        'original_assigned_person',
        'first_handover_person',
        'handover_person_1',
        'handover_person_2',
        'handover_person_3',
        'handover_person_4',
    ],
];

function strip_titles(string $s): string
{
    $prev = null;
    while ($prev !== $s) {
        $prev = $s;
        $s = preg_replace('/^\s*(mr\.?|mrs\.?|ms\.?|miss\.?)\s+/i', '', $s) ?? $s;
    }
    return trim(preg_replace('/\s+/', ' ', $s) ?? $s);
}

function looks_short(string $raw): bool
{
    $n = strip_titles($raw);
    if ($n === '' || str_contains($n, '/') || preg_match('/\bteam\b/i', $n)) {
        return false;
    }
    // Already looks like HR full name (initials + several parts)
    if (preg_match('/\b[A-Z]\.(?:[A-Z]\.)+/', $n) && str_word_count($n) >= 3) {
        return false;
    }
    $parts = preg_split('/\s+/', $n) ?: [];
    return count($parts) <= 3 && strlen($n) <= 28;
}

function tokens(string $s): array
{
    $s = strtolower(strip_titles($s));
    $s = str_replace(['.', '/', '-', '_'], ' ', $s);
    $s = preg_replace('/[^a-z0-9\s]/', ' ', $s) ?? $s;
    $stop = [
        'mr', 'mrs', 'ms', 'miss', 'dr', 'byd', 'acc', 'sales', 'imp', 'itl', 'ims', 'isp',
        'foton', 'colombo', 'kandy', 'matara', 'mathara', 'kelaniya', 'negombo', 'anuradhapura',
        'gampola', 'embilipitiya', 'hydepark', 'hydpark', 'workshop', 'office', 'head', 'branch',
        'dealer', 'accountant', 'accounts', 'admin', 'operation', 'operations', 'support',
        'services', 'stores', 'and', 'the', 'of', 'hr', 'mkt', 'leasing', 'maintanance',
        'maintenance', 'ho',
    ];
    $out = [];
    foreach (preg_split('/\s+/', $s) ?: [] as $t) {
        if ($t === '' || in_array($t, $stop, true) || ctype_digit($t) || strlen($t) < 3) {
            continue;
        }
        $out[] = $t;
    }
    return $out;
}

// Load employees
$emps = $pdo->query(
    "SELECT id, company_id, staff_id, name, title, work_location
     FROM employees WHERE is_active = TRUE"
)->fetchAll();

$byToken = [];
foreach ($emps as $idx => $e) {
    $toks = tokens((string) $e['name']);
    $emps[$idx]['_toks'] = $toks;
    $emps[$idx]['_set'] = array_fill_keys($toks, true);
    foreach ($toks as $t) {
        $byToken[$t][] = $idx;
    }
}

function best_match(string $raw, ?int $companyId, array &$emps, array $byToken): ?array
{
    $toks = tokens($raw);
    if ($toks === []) {
        return null;
    }
    $candIdx = [];
    foreach ($toks as $t) {
        foreach ($byToken[$t] ?? [] as $idx) {
            $candIdx[$idx] = true;
        }
    }
    if ($candIdx === []) {
        return null;
    }

    $scored = [];
    foreach (array_keys($candIdx) as $idx) {
        $e = $emps[$idx];
        $inter = array_values(array_filter($toks, static fn ($t) => isset($e['_set'][$t])));
        if ($inter === []) {
            continue;
        }
        $score = 0;
        foreach ($inter as $t) {
            $score += strlen($t) + 2;
        }
        $last = $toks[count($toks) - 1];
        if (isset($e['_set'][$last])) {
            $score += 8;
        }
        if ($companyId !== null && (int) $e['company_id'] === $companyId) {
            $score += 4;
        }
        $rawL = strtolower($raw);
        $loc = strtolower((string) ($e['work_location'] ?? ''));
        foreach (['colombo', 'kandy', 'kelaniya', 'negombo', 'mathara', 'anuradhapura', '201', '140'] as $h) {
            if (str_contains($rawL, $h) && str_contains($loc, $h)) {
                $score += 3;
            }
        }
        $strong = count($inter) >= 2 || max(array_map('strlen', $inter)) >= 5;
        if (! $strong) {
            continue;
        }
        $scored[] = [$score, count($inter), $e];
    }
    if ($scored === []) {
        return null;
    }
    usort($scored, static fn ($a, $b) => $b[0] <=> $a[0] ?: $b[1] <=> $a[1]);
    if (isset($scored[1]) && $scored[1][0] >= $scored[0][0] - 1 && $scored[1][2]['id'] !== $scored[0][2]['id']) {
        $bestLast = $toks[count($toks) - 1];
        $onlyBest = isset($scored[0][2]['_set'][$bestLast]) && ! isset($scored[1][2]['_set'][$bestLast]);
        if (! $onlyBest || strlen($bestLast) < 5) {
            return null;
        }
    }
    return $scored[0][2];
}

$pdo->beginTransaction();
$fixedTitles = 0;
$matched = 0;

foreach ($personFields as $table => $fields) {
    $fieldList = implode(', ', $fields);
    $rows = $pdo->query("SELECT id, company_id, {$fieldList} FROM {$table}")->fetchAll();
    foreach ($rows as $row) {
        $sets = [];
        foreach ($fields as $f) {
            $raw = trim((string) ($row[$f] ?? ''));
            if ($raw === '') {
                continue;
            }

            $clean = strip_titles($raw);
            $display = $clean;

            if (looks_short($raw)) {
                $emp = best_match($raw, isset($row['company_id']) ? (int) $row['company_id'] : null, $emps, $byToken);
                if ($emp) {
                    $title = trim((string) ($emp['title'] ?? 'Mr'));
                    if ($title === '') {
                        $title = 'Mr';
                    }
                    $display = $title . '. ' . $emp['name'];
                    $matched++;
                } else {
                    // keep cleaned short name; normalize title if present
                    if (preg_match('/^\s*(mr|mrs|ms|miss)\b/i', $raw, $m)) {
                        $t = strtolower($m[1]);
                        $title = $t === 'mrs' ? 'Mrs' : ($t === 'ms' || $t === 'miss' ? 'Ms' : 'Mr');
                        $display = $title . '. ' . $clean;
                    }
                }
            } else {
                // full-ish name: ensure single proper title from employee if exact name match
                $empExact = null;
                foreach ($emps as $e) {
                    if (strcasecmp(strip_titles((string) $e['name']), $clean) === 0
                        || strcasecmp((string) $e['name'], $clean) === 0) {
                        $empExact = $e;
                        break;
                    }
                }
                if ($empExact) {
                    $title = trim((string) ($empExact['title'] ?? 'Mr')) ?: 'Mr';
                    $display = $title . '. ' . $empExact['name'];
                } elseif (preg_match('/^\s*(mr|mrs|ms|miss)\b/i', $raw, $m)) {
                    $t = strtolower($m[1]);
                    $title = $t === 'mrs' ? 'Mrs' : ($t === 'ms' || $t === 'miss' ? 'Ms' : 'Mr');
                    $display = $title . '. ' . $clean;
                }
            }

            if ($display !== $raw) {
                $sets[$f] = $display;
            }
        }

        if ($sets === []) {
            continue;
        }
        $parts = [];
        $params = ['id' => (int) $row['id']];
        $i = 0;
        foreach ($sets as $f => $v) {
            $key = 'v' . $i++;
            $parts[] = "{$f} = :{$key}";
            $params[$key] = $v;
            $fixedTitles++;
        }
        $sql = 'UPDATE ' . $table . ' SET ' . implode(', ', $parts) . ', updated_at = NOW() WHERE id = :id';
        $pdo->prepare($sql)->execute($params);
    }
}

$pdo->commit();
echo "Fields updated: {$fixedTitles}\n";
echo "Additional short→Excel matches this pass: {$matched}\n";

echo "\nSample laptops:\n";
foreach ($pdo->query('SELECT asset_tag, allocated_person FROM laptops WHERE allocated_person IS NOT NULL ORDER BY id LIMIT 12') as $r) {
    echo "  {$r['asset_tag']}\t{$r['allocated_person']}\n";
}
echo "\nSample phones:\n";
foreach ($pdo->query('SELECT asset_tag, allocated_person FROM mobile_phones WHERE allocated_person IS NOT NULL ORDER BY id LIMIT 12') as $r) {
    echo "  {$r['asset_tag']}\t{$r['allocated_person']}\n";
}
