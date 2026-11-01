import type { Item, KitchenState, Meal, MealType } from "./types";

const PLAN_DAYS = 7;
const RESTOCK_WARNING_DAYS = 3;

export function servingsForMeal(meal: Meal, items: Item[]) {
  const required = meal.ingredients.filter(i => !i.optional);
  if (!required.length) return 0;
  return Math.max(0, Math.floor(Math.min(...required.map(ing => {
    const item = items.find(x => x.id === ing.productId);
    return (item?.quantity ?? 0) / ing.quantity;
  }))));
}

export function weeklyTargetForMeal(meal: Meal) {
  const value = Number(meal.targetServingsPerWeek ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function mealTargetStatus(meal: Meal, items: Item[]) {
  const available = servingsForMeal(meal, items);
  const target = weeklyTargetForMeal(meal);
  const required = meal.ingredients.filter(i => !i.optional);
  const bottleneck = required
    .map(ing => {
      const item = items.find(x => x.id === ing.productId);
      return {
        productId: ing.productId,
        item,
        servings: ing.quantity > 0 ? (item?.quantity ?? 0) / ing.quantity : 0
      };
    })
    .sort((a, b) => a.servings - b.servings)[0];

  return {
    available,
    target,
    gap: Math.max(0, target - available),
    bottleneck: bottleneck?.item ?? null
  };
}

export function mealPlanIngredientStatuses(state: KitchenState) {
  const demand = new Map<string, { weeklyDemand: number; meals: Set<string> }>();

  for (const meal of state.meals) {
    const target = weeklyTargetForMeal(meal);
    if (target <= 0) continue;

    for (const ing of meal.ingredients.filter(i => !i.optional)) {
      const row = demand.get(ing.productId) ?? { weeklyDemand: 0, meals: new Set<string>() };
      row.weeklyDemand += ing.quantity * target;
      row.meals.add(meal.name);
      demand.set(ing.productId, row);
    }
  }

  return state.items
    .map(item => {
      const row = demand.get(item.id);
      if (!row || row.weeklyDemand <= 0) return null;

      const ratio = item.quantity / row.weeklyDemand;
      const coverageDaysForItem = Math.max(0, ratio * PLAN_DAYS);
      const effectiveMin = Math.max(item.min, row.weeklyDemand * RESTOCK_WARNING_DAYS / PLAN_DAYS);
      const effectiveIdeal = Math.max(item.ideal, row.weeklyDemand);

      return {
        ...item,
        weeklyDemand: row.weeklyDemand,
        deficitToWeeklyTarget: Math.max(0, row.weeklyDemand - item.quantity),
        coverageDays: coverageDaysForItem,
        effectiveMin,
        effectiveIdeal,
        plannedMeals: Array.from(row.meals)
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

export function mealPlanSummary(state: KitchenState) {
  const activeMeals = state.meals.filter(m => weeklyTargetForMeal(m) > 0);
  const targetServings = activeMeals.reduce((sum, meal) => sum + weeklyTargetForMeal(meal), 0);
  const ingredients = mealPlanIngredientStatuses(state);

  if (!activeMeals.length || !ingredients.length) {
    return {
      activeMeals: 0,
      targetServings: 0,
      readinessPct: 0,
      coveredDays: 0,
      limitingIngredient: null as (typeof ingredients)[number] | null,
      ingredients
    };
  }

  const limitingIngredient = [...ingredients].sort((a, b) => a.coverageDays - b.coverageDays)[0] ?? null;
  const coveredDays = Math.round(Math.min(PLAN_DAYS, limitingIngredient.coverageDays) * 10) / 10;
  const readinessPct = Math.round(Math.min(1, coveredDays / PLAN_DAYS) * 100);

  return {
    activeMeals: activeMeals.length,
    targetServings,
    readinessPct,
    coveredDays,
    limitingIngredient,
    ingredients
  };
}

// Conservative capacity per meal type: choose the best currently available option.
// We avoid summing alternative meals because they can share the same ingredients.
export function mealCounts(state: KitchenState) {
  const result: Record<MealType, number> = { breakfast:0, lunch:0, dinner:0, snack:0 };
  state.meals.forEach(m => {
    result[m.type] = Math.max(result[m.type], servingsForMeal(m, state.items));
  });
  return result;
}

// Greedy day-by-day simulation so the same eggs/rice/chicken are not counted twice
// across breakfast/lunch/dinner/snack. This is intentionally conservative and auditable.
export function coverageDays(state: KitchenState) {
  const quantities = new Map(state.items.map(i => [i.id, i.quantity]));
  const types: MealType[] = ["breakfast","lunch","dinner","snack"];
  let days = 0;

  for (let guard=0; guard<60; guard++) {
    const chosen: Meal[] = [];
    for (const type of types) {
      const candidates = state.meals
        .filter(m => m.type === type)
        .map(m => ({
          meal:m,
          servings: Math.floor(Math.min(...m.ingredients.filter(i=>!i.optional).map(ing => {
            return (quantities.get(ing.productId) ?? 0) / ing.quantity;
          })))
        }))
        .filter(x => Number.isFinite(x.servings) && x.servings >= 1)
        .sort((a,b) => b.servings-a.servings || a.meal.prepMinutes-b.meal.prepMinutes);

      if (!candidates.length) return days;
      chosen.push(candidates[0].meal);
    }

    for (const meal of chosen) {
      for (const ing of meal.ingredients.filter(i=>!i.optional)) {
        quantities.set(ing.productId, Math.max(0,(quantities.get(ing.productId) ?? 0)-ing.quantity));
      }
    }
    days++;
  }
  return days;
}

export function stockHealth(state: KitchenState) {
  if (!state.items.length) return 0;
  const plan = new Map(mealPlanIngredientStatuses(state).map(i => [i.id, i]));
  const healthy = state.items.filter(i => {
    const planned = plan.get(i.id);
    const threshold = planned ? Math.max(i.min, planned.effectiveMin) : i.min;
    return i.quantity >= threshold;
  }).length;
  return Math.round(healthy / state.items.length * 100);
}

export function itemStatus(item: Item) {
  if (item.quantity <= 0) return "OUT";
  if (item.quantity <= item.min) return "LOW";
  return "OK";
}

export function restockSuggestions(state: KitchenState) {
  const plan = new Map(mealPlanIngredientStatuses(state).map(i => [i.id, i]));

  return state.items
    .map(i => {
      const planned = plan.get(i.id);
      const effectiveMin = planned ? Math.max(i.min, planned.effectiveMin) : i.min;
      const effectiveIdeal = planned ? Math.max(i.ideal, planned.effectiveIdeal) : i.ideal;
      return {
        ...i,
        effectiveMin,
        effectiveIdeal,
        weeklyDemand: planned?.weeklyDemand ?? 0,
        mealCoverageDays: planned?.coverageDays ?? null,
        mealDriven: Boolean(planned),
        suggested: Math.max(0, effectiveIdeal - i.quantity)
      };
    })
    .filter(i => i.quantity <= i.effectiveMin && i.suggested > 0)
    .sort((a,b) => {
      const aRatio = a.quantity / Math.max(a.effectiveMin, 1);
      const bRatio = b.quantity / Math.max(b.effectiveMin, 1);
      if (aRatio !== bRatio) return aRatio - bRatio;
      return b.suggested - a.suggested;
    });
}

export function mealsUnlockedByRestock(state: KitchenState, productId: string) {
  const before = state.meals.reduce((s,m)=>s+servingsForMeal(m,state.items),0);
  const suggestion = restockSuggestions(state).find(i => i.id === productId);
  const item = state.items.find(i => i.id === productId);
  const refillTo = suggestion?.effectiveIdeal ?? item?.ideal ?? 0;
  const items = state.items.map(i => i.id===productId ? {...i, quantity:Math.max(i.quantity, refillTo)} : i);
  const after = state.meals.reduce((s,m)=>s+servingsForMeal(m,items),0);
  return Math.max(0, after-before);
}

export function mealTypeLabel(type: MealType) {
  return ({breakfast:"Desayuno",lunch:"Almuerzo",dinner:"Cena",snack:"Snack"} as const)[type];
}
