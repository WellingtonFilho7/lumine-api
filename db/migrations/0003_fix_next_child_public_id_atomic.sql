create or replace function next_child_public_id()
returns text
language plpgsql
as $$
declare
  allocated_val integer;
begin
  insert into app_config (key, value, updated_at)
  values ('NEXT_CHILD_ID', '2', now())
  on conflict (key) do update
    set value = (app_config.value::integer + 1)::text,
        updated_at = now()
  returning (app_config.value::integer - 1) into allocated_val;

  return 'CRI-' || lpad(allocated_val::text, 4, '0');
end;
$$;
