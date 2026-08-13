-- KVNX Vault Sprint 18: confidentiality-safe Achievement Center catalog read.
-- Apply after 202608070016_sprint15_mission_catalog.sql.
-- Installed migrations 001-016 remain immutable. There is intentionally no 010.

-- Migration 011 returned the complete catalog and relied on presentation code
-- to mask locked hidden milestones. Sprint 18 moves that confidentiality rule
-- to the authenticated read boundary so hidden identities never reach browser
-- serialization before their authoritative user_achievements row exists.
create or replace function public.get_achievement_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', case when catalog.hidden and earned.achievement_key is null then null else catalog.key end,
      'name', case when catalog.hidden and earned.achievement_key is null then '?????' else catalog.name end,
      'description', case when catalog.hidden and earned.achievement_key is null then '?????' else catalog.description end,
      'icon', case when catalog.hidden and earned.achievement_key is null then '?' else catalog.icon end,
      'category', case when catalog.hidden and earned.achievement_key is null then null else catalog.category end,
      'hidden', catalog.hidden,
      'displayOrder', catalog.display_order
    ) order by catalog.display_order)
    from public.achievement_catalog as catalog
    left join public.user_achievements as earned
      on earned.user_id = v_user_id
     and earned.achievement_key = catalog.key
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_achievement_catalog() from public;
revoke all on function public.get_achievement_catalog() from anon;
grant execute on function public.get_achievement_catalog() to authenticated;

comment on function public.get_achievement_catalog()
is 'Sprint 18 zero-argument authenticated achievement catalog. Locked hidden identities are redacted until a persisted owner unlock exists.';
