-- Kitchen Readiness v0
-- Applied to Supabase migration history as kitchen_readiness_v0 on 2026-09-15.
-- All product tables are prefixed hfw_ so this product can coexist inside a shared project.

create extension if not exists pgcrypto;

create table if not exists public.hfw_households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mi cocina',
  timezone text not null default 'America/Lima',
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.hfw_household_members (
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.hfw_locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  name text not null,
  type text not null check (type in ('fridge','freezer','pantry','organizer','other')),
  parent_location_id uuid references public.hfw_locations(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.hfw_products (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  name text not null,
  category text not null default 'Otros',
  emoji text not null default '🥣',
  default_unit text not null default 'unidad',
  min_stock numeric not null default 0 check (min_stock >= 0),
  ideal_stock numeric not null default 0 check (ideal_stock >= 0),
  default_location_id uuid references public.hfw_locations(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.hfw_inventory_lots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  product_id uuid not null references public.hfw_products(id) on delete cascade,
  location_id uuid references public.hfw_locations(id) on delete set null,
  quantity numeric not null default 0 check (quantity >= 0),
  unit text not null,
  purchased_at timestamptz,
  opened_at timestamptz,
  expires_at date,
  source text not null default 'manual' check (source in ('manual','barcode','receipt','photo','voice','import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfw_meal_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  name text not null,
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  emoji text not null default '🍽️',
  prep_minutes int not null default 10 check (prep_minutes >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.hfw_meal_ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  meal_id uuid not null references public.hfw_meal_templates(id) on delete cascade,
  product_id uuid not null references public.hfw_products(id) on delete cascade,
  quantity_per_serving numeric not null check (quantity_per_serving > 0),
  unit text not null,
  optional boolean not null default false,
  created_at timestamptz not null default now(),
  unique (meal_id, product_id)
);

create table if not exists public.hfw_inventory_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  product_id uuid not null references public.hfw_products(id) on delete cascade,
  event_type text not null check (event_type in ('purchase','consume','waste','adjust','move','open')),
  quantity_delta numeric not null,
  unit text not null,
  reason text,
  occurred_at timestamptz not null default now()
);

create table if not exists public.hfw_meal_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hfw_households(id) on delete cascade,
  meal_id uuid not null references public.hfw_meal_templates(id) on delete cascade,
  servings int not null default 1 check (servings > 0),
  occurred_at timestamptz not null default now()
);

create table if not exists public.hfw_notification_preferences (
  household_id uuid primary key references public.hfw_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  digest_enabled boolean not null default true,
  coverage_threshold numeric not null default 3,
  digest_hour int not null default 8 check (digest_hour between 0 and 23),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.hfw_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hfw_products_touch on public.hfw_products;
create trigger hfw_products_touch before update on public.hfw_products
for each row execute function public.hfw_touch_updated_at();

drop trigger if exists hfw_inventory_lots_touch on public.hfw_inventory_lots;
create trigger hfw_inventory_lots_touch before update on public.hfw_inventory_lots
for each row execute function public.hfw_touch_updated_at();

drop trigger if exists hfw_notification_touch on public.hfw_notification_preferences;
create trigger hfw_notification_touch before update on public.hfw_notification_preferences
for each row execute function public.hfw_touch_updated_at();

create or replace function public.hfw_is_member(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hfw_household_members m
    where m.household_id = p_household and m.user_id = auth.uid()
  );
$$;

alter table public.hfw_households enable row level security;
alter table public.hfw_household_members enable row level security;
alter table public.hfw_locations enable row level security;
alter table public.hfw_products enable row level security;
alter table public.hfw_inventory_lots enable row level security;
alter table public.hfw_meal_templates enable row level security;
alter table public.hfw_meal_ingredients enable row level security;
alter table public.hfw_inventory_events enable row level security;
alter table public.hfw_meal_events enable row level security;
alter table public.hfw_notification_preferences enable row level security;

drop policy if exists hfw_households_select on public.hfw_households;
create policy hfw_households_select on public.hfw_households for select to authenticated
using (public.hfw_is_member(id));

drop policy if exists hfw_members_select on public.hfw_household_members;
create policy hfw_members_select on public.hfw_household_members for select to authenticated
using (public.hfw_is_member(household_id));

drop policy if exists hfw_locations_all on public.hfw_locations;
create policy hfw_locations_all on public.hfw_locations for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_products_all on public.hfw_products;
create policy hfw_products_all on public.hfw_products for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_lots_all on public.hfw_inventory_lots;
create policy hfw_lots_all on public.hfw_inventory_lots for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_meals_all on public.hfw_meal_templates;
create policy hfw_meals_all on public.hfw_meal_templates for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_meal_ingredients_all on public.hfw_meal_ingredients;
create policy hfw_meal_ingredients_all on public.hfw_meal_ingredients for all to authenticated
using (public.hfw_is_member(household_id))
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_inventory_events_select on public.hfw_inventory_events;
create policy hfw_inventory_events_select on public.hfw_inventory_events for select to authenticated
using (public.hfw_is_member(household_id));
drop policy if exists hfw_inventory_events_insert on public.hfw_inventory_events;
create policy hfw_inventory_events_insert on public.hfw_inventory_events for insert to authenticated
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_meal_events_select on public.hfw_meal_events;
create policy hfw_meal_events_select on public.hfw_meal_events for select to authenticated
using (public.hfw_is_member(household_id));
drop policy if exists hfw_meal_events_insert on public.hfw_meal_events;
create policy hfw_meal_events_insert on public.hfw_meal_events for insert to authenticated
with check (public.hfw_is_member(household_id));

drop policy if exists hfw_notification_all on public.hfw_notification_preferences;
create policy hfw_notification_all on public.hfw_notification_preferences for all to authenticated
using (public.hfw_is_member(household_id) and user_id = auth.uid())
with check (public.hfw_is_member(household_id) and user_id = auth.uid());

create or replace function public.hfw_bootstrap()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_email text;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select household_id into v_household
  from public.hfw_household_members
  where user_id = v_user
  order by created_at
  limit 1;

  if v_household is null then
    insert into public.hfw_households(name, owner_user_id)
    values ('Mi cocina', v_user)
    returning id into v_household;

    insert into public.hfw_household_members(household_id, user_id, role)
    values (v_household, v_user, 'owner');
  end if;

  insert into public.hfw_locations(household_id, name, type, sort_order) values
    (v_household, 'Refrigeradora', 'fridge', 1),
    (v_household, 'Freezer', 'freezer', 2),
    (v_household, 'Despensa', 'pantry', 3),
    (v_household, 'Organizadores', 'organizer', 4)
  on conflict (household_id, name) do nothing;

  insert into public.hfw_products(household_id,name,category,emoji,default_unit,min_stock,ideal_stock,default_location_id)
  values
    (v_household,'Huevos','Proteína','🥚','unidad',6,12,(select id from public.hfw_locations where household_id=v_household and name='Refrigeradora')),
    (v_household,'Avena','Cereales','🌾','g',250,750,(select id from public.hfw_locations where household_id=v_household and name='Despensa')),
    (v_household,'Leche','Lácteos','🥛','ml',500,2000,(select id from public.hfw_locations where household_id=v_household and name='Refrigeradora')),
    (v_household,'Plátano','Frutas','🍌','unidad',3,8,(select id from public.hfw_locations where household_id=v_household and name='Organizadores')),
    (v_household,'Manzana','Frutas','🍎','unidad',3,8,(select id from public.hfw_locations where household_id=v_household and name='Organizadores')),
    (v_household,'Yogur griego','Lácteos','🥣','unidad',3,8,(select id from public.hfw_locations where household_id=v_household and name='Refrigeradora')),
    (v_household,'Pollo','Proteína','🍗','g',400,1400,(select id from public.hfw_locations where household_id=v_household and name='Freezer')),
    (v_household,'Arroz','Cereales','🍚','g',400,1500,(select id from public.hfw_locations where household_id=v_household and name='Despensa')),
    (v_household,'Verduras mixtas','Verduras','🥦','g',400,1200,(select id from public.hfw_locations where household_id=v_household and name='Freezer')),
    (v_household,'Tomate','Verduras','🍅','unidad',3,8,(select id from public.hfw_locations where household_id=v_household and name='Refrigeradora')),
    (v_household,'Palta','Grasas saludables','🥑','unidad',2,5,(select id from public.hfw_locations where household_id=v_household and name='Organizadores')),
    (v_household,'Pan integral','Cereales','🍞','rebanada',6,20,(select id from public.hfw_locations where household_id=v_household and name='Despensa')),
    (v_household,'Atún','Proteína','🐟','lata',2,6,(select id from public.hfw_locations where household_id=v_household and name='Despensa')),
    (v_household,'Frutos secos','Grasas saludables','🥜','g',120,400,(select id from public.hfw_locations where household_id=v_household and name='Despensa'))
  on conflict (household_id, name) do nothing;

  insert into public.hfw_meal_templates(household_id,name,meal_type,emoji,prep_minutes) values
    (v_household,'Avena power','breakfast','🥣',7),
    (v_household,'Huevos con palta','breakfast','🍳',10),
    (v_household,'Pollo, arroz y verduras','lunch','🍲',22),
    (v_household,'Atún, arroz y tomate','lunch','🥗',12),
    (v_household,'Omelette de verduras','dinner','🍳',12),
    (v_household,'Pollo con palta y tomate','dinner','🥙',15),
    (v_household,'Yogur con plátano','snack','🍌',3),
    (v_household,'Manzana con frutos secos','snack','🍎',2)
  on conflict (household_id, name) do nothing;

  insert into public.hfw_meal_ingredients(household_id,meal_id,product_id,quantity_per_serving,unit,optional)
  select v_household, m.id, p.id, x.qty, x.unit, x.optional
  from (values
    ('Avena power','Avena',60::numeric,'g',false),
    ('Avena power','Leche',250::numeric,'ml',false),
    ('Avena power','Plátano',1::numeric,'unidad',false),
    ('Avena power','Yogur griego',1::numeric,'unidad',true),
    ('Huevos con palta','Huevos',2::numeric,'unidad',false),
    ('Huevos con palta','Palta',0.5::numeric,'unidad',false),
    ('Huevos con palta','Pan integral',2::numeric,'rebanada',false),
    ('Pollo, arroz y verduras','Pollo',180::numeric,'g',false),
    ('Pollo, arroz y verduras','Arroz',100::numeric,'g',false),
    ('Pollo, arroz y verduras','Verduras mixtas',200::numeric,'g',false),
    ('Atún, arroz y tomate','Atún',1::numeric,'lata',false),
    ('Atún, arroz y tomate','Arroz',100::numeric,'g',false),
    ('Atún, arroz y tomate','Tomate',1::numeric,'unidad',false),
    ('Omelette de verduras','Huevos',3::numeric,'unidad',false),
    ('Omelette de verduras','Verduras mixtas',150::numeric,'g',false),
    ('Omelette de verduras','Tomate',1::numeric,'unidad',false),
    ('Pollo con palta y tomate','Pollo',160::numeric,'g',false),
    ('Pollo con palta y tomate','Palta',0.5::numeric,'unidad',false),
    ('Pollo con palta y tomate','Tomate',1::numeric,'unidad',false),
    ('Yogur con plátano','Yogur griego',1::numeric,'unidad',false),
    ('Yogur con plátano','Plátano',1::numeric,'unidad',false),
    ('Manzana con frutos secos','Manzana',1::numeric,'unidad',false),
    ('Manzana con frutos secos','Frutos secos',30::numeric,'g',false)
  ) as x(meal_name,product_name,qty,unit,optional)
  join public.hfw_meal_templates m on m.household_id=v_household and m.name=x.meal_name
  join public.hfw_products p on p.household_id=v_household and p.name=x.product_name
  on conflict (meal_id, product_id) do nothing;

  select email into v_email from auth.users where id = v_user;
  insert into public.hfw_notification_preferences(household_id,user_id,email)
  values (v_household,v_user,v_email)
  on conflict (household_id) do nothing;

  return v_household;
end;
$$;

create or replace function public.hfw_adjust_stock(
  p_product_id uuid,
  p_delta numeric,
  p_location_id uuid default null,
  p_reason text default null
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
  v_remaining numeric;
  v_take numeric;
  v_lot record;
  v_total numeric;
begin
  select household_id, default_unit, coalesce(p_location_id, default_location_id)
  into v_household, v_unit, v_location
  from public.hfw_products
  where id = p_product_id;

  if v_household is null or not public.hfw_is_member(v_household) then
    raise exception 'Not authorized';
  end if;

  if p_location_id is not null then
    update public.hfw_products
    set default_location_id = p_location_id
    where id = p_product_id;
    v_location := p_location_id;
  end if;

  if p_delta > 0 then
    select * into v_lot
    from public.hfw_inventory_lots
    where product_id=p_product_id and household_id=v_household
      and coalesce(location_id,v_location)=v_location
      and expires_at is null
    order by created_at
    limit 1;

    if found then
      update public.hfw_inventory_lots set quantity = quantity + p_delta where id=v_lot.id;
    else
      insert into public.hfw_inventory_lots(household_id,product_id,location_id,quantity,unit,source)
      values(v_household,p_product_id,v_location,p_delta,v_unit,'manual');
    end if;
  elsif p_delta < 0 then
    select coalesce(sum(quantity),0) into v_total
    from public.hfw_inventory_lots
    where product_id=p_product_id and household_id=v_household;

    if v_total + p_delta < 0 then
      raise exception 'Insufficient stock';
    end if;

    v_remaining := abs(p_delta);
    for v_lot in
      select * from public.hfw_inventory_lots
      where product_id=p_product_id and household_id=v_household and quantity > 0
      order by expires_at nulls last, created_at
    loop
      exit when v_remaining <= 0;
      v_take := least(v_lot.quantity, v_remaining);
      update public.hfw_inventory_lots set quantity = quantity - v_take where id=v_lot.id;
      v_remaining := v_remaining - v_take;
    end loop;
  end if;

  if p_delta <> 0 then
    insert into public.hfw_inventory_events(household_id,product_id,event_type,quantity_delta,unit,reason)
    values(v_household,p_product_id,case when p_delta < 0 then 'consume' else 'adjust' end,p_delta,v_unit,p_reason);
  end if;

  select coalesce(sum(quantity),0) into v_total
  from public.hfw_inventory_lots
  where product_id=p_product_id and household_id=v_household;
  return v_total;
end;
$$;

create or replace function public.hfw_set_stock(
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
  v_current numeric;
begin
  if p_quantity < 0 then raise exception 'Quantity cannot be negative'; end if;
  select coalesce(sum(quantity),0) into v_current
  from public.hfw_inventory_lots where product_id=p_product_id;
  if p_quantity = v_current and p_location_id is not null then
    update public.hfw_products set default_location_id=p_location_id where id=p_product_id;
    return v_current;
  end if;
  return public.hfw_adjust_stock(p_product_id, p_quantity-v_current, p_location_id, 'set_stock');
end;
$$;

create or replace function public.hfw_consume_meal(p_meal_id uuid, p_servings int default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household uuid;
  v_ing record;
  v_available numeric;
begin
  select household_id into v_household from public.hfw_meal_templates where id=p_meal_id;
  if v_household is null or not public.hfw_is_member(v_household) then raise exception 'Not authorized'; end if;
  if p_servings <= 0 then raise exception 'Servings must be positive'; end if;

  for v_ing in
    select * from public.hfw_meal_ingredients
    where meal_id=p_meal_id and optional=false
  loop
    select coalesce(sum(quantity),0) into v_available
    from public.hfw_inventory_lots
    where product_id=v_ing.product_id and household_id=v_household;
    if v_available < v_ing.quantity_per_serving * p_servings then
      raise exception 'Insufficient stock for meal';
    end if;
  end loop;

  for v_ing in
    select * from public.hfw_meal_ingredients
    where meal_id=p_meal_id and optional=false
  loop
    perform public.hfw_adjust_stock(
      v_ing.product_id,
      -(v_ing.quantity_per_serving * p_servings),
      null,
      'meal:' || p_meal_id::text
    );
  end loop;

  insert into public.hfw_meal_events(household_id,meal_id,servings)
  values(v_household,p_meal_id,p_servings);
end;
$$;

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
  min(s.expires_at) filter (where s.quantity > 0) as next_expiry
from public.hfw_products p
left join public.hfw_inventory_lots s on s.product_id=p.id and s.household_id=p.household_id
left join public.hfw_locations l on l.id=p.default_location_id
where p.active=true
group by p.household_id,p.id,p.name,p.category,p.emoji,p.default_unit,p.min_stock,p.ideal_stock,p.default_location_id,l.name,l.type;

create or replace view public.hfw_meal_availability
with (security_invoker = true)
as
select
  m.household_id,
  m.id as meal_id,
  m.name,
  m.meal_type,
  m.emoji,
  m.prep_minutes,
  greatest(
    coalesce(
      floor(min(case when i.optional=false then coalesce(s.quantity,0) / nullif(i.quantity_per_serving,0) end)),
      0
    ),
    0
  )::int as servings_available
from public.hfw_meal_templates m
join public.hfw_meal_ingredients i on i.meal_id=m.id
left join public.hfw_inventory_state s on s.product_id=i.product_id and s.household_id=m.household_id
where m.active=true
group by m.household_id,m.id,m.name,m.meal_type,m.emoji,m.prep_minutes;

grant select on public.hfw_inventory_state to authenticated;
grant select on public.hfw_meal_availability to authenticated;
grant execute on function public.hfw_bootstrap() to authenticated;
grant execute on function public.hfw_adjust_stock(uuid,numeric,uuid,text) to authenticated;
grant execute on function public.hfw_set_stock(uuid,numeric,uuid) to authenticated;
grant execute on function public.hfw_consume_meal(uuid,int) to authenticated;

create index if not exists hfw_lots_product_idx on public.hfw_inventory_lots(household_id,product_id);
create index if not exists hfw_events_household_time_idx on public.hfw_inventory_events(household_id,occurred_at desc);
create index if not exists hfw_meal_events_household_time_idx on public.hfw_meal_events(household_id,occurred_at desc);
