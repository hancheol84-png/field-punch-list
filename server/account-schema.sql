-- Run in the dedicated Free project. No account passwords or private site data here.
begin;
create schema if not exists punch_private;
revoke all on schema punch_private from public, anon, authenticated;

create table if not exists punch_private.members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 login_id text not null unique check (login_id ~ '^[a-z0-9._-]{3,32}$'),
 active boolean not null default true
);
create table if not exists punch_private.accounts (
 user_id uuid primary key references punch_private.members(user_id) on delete cascade,
 revision bigint not null default 0 check (revision >= 0),
 state jsonb not null default '{"rows":[]}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table punch_private.members enable row level security;
alter table punch_private.accounts enable row level security;
drop policy if exists member_owner on punch_private.members;
create policy member_owner on punch_private.members to authenticated using (user_id=(select auth.uid()));
drop policy if exists account_owner on punch_private.accounts;
create policy account_owner on punch_private.accounts to authenticated using (user_id=(select auth.uid()));
revoke all on all tables in schema punch_private from public, anon, authenticated;
grant usage on schema punch_private to service_role;
grant all on all tables in schema punch_private to service_role;

create or replace function punch_private.require_member() returns uuid
language plpgsql security definer set search_path = pg_catalog as $$
declare uid uuid := auth.uid();
begin
 if uid is null or not exists(select 1 from punch_private.members m where m.user_id=uid and m.active) then
  raise exception 'Account is not permitted' using errcode='42501';
 end if;
 return uid;
end $$;

create or replace function punch_private.trim_expired(s jsonb) returns jsonb
language sql stable set search_path = pg_catalog as $$
 select jsonb_set(s,'{rows}',coalesce((
  select jsonb_agg(r.value order by r.ordinality)
  from jsonb_array_elements(coalesce(s->'rows','[]'::jsonb)) with ordinality r
  where (r.value->>'createdAt')::timestamptz > now()-interval '7 days'
 ),'[]'::jsonb));
$$;

create or replace function punch_private.validate_state(s jsonb, previous jsonb) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare r jsonb; old_r jsonb; normalized jsonb := '[]'; seen text[] := '{}';
 key text; rid text; created timestamptz; clean jsonb;
begin
 if jsonb_typeof(s) is distinct from 'object' or octet_length(s::text)>2097152 then
  raise exception 'State format or size is invalid' using errcode='22023';
 end if;
 if jsonb_typeof(s->'rows') is distinct from 'array' or jsonb_array_length(s->'rows')>10000 then
  raise exception 'Rows are invalid' using errcode='22023';
 end if;
 for key in select jsonb_object_keys(s) loop
  if key not in ('site','inspector','cores','dongs','spots','trades','phrases','speechRules','rows') then
   raise exception 'Unknown state field' using errcode='22023';
  end if;
 end loop;
 foreach key in array array['site','inspector','cores'] loop
  if s ? key and (jsonb_typeof(s->key)<>'string' or length(s->>key)>32767) then
   raise exception 'Setting field is invalid' using errcode='22023';
  end if;
 end loop;
 foreach key in array array['dongs','spots','trades','phrases','speechRules'] loop
  if s ? key and jsonb_typeof(s->key)<>'array' then
   raise exception 'Setting list is invalid' using errcode='22023';
  end if;
 end loop;
 for r in select value from jsonb_array_elements(s->'rows') loop
  rid:=r->>'id';
  if jsonb_typeof(r)<>'object' or rid is null or rid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or rid=any(seen) then
   raise exception 'Record ID is invalid or duplicated' using errcode='22023';
  end if;
  seen:=array_append(seen,rid);
  foreach key in array array['dong','unit','text'] loop
   if jsonb_typeof(r->key) is distinct from 'string' or length(r->>key)>32767 then
    raise exception 'Record field is invalid' using errcode='22023';
   end if;
  end loop;
  if length(btrim(r->>'text'))=0 or r->>'unit' !~ '^[0-9]+$' then
   raise exception 'Record content is invalid' using errcode='22023';
  end if;
  foreach key in array array['core','spot','trade','downloadRequestedAt','inputText','inputKind','tradeMode','tradeReason'] loop
   if r ? key and (jsonb_typeof(r->key)<>'string' or length(r->>key)>32767) then
    raise exception 'Record metadata is invalid' using errcode='22023';
   end if;
  end loop;
  select value into old_r from jsonb_array_elements(previous->'rows') where value->>'id'=rid;
  if old_r is not null then created:=(old_r->>'createdAt')::timestamptz;
  else
   begin created:=least((r->>'createdAt')::timestamptz,now());
   exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Input timestamp is invalid' using errcode='22023';
   end;
   if r->>'createdAt' is null then created:=now(); end if;
  end if;
  -- Keep supported fields only; caller-supplied owner identifiers are never used.
  clean:=r - 'user_id' - 'owner' - 'owner_id';
  clean:=jsonb_set(clean,'{createdAt}',to_jsonb(to_char(created at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  if created>now()-interval '7 days' then normalized:=normalized || jsonb_build_array(clean); end if;
 end loop;
 return jsonb_set(s,'{rows}',normalized);
end $$;

create or replace function public.punch_pull() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare uid uuid:=punch_private.require_member(); account punch_private.accounts; cleaned jsonb;
begin
 insert into punch_private.accounts(user_id) values(uid) on conflict do nothing;
 select * into account from punch_private.accounts a where a.user_id=uid for update;
 cleaned:=punch_private.trim_expired(account.state);
 if cleaned is distinct from account.state then
  update punch_private.accounts set state=cleaned, revision=revision+1, updated_at=now() where user_id=uid returning * into account;
 end if;
 return jsonb_build_object('state',account.state,'revision',account.revision,'userId',uid,'serverTime',now());
end $$;

create or replace function public.punch_push(new_state jsonb, expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare uid uuid:=punch_private.require_member(); account punch_private.accounts; cleaned jsonb;
begin
 insert into punch_private.accounts(user_id) values(uid) on conflict do nothing;
 select * into account from punch_private.accounts a where a.user_id=uid for update;
 if expected_revision is null or expected_revision<>account.revision then
  raise exception 'Another device changed these records' using errcode='40001';
 end if;
 cleaned:=punch_private.validate_state(new_state,account.state);
 update punch_private.accounts set state=cleaned, revision=revision+1, updated_at=now() where user_id=uid returning * into account;
 return jsonb_build_object('state',account.state,'revision',account.revision,'userId',uid,'serverTime',now());
end $$;

revoke all on all functions in schema punch_private from public, anon, authenticated;
revoke all on function public.punch_pull() from public, anon;
revoke all on function public.punch_push(jsonb,bigint) from public, anon;
grant execute on function public.punch_pull() to authenticated;
grant execute on function public.punch_push(jsonb,bigint) to authenticated;
commit;
