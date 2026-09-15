-- Consequence email loop + barcode/OCR evidence
alter table public.hfw_products
  add column if not exists barcode text;

alter table public.hfw_scan_candidates
  add column if not exists evidence_type text not null default 'object'
    check (evidence_type in ('object','ocr','barcode','multimodal','manual'));

alter table public.hfw_scan_sessions
  add column if not exists ocr_text text,
  add column if not exists barcodes jsonb not null default '[]'::jsonb,
  add column if not exists multimodal_used boolean not null default false;

create unique index if not exists hfw_products_household_barcode_uidx
  on public.hfw_products(household_id, barcode)
  where barcode is not null and btrim(barcode) <> '';

create table if not exists public.hfw_kitchen_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  trigger_source text not null check (trigger_source in ('scan','digest','manual','purchase')),
  source_id uuid,
  coverage_days int not null default 0 check (coverage_days >= 0),
  breakfast_count int not null default 0 check (breakfast_count >= 0),
  lunch_count int not null default 0 check (lunch_count >= 0),
  dinner_count int not null default 0 check (dinner_count >= 0),
  snack_count int not null default 0 check (snack_count >= 0),
  low_stock_count int not null default 0 check (low_stock_count >= 0),
  stockout_count int not null default 0 check (stockout_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.hfw_notification_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  channel text not null default 'email' check (channel in ('email')),
  event_type text not null check (event_type in ('coverage_alert','coverage_recovered','daily_digest','test_email')),
  dedupe_key text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  coverage_days int,
  previous_coverage_days int,
  reason text,
  provider_message_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (household_id, dedupe_key)
);

alter table public.hfw_kitchen_state_snapshots enable row level security;
alter table public.hfw_notification_events enable row level security;

drop policy if exists hfw_state_snapshots_select on public.hfw_kitchen_state_snapshots;
create policy hfw_state_snapshots_select on public.hfw_kitchen_state_snapshots
for select to authenticated using (public.hfw_is_member(household_id));

drop policy if exists hfw_notification_events_select on public.hfw_notification_events;
create policy hfw_notification_events_select on public.hfw_notification_events
for select to authenticated using (public.hfw_is_member(household_id));

create or replace function public.hfw_record_purchase(
  p_product_id uuid,
  p_quantity numeric,
  p_location_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household uuid;
  v_unit text;
  v_location uuid;
  v_lot record;
  v_total numeric;
begin
  if p_quantity <= 0 then raise exception 'Purchase quantity must be positive'; end if;

  select household_id, default_unit, coalesce(p_location_id, default_location_id)
  into v_household, v_unit, v_location
  from public.hfw_products
  where id = p_product_id;

  if v_household is null or not public.hfw_is_member(v_household) then
    raise exception 'Not authorized';
  end if;

  if v_location is null then
    raise exception 'Product has no storage location';
  end if;

  select * into v_lot
  from public.hfw_inventory_lots
  where household_id = v_household
    and product_id = p_product_id
    and location_id = v_location
    and expires_at is null
  order by created_at
  limit 1;

  if found then
    update public.hfw_inventory_lots
    set quantity = quantity + p_quantity
    where id = v_lot.id;
  else
    insert into public.hfw_inventory_lots(
      household_id, product_id, location_id, quantity, unit, source, purchased_at
    )
    values(
      v_household, p_product_id, v_location, p_quantity, v_unit, 'manual', now()
    );
  end if;

  update public.hfw_products
  set default_location_id = v_location
  where id = p_product_id;

  insert into public.hfw_inventory_events(
    household_id, product_id, event_type, quantity_delta, unit, reason
  )
  values(
    v_household, p_product_id, 'purchase', p_quantity, v_unit, 'smart_restock'
  );

  select coalesce(sum(quantity),0)
  into v_total
  from public.hfw_inventory_lots
  where household_id = v_household and product_id = p_product_id;

  return v_total;
end;
$$;

grant execute on function public.hfw_record_purchase(uuid,numeric,uuid) to authenticated;

create or replace view public.hfw_inventory_state
with (security_invoker = true)
as
select
  p.household_id,
  p.id as product_id,
  p.name,
  p.category,
  p.emoji,
  p.default_unit as unit,
  p.min_stock,
  p.ideal_stock,
  p.default_location_id as location_id,
  l.name as location_name,
  l.type as location_type,
  coalesce(sum(s.quantity),0)::numeric as quantity,
  min(s.expires_at) filter (where s.quantity > 0) as next_expiry,
  p.is_perishable,
  p.barcode
from public.hfw_products p
left join public.hfw_inventory_lots s
  on s.product_id=p.id and s.household_id=p.household_id
left join public.hfw_locations l
  on l.id=p.default_location_id
where p.active=true
group by
  p.household_id,p.id,p.name,p.category,p.emoji,p.default_unit,
  p.min_stock,p.ideal_stock,p.default_location_id,
  l.name,l.type,p.is_perishable,p.barcode;

grant select on public.hfw_inventory_state to authenticated;

create index if not exists hfw_state_snapshots_household_created_idx
  on public.hfw_kitchen_state_snapshots(household_id, created_at desc);

create index if not exists hfw_notification_events_household_created_idx
  on public.hfw_notification_events(household_id, created_at desc);
