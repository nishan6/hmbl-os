-- Super user: every permission, for the person who runs HMBL OS without being
-- the business owner (docs/auth-and-permissions.md). Databases that already
-- have the default roles get it here, with the owner's current permissions;
-- new databases get it from ensureDefaultRoles.
INSERT INTO "roles" ("id", "key", "name", "description", "isSystem", "updatedAt")
SELECT gen_random_uuid(), 'super_user', 'Super user',
       'Every permission, for the person who runs and looks after HMBL OS. Not the business owner.',
       true, CURRENT_TIMESTAMP
 WHERE EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'owner' AND "isSystem")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permission")
SELECT s."id", op."permission"
  FROM "roles" s
  JOIN "roles" o ON o."key" = 'owner' AND o."isSystem"
  JOIN "role_permissions" op ON op."roleId" = o."id"
 WHERE s."key" = 'super_user' AND s."isSystem"
ON CONFLICT DO NOTHING;
