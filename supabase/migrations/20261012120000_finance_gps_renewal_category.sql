-- Add "GPS Renewal" to the allowed Other Vehicle Costs categories.
alter table finance_private.expenses drop constraint finance_expense_category_scope;
alter table finance_private.expenses add constraint finance_expense_category_scope check(
 (payment_source='Workshop Billing' and category='Service & Maintenance') or
 (payment_source='Vehicle Direct Cost' and category in ('Road Tax','APAD / Permit','Puspakom','Tyres','Battery','Repair','Accident','Towing','Restoration','GPS Renewal','Other Vehicle Cost')) or
 (payment_source='Corporate Opex' and btrim(category)<>'')
);
