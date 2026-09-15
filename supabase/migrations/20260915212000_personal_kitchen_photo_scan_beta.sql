-- Personal Kitchen + Photo Scan Beta
-- Applied non-destructively to the active Supabase project on 2026-09-15.

alter table public.hfw_products
  add column if not exists is_perishable boolean not null default true;

create table if not exists public.hfw_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  location_id uuid not null references public.hfw_locations(id) on delete cascade,
  status text not null default 'uploaded'
    check (status in ('uploaded','processed','reviewed','applied','failed')),
  fill_percent int check (fill_percent between 0 and 100),
  model_name text,
  inference_mode text not null default 'browser'
    check (inference_mode in ('browser','server','manual')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  applied_at timestamptz
);

create table if not exists public.hfw_scan_images (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  scan_session_id uuid not null references public.hfw_scan_sessions(id) on delete cascade,
  storage_path text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create table if not exists public.hfw_scan_candidates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  scan_session_id uuid not null references public.hfw_scan_sessions(id) on delete cascade,
  raw_label text not null,
  product_id uuid references public.hfw_products(id) on delete set null,
  suggested_quantity numeric not null default 1 check (suggested_quantity >= 0),
  confirmed_quantity numeric check (confirmed_quantity >= 0),
  unit text not null default 'unidad',
  confidence numeric not null default 0 check (confidence between 0 and 1),
  bbox jsonb,
  status text not null default 'proposed'
    check (status in ('proposed','confirmed','edited','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfw_product_aliases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  product_id uuid not null references public.hfw_products(id) on delete cascade,
  alias text not null,
  source text not null default 'user'
    check (source in ('user','seed','vision','self')),
  created_at timestamptz not null default now(),
  unique (household_id, alias)
);

create table if not exists public.hfw_location_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  location_id uuid not null references public.hfw_locations(id) on delete cascade,
  scan_session_id uuid references public.hfw_scan_sessions(id) on delete set null,
  fill_percent int not null default 0 check (fill_percent between 0 and 100),
  detected_item_count int not null default 0,
  confirmed_item_count int not null default 0,
  created_at timestamptz not null default now()
);

drop trigger if exists hfw_scan_candidates_touch on public.hfw_scan_candidates;
create trigger hfw_scan_candidates_touch
before update on public.hfw_scan_candidates
for each row execute function public.hfw_touch_updated_at();

alter table public.hfw_scan_sessions enable row level security;
alter table public.hfw_scan_images enable row level security;
alter table public.hfw_scan_candidates enable row level security;
alter table public.hfw_product_aliases enable row level security;
alter table public.hfw_location_snapshots enable row level security;

drop policy if exists hfw_scan_sessions_all on public.hfw_scan_sessions;
create policy hfw_scan_sessions_all on public.hfw_scan_sessions
for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id) and created_by = auth.uid());

drop policy if exists hfw_scan_images_all on public.hfw_scan_images;
create policy hfw_scan_images_all on public.hfw_scan_images
for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_scan_candidates_all on public.hfw_scan_candidates;
create policy hfw_scan_candidates_all on public.hfw_scan_candidates
for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_product_aliases_all on public.hfw_product_aliases;
create policy hfw_product_aliases_all on public.hfw_product_aliases
for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_location_snapshots_all on public.hfw_location_snapshots;
create policy hfw_location_snapshots_all on public.hfw_location_snapshots
for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hfw-kitchen-scans','hfw-kitchen-scans',false,8388608,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists hfw_scan_storage_select on storage.objects;
create policy hfw_scan_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'hfw-kitchen-scans'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists hfw_scan_storage_insert on storage.objects;
create policy hfw_scan_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'hfw-kitchen-scans'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists hfw_scan_storage_update on storage.objects;
create policy hfw_scan_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'hfw-kitchen-scans'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'hfw-kitchen-scans'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists hfw_scan_storage_delete on storage.objects;
create policy hfw_scan_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'hfw-kitchen-scans'
  and (storage.foldername(name))[1] = auth.uid()::text
);

insert into public.hfw_product_aliases(household_id, product_id, alias, source)
select household_id, id, lower(trim(name)), 'self'
from public.hfw_products
on conflict (household_id, alias) do nothing;

insert into public.hfw_product_aliases(household_id, product_id, alias, source)
select p.household_id, p.id, x.alias, 'seed'
from public.hfw_products p
join (
  values ('Plátano','banana'),('Manzana','apple'),('Verduras mixtas','broccoli')
) x(product_name, alias) on p.name = x.product_name
on conflict (household_id, alias) do nothing;

create or replace function public.hfw_seed_product_self_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.hfw_product_aliases(household_id, product_id, alias, source)
  values(new.household_id, new.id, lower(trim(new.name)), 'self')
  on conflict (household_id, alias) do nothing;
  return new;
end;
$$;

drop trigger if exists hfw_products_seed_alias on public.hfw_products;
create trigger hfw_products_seed_alias
after insert on public.hfw_products
for each row execute function public.hfw_seed_product_self_alias();

