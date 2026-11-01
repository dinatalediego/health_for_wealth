-- Meal Coverage v2
-- Adds explicit weekly meal targets and derives restock demand from preferred meals.

alter table public.hfw_meal_templates
  add column if not exists target_servings_per_week numeric not null default 0;

alter table public.hfw_meal_templates
  drop constraint if exists hfw_meal_templates_target_servings_per_week_check;

alter table public.hfw_meal_templates
  add constraint hfw_meal_templates_target_servings_per_week_check
  check (target_servings_per_week >= 0 and target_servings_per_week <= 50);

alter table public.hfw_kitchen_state_snapshots
  add column if not exists meal_plan_readiness_pct int not null default 0,
  add column if not exists meal_plan_coverage_days numeric not null default 0;

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
  m.target_servings_per_week,
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
group by
  m.household_id,m.id,m.name,m.meal_type,m.emoji,m.prep_minutes,m.target_servings_per_week;

grant select on public.hfw_meal_availability to authenticated;

create or replace view public.hfw_meal_plan_ingredient_demand
with (security_invoker = true)
as
with demand as (
  select
    m.household_id,
    i.product_id,
    sum(i.quantity_per_serving * m.target_servings_per_week)::numeric as weekly_target_quantity,
    string_agg(distinct m.name, ' · ' order by m.name) as planned_meals
  from public.hfw_meal_templates m
  join public.hfw_meal_ingredients i
    on i.meal_id = m.id
   and i.household_id = m.household_id
  where m.active = true
    and m.target_servings_per_week > 0
    and i.optional = false
  group by m.household_id, i.product_id
)
select
  d.household_id,
  d.product_id,
  p.name,
  p.emoji,
  p.default_unit as unit,
  d.weekly_target_quantity,
  coalesce(s.quantity,0)::numeric as quantity_on_hand,
  greatest(d.weekly_target_quantity - coalesce(s.quantity,0),0)::numeric as shortage_to_weekly_target,
  round((coalesce(s.quantity,0) / nullif(d.weekly_target_quantity,0)) * 7, 1) as meal_plan_coverage_days,
  greatest(p.min_stock, d.weekly_target_quantity * 3 / 7)::numeric as effective_min_stock,
  greatest(p.ideal_stock, d.weekly_target_quantity)::numeric as effective_ideal_stock,
  d.planned_meals
from demand d
join public.hfw_products p
  on p.id = d.product_id
 and p.household_id = d.household_id
left join public.hfw_inventory_state s
  on s.product_id = d.product_id
 and s.household_id = d.household_id
where p.active = true;

grant select on public.hfw_meal_plan_ingredient_demand to authenticated;

create or replace function public.hfw_seed_meal_coverage_v2(p_household uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meal uuid;
begin
  if not exists (select 1 from public.hfw_households where id = p_household) then
    return;
  end if;

  insert into public.hfw_products(
    household_id,name,category,emoji,default_unit,min_stock,ideal_stock,default_location_id,is_perishable
  ) values
    (
      p_household,'Lentejas','Legumbres','🫘','g',120,350,
      (select id from public.hfw_locations where household_id=p_household and name='Despensa' limit 1),
      false
    ),
    (
      p_household,'Brócoli','Verduras','🥦','g',180,600,
      (select id from public.hfw_locations where household_id=p_household and name='Refrigeradora' limit 1),
      true
    ),
    (
      p_household,'Zanahoria','Verduras','🥕','g',160,500,
      (select id from public.hfw_locations where household_id=p_household and name='Refrigeradora' limit 1),
      true
    )
  on conflict (household_id, name) do nothing;

  insert into public.hfw_meal_templates(
    household_id,name,meal_type,emoji,prep_minutes,target_servings_per_week
  )
  values(
    p_household,
    'Pollo con lentejas, brócoli y zanahoria',
    'lunch',
    '🥦',
    25,
    4
  )
  on conflict (household_id, name) do update
  set target_servings_per_week = case
    when public.hfw_meal_templates.target_servings_per_week = 0 then excluded.target_servings_per_week
    else public.hfw_meal_templates.target_servings_per_week
  end
  returning id into v_meal;

  if v_meal is null then
    select id into v_meal
    from public.hfw_meal_templates
    where household_id=p_household
      and name='Pollo con lentejas, brócoli y zanahoria'
    limit 1;
  end if;

  insert into public.hfw_meal_ingredients(
    household_id,meal_id,product_id,quantity_per_serving,unit,optional
  )
  select p_household, v_meal, p.id, x.qty, 'g', false
  from (values
    ('Pollo',200::numeric),
    ('Lentejas',70::numeric),
    ('Brócoli',120::numeric),
    ('Zanahoria',80::numeric)
  ) as x(product_name,qty)
  join public.hfw_products p
    on p.household_id=p_household
   and p.name=x.product_name
  on conflict (meal_id, product_id) do nothing;

  insert into public.hfw_product_aliases(household_id,product_id,alias,source)
  select p.household_id,p.id,x.alias,'seed'
  from public.hfw_products p
  join (values
    ('Lentejas','lentils'),
    ('Brócoli','broccoli'),
    ('Zanahoria','carrot')
  ) x(product_name,alias)
    on p.name=x.product_name
  where p.household_id=p_household
  on conflict (household_id, alias) do nothing;
end;
$$;

-- Existing households receive the new reference meal once.
do $$
declare
  h record;
begin
  for h in select id from public.hfw_households loop
    perform public.hfw_seed_meal_coverage_v2(h.id);
  end loop;
end;
$$;

-- Future households are seeded after bootstrap reaches notification preferences,
-- which happens after locations/products have already been created.
create or replace function public.hfw_seed_meal_coverage_v2_after_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hfw_seed_meal_coverage_v2(new.household_id);
  return new;
end;
$$;

drop trigger if exists hfw_notification_seed_meal_coverage_v2 on public.hfw_notification_preferences;
create trigger hfw_notification_seed_meal_coverage_v2
after insert on public.hfw_notification_preferences
for each row execute function public.hfw_seed_meal_coverage_v2_after_bootstrap();
