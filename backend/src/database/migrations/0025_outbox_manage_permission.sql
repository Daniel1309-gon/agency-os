-- E1-05: la superficie de operacion del outbox (listar, resumir y reprocesar
-- eventos FAILED/DEAD) es solo de ADMIN. El seed reconcilia ADMIN con todos los
-- permisos, pero las bases ya existentes necesitan la fila y la asignacion aqui.
INSERT INTO permissions (code, module, description)
VALUES ('outbox.manage', 'outbox', 'Inspect and requeue outbox events')
ON CONFLICT (code) DO UPDATE
SET module = excluded.module, description = excluded.description;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
CROSS JOIN permissions
WHERE roles.code = 'ADMIN'
  AND permissions.code = 'outbox.manage'
ON CONFLICT DO NOTHING;