create or replace function public.hfw_set_location_stock(
  p_product_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_reason text default 'location_set'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household uuid;
  v_location_household uuid;
  v_unit text;
  v_current numeric := 0;
  v_delta numeric := 0;
  v_remaining numeric := 0;
  v_take numeric := 0;
  v_lot record;
begin
  if p_quantity < 0 then raise exception 'Quantity cannot be negative'; end if;

  select household_id, default_unit
  into v_household, v_unit
  from public.hfw_products
  where id = p_product_id;

  select household_id
  into v_location_household
  from public.hfw_locations
  where id = p_location_id;

  if v_household is null
     or v_location_household is null
     or v_household <> v_location_household
     or not public.hfw_is_member(v_household) then
    raise exception 'Not authorized';
  end if;

  select coalesce(sum(quantity),0)
  into v_current
  from public.hfw_inventory_lots
  where household_id = v_household
    and product_id = p_product_id
    and location_id = p_location_id;

  v_delta := p_quantity - v_current;

  if v_delta > 0 then
    select * into v_lot
    from public.hfw_inventory_lots
    where household_id = v_household
      and product_id = p_product_id
      and location_id = p_location_id
      and expires_at is null
    order by created_at
    limit 1;

    if found then
      update public.hfw_inventory_lots
      set quantity = quantity + v_delta
      where id = v_lot.id;
    else
      insert into public.hfw_inventory_lots(
        household_id, product_id, location_id, quantity, unit, source
      )
      values(
        v_household, p_product_id, p_location_id, v_delta, v_unit,
        case when p_reason like 'photo_scan:%' then 'photo' else 'manual' end
      );
    end if;
  elsif v_delta < 0 then
    v_remaining := abs(v_delta);
    for v_lot in
      select *
      from public.hfw_inventory_lots
      where household_id = v_household
        and product_id = p_product_id
        and location_id = p_location_id
        and quantity > 0
      order by expires_at nulls last, created_at
    loop
      exit when v_remaining <= 0;
      v_take := least(v_lot.quantity, v_remaining);
      update public.hfw_inventory_lots
      set quantity = quantity - v_take
      where id = v_lot.id;
      v_remaining := v_remaining - v_take;
    end loop;
  end if;

  update public.hfw_products
  set default_location_id = p_location_id
  where id = p_product_id;

  if v_delta <> 0 then
    insert into public.hfw_inventory_events(
      household_id, product_id, event_type, quantity_delta, unit, reason
    )
    values(v_household, p_product_id, 'adjust', v_delta, v_unit, p_reason);
  end if;

  return p_quantity;
end;
$$;

create or replace function public.hfw_apply_scan(
  p_scan_id uuid,
  p_fill_percent int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan public.hfw_scan_sessions%rowtype;
  v_candidate record;
  v_detected int := 0;
  v_confirmed int := 0;
  v_quantity numeric := 0;
begin
  select * into v_scan
  from public.hfw_scan_sessions
  where id = p_scan_id;

  if v_scan.id is null or not public.hfw_is_member(v_scan.household_id) then
    raise exception 'Not authorized';
  end if;

  if v_scan.status = 'applied' then
    return jsonb_build_object('scan_id',p_scan_id,'status','already_applied');
  end if;

  select count(*) into v_detected
  from public.hfw_scan_candidates
  where scan_session_id = p_scan_id;

  for v_candidate in
    select *
    from public.hfw_scan_candidates
    where scan_session_id = p_scan_id
      and status in ('confirmed','edited')
      and product_id is not null
  loop
    v_quantity := coalesce(v_candidate.confirmed_quantity, v_candidate.suggested_quantity, 0);
    perform public.hfw_set_location_stock(
      v_candidate.product_id,
      v_scan.location_id,
      v_quantity,
      'photo_scan:' || p_scan_id::text
    );
    v_confirmed := v_confirmed + 1;
  end loop;

  update public.hfw_scan_sessions
  set status = 'applied',
      fill_percent = coalesce(p_fill_percent, fill_percent),
      reviewed_at = coalesce(reviewed_at, now()),
      applied_at = now()
  where id = p_scan_id;

  insert into public.hfw_location_snapshots(
    household_id, location_id, scan_session_id,
    fill_percent, detected_item_count, confirmed_item_count
  )
  values(
    v_scan.household_id, v_scan.location_id, p_scan_id,
    coalesce(p_fill_percent, v_scan.fill_percent, 0), v_detected, v_confirmed
  );

  return jsonb_build_object(
    'scan_id',p_scan_id,'status','applied',
    'detected',v_detected,'confirmed',v_confirmed
  );
end;
$$;

grant execute on function public.hfw_set_location_stock(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.hfw_apply_scan(uuid,int) to authenticated;

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
  p.is_perishable
from public.hfw_products p
left join public.hfw_inventory_lots s
  on s.product_id=p.id and s.household_id=p.household_id
left join public.hfw_locations l
  on l.id=p.default_location_id
where p.active=true
group by
  p.household_id,p.id,p.name,p.category,p.emoji,p.default_unit,
  p.min_stock,p.ideal_stock,p.default_location_id,
  l.name,l.type,p.is_perishable;

grant select on public.hfw_inventory_state to authenticated;

create index if not exists hfw_scan_sessions_household_created_idx
  on public.hfw_scan_sessions(household_id, created_at desc);
create index if not exists hfw_scan_sessions_location_created_idx
  on public.hfw_scan_sessions(location_id, created_at desc);
create index if not exists hfw_scan_candidates_scan_idx
  on public.hfw_scan_candidates(scan_session_id);
create index if not exists hfw_product_aliases_household_alias_idx
  on public.hfw_product_aliases(household_id, alias);
create index if not exists hfw_location_snapshots_location_created_idx
  on public.hfw_location_snapshots(location_id, created_at desc);
