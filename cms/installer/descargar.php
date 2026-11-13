<?php
declare(strict_types=1);
/** Descarga "instalar.php" con el CMS de este servidor adentro (solo admin principal). */
require dirname(__DIR__) . '/lib.php';
require __DIR__ . '/build.php';

$user = cms_user();
if (!$user || $user['role'] !== 'super') { http_response_code(403); exit('Solo el admin principal puede descargar el instalador.'); }

$conf = cms_config();
$meta = cms_read_json(cms_data() . '/version.json', []) + ['sha' => '', 'date' => '', 'message' => ''];
$meta['repo']   = (string) $conf['update_repo'];
$meta['branch'] = (string) $conf['update_branch'];

$php = cms_build_installer(dirname(__DIR__), $meta);
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="instalar.php"');
header('Content-Length: ' . strlen($php));
header('Cache-Control: no-store');
echo $php;
