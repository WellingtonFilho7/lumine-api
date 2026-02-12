-- Operational sync storage for webapp cutover from Google Sheets
-- Keeps current /api/sync contract while storing all data in Supabase.

create table if not exists app_children_store (
  id text primary key,
  child_public_id text,
  enrollment_status text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_children_store_status
  on app_children_store (enrollment_status);

create index if not exists idx_app_children_store_child_public_id
  on app_children_store (child_public_id);

create table if not exists app_records_store (
  id text primary key,
  child_internal_id text not null,
  record_date date,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_records_store_child_date
  on app_records_store (child_internal_id, record_date desc);

create index if not exists idx_app_records_store_date
  on app_records_store (record_date desc);

insert into app_config (key, value)
values ('DATA_REV', '1')
on conflict (key) do nothing;
