-- Run after account-schema.sql in the same dedicated Free project.
create extension if not exists pg_cron;
select cron.schedule('punch-delete-expired','*/15 * * * *',$job$
 update punch_private.accounts
 set state=punch_private.trim_expired(state), revision=revision+1, updated_at=now()
 where state is distinct from punch_private.trim_expired(state);
$job$);
