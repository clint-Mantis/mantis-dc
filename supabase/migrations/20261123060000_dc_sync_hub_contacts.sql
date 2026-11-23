-- =====================================================================
-- Keep Mantis Hub contacts (public.people) in step with DC access.
-- When a client user is given an organisation membership in DC, make
-- sure they exist as a Hub contact and that the contact is linked to
-- their login (one login for DC and the Hub client portal).
--
-- Hub rules respected:
--   * people.email is unique across Hub  -> an existing contact is reused, never duplicated
--   * people.auth_user_id is unique      -> a login is linked to at most one contact
--   * Mantis staff (public.staff) are not client contacts -> skipped
-- =====================================================================

create or replace function dc.sync_hub_contact(p_user uuid, p_org uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_name text;
  v_first text;
  v_last text;
  v_person uuid;
  v_linked uuid;
begin
  if exists (select 1 from public.staff s where s.auth_user_id = p_user) then
    return null;                                   -- Mantis staff, not a client contact
  end if;
  select u.email, coalesce(nullif(trim(p.full_name), ''), nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''))
    into v_email, v_name
    from auth.users u left join public.dc_profiles p on p.user_id = u.id
   where u.id = p_user;
  if v_email is null then return null; end if;

  -- already linked to a contact?
  select pp.id into v_linked from public.people pp where pp.auth_user_id = p_user;
  if v_linked is not null then return v_linked; end if;

  -- an existing contact with this email (anywhere in Hub) is reused and linked
  select pp.id into v_person from public.people pp
   where lower(pp.email) = lower(v_email) and pp.deleted_at is null
   order by (pp.organisation_id = p_org) desc nulls last
   limit 1;
  if v_person is not null then
    update public.people set auth_user_id = p_user where id = v_person and auth_user_id is null;
    return v_person;
  end if;

  -- otherwise create the contact under the organisation
  v_name := coalesce(v_name, split_part(v_email, '@', 1));
  v_first := split_part(v_name, ' ', 1);
  v_last := nullif(trim(substr(v_name, length(v_first) + 1)), '');
  insert into public.people (organisation_id, first_name, last_name, email, auth_user_id, client_role, status, source, contact_type)
  values (p_org, v_first, v_last, v_email, p_user, 'user', 'active', 'DC repository', 'DC user')
  returning id into v_person;
  return v_person;
end;
$$;

create or replace function dc.memberships_sync_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role in ('client_editor', 'client_viewer') then
    perform dc.sync_hub_contact(new.user_id, new.org_id);
  end if;
  return new;
end;
$$;

create trigger dc_sync_hub_contact after insert or update of role, org_id on public.dc_memberships
  for each row execute function dc.memberships_sync_contact();

-- a name entered later in DC fills an empty Hub surname/first name, never overwrites Hub data
create or replace function dc.profile_sync_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_first text; v_last text;
begin
  if coalesce(trim(new.full_name), '') = '' then return new; end if;
  v_first := split_part(trim(new.full_name), ' ', 1);
  v_last := nullif(trim(substr(trim(new.full_name), length(v_first) + 1)), '');
  update public.people pp
     set last_name = coalesce(pp.last_name, v_last)
   where pp.auth_user_id = new.user_id and pp.source = 'DC repository' and pp.last_name is null and v_last is not null;
  return new;
end;
$$;

create trigger dc_profile_sync_contact after insert or update of full_name on public.dc_profiles
  for each row execute function dc.profile_sync_contact();

revoke execute on all functions in schema dc from public, anon;
grant execute on all functions in schema dc to authenticated, service_role;
