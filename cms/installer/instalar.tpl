<?php
/**
 * INSTALADOR DEL CMS (un solo archivo).
 *
 * Cómo se usa:
 *  1. Subí este archivo (instalar.php) a la carpeta donde está el index.html
 *     del sitio del cliente (con FTP o el administrador de archivos del hosting).
 *  2. Abrí https://sitio-del-cliente.com/instalar.php en el navegador.
 *  3. Completá el nombre del sitio, tu usuario y tu contraseña.
 *  4. Listo: se crea la carpeta cms/, tu usuario, se escanean las páginas
 *     y este archivo se borra solo.
 *
 * No necesita internet ni base de datos: el CMS viene adentro de este archivo.
 */
declare(strict_types=1);
error_reporting(E_ALL);
ini_set('display_errors', '0');

const PAYLOAD = '/*__PAYLOAD__*/';

$dir = __DIR__;
$cms = $dir . '/cms';
$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');

function cargar_paquete(): array
{
    if (!function_exists('gzinflate')) throw new RuntimeException('El hosting no tiene la extensión zlib de PHP.');
    $p = json_decode((string) gzinflate((string) base64_decode(PAYLOAD)), true);
    if (!is_array($p) || empty($p['files'])) throw new RuntimeException('El instalador está dañado. Bajalo de nuevo.');
    return $p;
}

$problemas = [];
if (PHP_VERSION_ID < 80000) $problemas[] = 'El hosting tiene PHP ' . PHP_VERSION . '. Hace falta PHP 8 o más nuevo (se cambia en el panel del hosting).';
if (!is_writable($dir)) $problemas[] = 'PHP no puede escribir en esta carpeta. Revisá los permisos (la carpeta tiene que ser del usuario del sitio).';
$yaInstalado = is_file($cms . '/data/users.json');

$error = '';
$hecho = null;

