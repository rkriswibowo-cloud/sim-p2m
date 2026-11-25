CREATE SQL SECURITY INVOKER VIEW effective_membership_permissions AS
 SELECT m.institution_id, m.user_id, p.permission_code, r.name AS effective_role
 FROM memberships m
 JOIN institutions i ON i.id=m.institution_id AND i.is_active
 JOIN user_role_assignments a ON a.user_id=m.user_id AND a.institution_id=m.institution_id
 JOIN roles r ON r.id=a.role_id AND r.is_active
 JOIN role_permissions p ON p.role_id=r.id
 WHERE m.is_active AND NOT EXISTS (
  SELECT 1 FROM membership_permissions x WHERE x.institution_id=m.institution_id AND x.user_id=m.user_id
 )
 UNION ALL
 SELECT m.institution_id, m.user_id, x.permission_code, 'Izin akun' AS effective_role
 FROM memberships m
 JOIN institutions i ON i.id=m.institution_id AND i.is_active
 JOIN membership_permissions x ON x.institution_id=m.institution_id AND x.user_id=m.user_id
 WHERE m.is_active AND x.permission_code<>'';
