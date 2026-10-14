-- Agreement letters (2026-10-14): the Agreements page now also makes three letters to a driver (cancellation of a
-- Sewa Beli agreement, demand for unpaid rent, and a letter of demand warning of a CTOS listing). Their wording is
-- edited under Agreements -> Edit templates and kept in agreement_settings like the agreement templates, one row each.
-- The letters themselves are made in the browser and never stored. Safe to run more than once.

alter table public.agreement_settings drop constraint if exists agreement_settings_key_check;
alter table public.agreement_settings add constraint agreement_settings_key_check check (key in (
  'company', 'template:SEWA_BIASA', 'template:SEWABELI',
  'letter:BATAL_SEWABELI', 'letter:TUNTUT_SEWA', 'letter:CTOS_LOD'
));