if (!$problemas && !$yaInstalado && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $site = trim((string) ($_POST['site'] ?? ''));
    $n = strtolower(trim((string) ($_POST['username'] ?? '')));
    $p = (string) ($_POST['password'] ?? '');
    $p2 = (string) ($_POST['password2'] ?? '');
    if ($site === '') $error = 'Poné el nombre del sitio.';
    elseif (!preg_match('/^[a-z0-9._\-]{3,30}$/', $n)) $error = 'Usuario: de 3 a 30 letras o números (sin espacios).';
    elseif (strlen($p) < 8) $error = 'La contraseña tiene que tener 8 caracteres o más.';
    elseif ($p !== $p2) $error = 'Las dos contraseñas no son iguales.';
    else {
        try {
            $pkg = cargar_paquete();
            /* 1) copiar los archivos del CMS (si ya habia una carpeta cms/ sin usuarios, se pisa el codigo) */
            foreach ($pkg['files'] as $rel => $b64) {
                if (str_contains($rel, '..')) continue;
                $dst = $cms . '/' . $rel;
                if (!is_dir(dirname($dst)) && !mkdir(dirname($dst), 0755, true)) throw new RuntimeException('No se pudo crear la carpeta ' . dirname($rel));
                if (file_put_contents($dst, base64_decode($b64)) === false) throw new RuntimeException('No se pudo escribir cms/' . $rel);
            }
            /* 2) configuracion */
            $conf = "<?php\n/** Configuracion del CMS (creada por el instalador). Ver comentarios en el repositorio. */\nreturn [\n"
                . "    'site_name'     => " . var_export($site, true) . ",\n"
                . "    'setup_code'    => '',\n"
                . "    'update_repo'   => " . var_export((string) ($pkg['meta']['repo'] ?? 'juanlanzos/cms'), true) . ",\n"
                . "    'update_branch' => " . var_export((string) ($pkg['meta']['branch'] ?? 'main'), true) . ",\n"
                . "    'update_token'  => '',\n];\n";
            if (!is_file($cms . '/config.php') || !str_contains((string) file_get_contents($cms . '/config.php'), 'update_repo')) {
                file_put_contents($cms . '/config.php', $conf);
            }
            /* 3) usuario, version y primer escaneo, usando el propio CMS */
            require $cms . '/lib.php';
            cms_save_users([$n => ['hash' => password_hash($p, PASSWORD_DEFAULT), 'role' => 'super']]);
            cms_write_json(cms_data() . '/version.json', [
                'sha' => (string) ($pkg['meta']['sha'] ?? ''), 'date' => (string) ($pkg['meta']['date'] ?? ''),
                'message' => (string) ($pkg['meta']['message'] ?? ''),
            ]);
            $_SERVER['SCRIPT_NAME'] = rtrim(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/instalar.php')), '/') . '/cms/index.php';
            $scan = cms_scan();
            cms_login($n, $p);
            /* 4) ¿la carpeta de datos esta protegida? (en Nginx no alcanza con .htaccess) */
            $base = (((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost'))
                . rtrim(dirname((string) ($_SERVER['REQUEST_URI'] ?? '/')), '/') . '/';
            $expuesto = null;
            $ctx = stream_context_create(['http' => ['timeout' => 5, 'ignore_errors' => true], 'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
            $r = @file_get_contents($base . 'cms/data/users.json', false, $ctx);
            if ($r !== false) $expuesto = str_contains($r, '"hash"');
            /* 5) borrarse */
            $borrado = @unlink(__FILE__);
            $hecho = ['scan' => $scan, 'borrado' => $borrado, 'expuesto' => $expuesto, 'panel' => $base . 'cms/'];
        } catch (Throwable $ex) {
            $error = 'No se pudo instalar: ' . $ex->getMessage();
        }
    }
}
?><!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Instalar CMS</title>
<style>
  body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f4f6;color:#111827}
  .box{max-width:460px;margin:48px auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  h1{font-size:22px;margin:0 0 6px} p{margin:8px 0} .muted{color:#6b7280;font-size:14px}
  label{display:block;font-size:14px;font-weight:600;margin:14px 0 4px}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font:inherit}
  button,.btn{display:inline-block;margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:#111827;color:#fff;font:inherit;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;box-sizing:border-box}
  .err{background:#fef2f2;color:#991b1b;padding:10px 12px;border-radius:8px;font-size:14px}
  .ok{background:#ecfdf5;color:#065f46;padding:10px 12px;border-radius:8px}
  .warn{background:#fffbeb;color:#92400e;padding:10px 12px;border-radius:8px;font-size:14px}
  code,pre{background:#f3f4f6;border-radius:6px;padding:2px 5px;font-size:13px} pre{padding:10px;white-space:pre-wrap}
</style>
</head>
<body>
<div class="box">
<?php if ($hecho): ?>
  <h1>¡Listo! 🎉</h1>
  <p class="ok">El CMS quedó instalado. Se encontraron <b><?= count($hecho['scan']['nuevas'] ?? []) ?></b> páginas.</p>
  <?php if (!$hecho['borrado']): ?>
    <p class="warn">No pude borrar este instalador. Borrá <code>instalar.php</code> a mano desde el FTP o el administrador de archivos.</p>
  <?php endif; ?>
  <?php if ($hecho['expuesto'] === true): ?>
    <p class="warn"><b>Importante:</b> este servidor usa Nginx y la carpeta de datos se puede ver desde internet. Pedile a quien administra el servidor que agregue esto a la configuración del sitio:</p>
    <pre>location ^~ /cms/data/ { deny all; }
location ~* ^/cms/uploads/.*\.php$ { deny all; }</pre>
  <?php endif; ?>
  <a class="btn" href="<?= $e($hecho['panel']) ?>">Entrar al panel →</a>
<?php elseif ($yaInstalado): ?>
  <h1>Ya está instalado</h1>
  <p>Este sitio ya tiene el CMS. Para actualizarlo usá el botón <b>⟳ Actualizar</b> del panel.</p>
  <p class="warn">Borrá <code>instalar.php</code> del servidor: ya no hace falta.</p>
  <a class="btn" href="cms/">Ir al panel →</a>
<?php elseif ($problemas): ?>
  <h1>Falta algo en el hosting</h1>
  <?php foreach ($problemas as $pr): ?><p class="err"><?= $e($pr) ?></p><?php endforeach; ?>
<?php else: ?>
  <h1>Instalar el CMS</h1>
  <p class="muted">Se va a crear la carpeta <code>cms/</code> al lado de tus páginas. Tus archivos .html no se tocan hasta que publiques algo desde el panel.</p>
  <?php if ($error): ?><p class="err"><?= $e($error) ?></p><?php endif; ?>
  <form method="post" autocomplete="off">
    <label>Nombre del sitio</label>
    <input name="site" required value="<?= $e($_POST['site'] ?? '') ?>" placeholder="Ej: Café La Esquina">
    <label>Tu usuario (admin principal)</label>
    <input name="username" required value="<?= $e($_POST['username'] ?? '') ?>" autocomplete="username">
    <label>Tu contraseña (8 o más)</label>
    <input type="password" name="password" required minlength="8" autocomplete="new-password">
    <label>Repetí la contraseña</label>
    <input type="password" name="password2" required minlength="8" autocomplete="new-password">
    <button type="submit">Instalar</button>
  </form>
<?php endif; ?>
</div>
</body>
</html>
