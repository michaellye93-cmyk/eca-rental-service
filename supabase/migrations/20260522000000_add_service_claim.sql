alter table public.payments add column if not exists service_claim numeric default 0 not null;
