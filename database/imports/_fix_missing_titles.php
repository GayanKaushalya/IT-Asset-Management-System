<?php
$config = require "d:/ITAMS/backend/config/config.php";
$db = $config["db"];
$dsn = sprintf("pgsql:host=%s;port=%s;dbname=%s;sslmode=%s", $db["host"], $db["port"], $db["name"], $db["sslmode"] ?? "disable");
$pdo = new PDO($dsn, $db["user"], $db["pass"], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);

// Strip title from Missing / IT placeholders
$n = $pdo->exec("UPDATE mobile_phones SET allocated_person = regexp_replace(allocated_person, '^\\s*(Mr\\.?|Mrs\\.?|Ms\\.?|Miss\\.?)\\s+', '', 'i'), updated_at=NOW() WHERE allocated_person ~* '^\\s*(Mr\\.?|Ms\\.?|Mrs\\.?|Miss\\.?)\\s*Missing'");
$n2 = $pdo->exec("UPDATE mobile_phones SET original_assigned_person = regexp_replace(original_assigned_person, '^\\s*(Mr\\.?|Mrs\\.?|Ms\\.?|Miss\\.?)\\s+', '', 'i'), updated_at=NOW() WHERE original_assigned_person ~* '^\\s*(Mr\\.?|Ms\\.?|Mrs\\.?|Miss\\.?)\\s*Missing'");
$n3 = $pdo->exec("UPDATE mobile_phones SET first_handover_person = regexp_replace(first_handover_person, '^\\s*(Mr\\.?|Mrs\\.?|Ms\\.?|Miss\\.?)\\s+', '', 'i'), updated_at=NOW() WHERE first_handover_person ~* '^\\s*(Mr\\.?|Ms\\.?|Mrs\\.?|Miss\\.?)\\s*Missing'");
$n4 = $pdo->exec("UPDATE mobile_phones SET handover_person_1 = regexp_replace(handover_person_1, '^\\s*(Mr\\.?|Mrs\\.?|Ms\\.?|Miss\\.?)\\s+', '', 'i'), updated_at=NOW() WHERE handover_person_1 ~* '^\\s*(Mr\\.?|Ms\\.?|Mrs\\.?|Miss\\.?)\\s*Missing'");
echo "Cleaned Missing titles: alloc=$n orig=$n2 first=$n3 h1=$n4\n";

$n5 = $pdo->exec("UPDATE laptops SET allocated_person = regexp_replace(allocated_person, '^\\s*(Mr\\.?|Mrs\\.?|Ms\\.?|Miss\\.?)\\s+', '', 'i'), updated_at=NOW() WHERE allocated_person ~* '^\\s*(Mr\\.?|Ms\\.?)\\s*IT\\s*$'");
echo "Cleaned IT placeholder: $n5\n";
