-- Existing dedicated project: avoid retryable SQLSTATE for application conflicts.
-- CREATE OR REPLACE preserves the existing owner and execute permissions.
do $$ begin
 if to_regprocedure('public.punch_push(jsonb,bigint)') is null then
  raise exception 'Run account-schema.sql before this existing-project fix';
 end if;
end $$;
create or replace function public.punch_push(new_state jsonb, expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare uid uuid:=punch_private.require_member(); account punch_private.accounts; cleaned jsonb;
begin
 insert into punch_private.accounts(user_id) values(uid) on conflict do nothing;
 select * into account from punch_private.accounts a where a.user_id=uid for update;
 if expected_revision is null or expected_revision<>account.revision then
  -- Application version conflicts must not trigger PostgREST transaction retries.
  raise exception 'Another device changed these records' using errcode='PT409';
 end if;
 cleaned:=punch_private.validate_state(new_state,account.state);
 update punch_private.accounts set state=cleaned, revision=revision+1, updated_at=now() where user_id=uid returning * into account;
 return jsonb_build_object('state',account.state,'revision',account.revision,'userId',uid,'serverTime',now());
end $$;
