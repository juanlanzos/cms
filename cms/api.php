<?php
declare(strict_types=1);
/**
 * API del panel. Todo entra por POST con JSON (o multipart para subir fotos)
 * y siempre con el token CSRF de la sesion.
 */
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');

function out(bool $ok, $data = null, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($ok ? ['ok' => true, 'data' => $data] : ['ok' => false, 'error' => $data],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$user = cms_user();
if (!$user) out(false, 'Tenés que iniciar sesión', 401);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') out(false, 'Solo POST', 405);

$multipart = str_starts_with((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data');
$in = $multipart ? $_POST : json_decode((string) file_get_contents('php://input'), true);
if (!is_array($in)) $in = [];
if (!hash_equals(cms_csrf(), (string) ($in['csrf'] ?? ''))) out(false, 'La sesión venció, recargá la página', 403);

$action  = (string) ($in['action'] ?? '');
$page    = (string) ($in['page'] ?? '');
$isSuper = $user['role'] === 'super';

function solo_super(bool $isSuper): void { if (!$isSuper) out(false, 'Solo el admin principal puede hacer esto', 403); }
function pagina_ok(string $page): void { if (!cms_page_ok($page)) out(false, 'Página desconocida', 404); }

switch ($action) {

    /* lo que el panel necesita para arrancar */
    case 'state':
        $types = [];
        foreach (['texto', 'enlace', 'imagen', 'bloque'] as $t) {
            $types[$t] = ['props' => cms_props_for($t), 'defaults' => cms_default_props($t)];
        }
        out(true, [
            'user'    => $user,
            'pages'   => cms_pages(),
            'catalog' => cms_catalog(),
            'types'   => $types,
            'site'    => cms_site_url(),
            'name'    => cms_config()['site_name'],
        ]);

    case 'scan':
        solo_super($isSuper);
        out(true, ['report' => cms_scan(), 'pages' => cms_pages()]);

    case 'page':
        pagina_ok($page);
        out(true, ['schema' => cms_schema($page), 'content' => cms_content($page)]);

    /* el admin principal define que se edita */
    case 'save_schema':
        solo_super($isSuper);
        pagina_ok($page);
        $limpio = [];
        foreach ((array) ($in['schema'] ?? []) as $k => $s) {
            if (!preg_match('/^\d+(\.\d+)*$/', (string) $k) || !is_array($s)) continue;
            $type = (string) ($s['type'] ?? '');
            $ok   = cms_props_for($type);
            if (!$ok) continue;
            $props = array_values(array_intersect($ok, (array) ($s['props'] ?? [])));
            if (!$props) continue;
            $limpio[(string) $k] = [
                'label' => mb_substr(trim((string) ($s['label'] ?? '')), 0, 80),
                'type'  => $type,
                'props' => $props,
                'tag'   => preg_replace('/[^a-z0-9]/', '', strtolower((string) ($s['tag'] ?? ''))),
            ];
        }
        cms_write_json(cms_data('schema') . '/' . cms_fname($page) . '.json', $limpio);
        cms_publish($page, $user['username']);
        out(true, ['schema' => $limpio]);

    /* el admin de contenidos (o el principal) guarda valores */
    case 'save_content':
        pagina_ok($page);
        $schema = cms_schema($page);
        $limpio = [];
        foreach ((array) ($in['content'] ?? []) as $k => $vals) {
            $s = $schema[(string) $k] ?? null;
            if (!$s || !is_array($vals)) continue;
            foreach ($vals as $prop => $v) {
                if (!in_array($prop, $s['props'], true)) continue;
                $c = cms_clean_value((string) $prop, $v);
                if ($c === null) out(false, 'Valor no válido en "' . (cms_catalog()[$prop]['label'] ?? $prop) . '"', 422);
                $limpio[(string) $k][$prop] = $c;
            }
        }
        cms_write_json(cms_data('content') . '/' . cms_fname($page) . '.json', $limpio);
        cms_publish($page, $user['username']);
        out(true, ['content' => $limpio]);

    case 'upload':
        $f = $_FILES['file'] ?? null;
        if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) out(false, 'No llegó la imagen', 400);
        if ($f['size'] > 8 * 1024 * 1024) out(false, 'La imagen pesa más de 8 MB', 400);
        $info = @getimagesize($f['tmp_name']);
        $ext  = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'][$info[2] ?? 0] ?? null;
        if (!$ext) out(false, 'Solo JPG, PNG, GIF o WEBP', 400);
        $base = preg_replace('/[^a-z0-9\-]+/', '-', strtolower(pathinfo((string) $f['name'], PATHINFO_FILENAME)));
        $name = trim(substr((string) $base, 0, 40), '-') . '-' . bin2hex(random_bytes(3)) . '.' . $ext;
        $dir  = __DIR__ . '/uploads';
        if (!is_dir($dir)) mkdir($dir, 0755, true);
        if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) out(false, 'No se pudo guardar', 500);
        out(true, ['url' => cms_site_url() . 'cms/uploads/' . $name]);

    case 'users':
        solo_super($isSuper);
        $l = [];
        foreach (cms_users() as $n => $u) $l[] = ['username' => $n, 'role' => $u['role']];
        out(true, $l);

    case 'add_user':
        solo_super($isSuper);
        $n = strtolower(trim((string) ($in['username'] ?? '')));
        $p = (string) ($in['password'] ?? '');
        $r = (string) ($in['role'] ?? 'editor');
        if (!preg_match('/^[a-z0-9._\-]{3,30}$/', $n)) out(false, 'Usuario: 3 a 30 letras o números', 422);
        if (strlen($p) < 8) out(false, 'La contraseña tiene que tener 8 caracteres o más', 422);
        if (!isset(CMS_ROLES[$r])) out(false, 'Rol no válido', 422);
        $u = cms_users();
        $u[$n] = ['hash' => password_hash($p, PASSWORD_DEFAULT), 'role' => $r];
        cms_save_users($u);
        out(true);

    case 'delete_user':
        solo_super($isSuper);
        $n = (string) ($in['username'] ?? '');
        if ($n === $user['username']) out(false, 'No podés borrarte a vos mismo', 422);
        $u = cms_users();
        unset($u[$n]);
        cms_save_users($u);
        out(true);
}

out(false, 'Acción desconocida', 400);
