<?php
declare(strict_types=1);
/** La pagina tal cual, pero marcada para editar. Se muestra dentro del panel. */
require __DIR__ . '/lib.php';

$user = cms_user();
if (!$user) { http_response_code(401); exit('Tenés que iniciar sesión'); }

$page = (string) ($_GET['page'] ?? '');
if (!cms_page_ok($page)) { http_response_code(404); exit('Página desconocida'); }

/* el admin de contenidos siempre ve su vista; el principal puede elegir */
$mode = ($user['role'] === 'super' && ($_GET['mode'] ?? '') !== 'editor') ? 'super' : 'editor';

header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: SAMEORIGIN');
header('Cache-Control: no-store');
echo cms_render($page, $mode);
