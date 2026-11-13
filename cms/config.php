<?php
/**
 * Configuracion del CMS.
 *
 * setup_code: la clave para crear el PRIMER admin principal.
 *   - Mientras este vacia, nadie puede crear el primer usuario (proteccion).
 *   - Poné una palabra cualquiera, entrá a /cms/, creá tu usuario y listo.
 *   - Una vez creado el primer admin, esta clave ya no se usa.
 *   (Si instalaste con instalar.php no hace falta: el usuario ya se creó.)
 *
 * Actualizaciones (botón "Actualizar" del panel):
 *   update_repo   : de qué repositorio de GitHub se baja el código.
 *   update_branch : qué rama (normalmente 'main').
 *   update_token  : solo si el repositorio es privado. Un token de GitHub de
 *                   SOLO LECTURA. Se escribe acá en el servidor, nunca por chat.
 */
return [
    'site_name'     => 'Sitio del cliente',
    'setup_code'    => '',
    'update_repo'   => 'juanlanzos/cms',
    'update_branch' => 'main',
    'update_token'  => '',
];
