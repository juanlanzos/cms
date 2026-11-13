<?php
/**
 * Configuracion del CMS.
 *
 * setup_code: la clave para crear el PRIMER admin principal.
 *   - Mientras este vacia, nadie puede crear el primer usuario (proteccion).
 *   - Poné una palabra cualquiera, entrá a /cms/, creá tu usuario y listo.
 *   - Una vez creado el primer admin, esta clave ya no se usa.
 */
return [
    'site_name'  => 'Sitio del cliente',
    'setup_code' => '',
];
