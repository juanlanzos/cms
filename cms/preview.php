<?php
declare(strict_types=1);
/**
 * La pagina tal cual, pero marcada para editar. Se muestra dentro del panel.
 * Por POST recibe cambios todavia sin guardar, para verlos antes de publicar.
 */
require __DIR__ . '/lib.php';

$user = cms_user();
if (!$user) { http_response_code(401); exit('Tenés que iniciar sesión'); }

$page = (string) ($_REQUEST['page'] ?? '');
if (!cms_page_ok($page)) { http_response_code(404); exit('Página desconocida'); }

/* el admin de contenidos siempre ve su vista; el principal puede elegir */
$mode = ($user['role'] === 'super' && ($_REQUEST['mode'] ?? '') !== 'editor') ? 'super' : 'editor';

$content = null;
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!hash_equals(cms_csrf(), (string) ($_POST['csrf'] ?? ''))) { http_response_code(403); exit('La sesión venció, recargá la página'); }
    $raw = json_decode((string) ($_POST['content'] ?? ''), true);
    if (is_array($raw)) {
        [$c, $err] = cms_clean_content($raw, cms_schema($page));
        if ($err === '') $content = $c; /* si algo no es valido, se muestra lo guardado */
    }
}

header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: SAMEORIGIN');
header('Cache-Control: no-store');
echo cms_render($page, $mode, $content);
