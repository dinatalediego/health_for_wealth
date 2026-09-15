import type { Item, KitchenState, Meal, MealType } from "./types";

export function servingsForMeal(meal: Meal, items: Item[]) {
  const required = meal.ingredients.filter(i => !i.optional);
  if (!required.length) return 0;
  return Math.max(0, Math.floor(Math.min(...required.map(ing => {
    const item = items.find(x => x.id === ing.productId);
    return (item?.quantity ?? 0) / ing.quantity;
  }))));
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
  const healthy = state.items.filter(i => i.quantity >= i.min).length;
  return Math.round(healthy / state.items.length * 100);
}

export function itemStatus(item: Item) {
  if (item.quantity <= 0) return "OUT";
  if (item.quantity <= item.min) return "LOW";
  return "OK";
}

export function restockSuggestions(state: KitchenState) {
  return state.items
    .filter(i => i.quantity <= i.min)
    .map(i => ({...i, suggested: Math.max(0, i.ideal - i.quantity)}))
    .filter(i => i.suggested > 0)
    .sort((a,b) => (a.quantity/Math.max(a.ideal,1)) - (b.quantity/Math.max(b.ideal,1)));
}

export function mealsUnlockedByRestock(state: KitchenState, productId: string) {
  const before = state.meals.reduce((s,m)=>s+servingsForMeal(m,state.items),0);
  const items = state.items.map(i => i.id===productId ? {...i, quantity:i.ideal} : i);
  const after = state.meals.reduce((s,m)=>s+servingsForMeal(m,items),0);
  return Math.max(0, after-before);
}

export function mealTypeLabel(type: MealType) {
  return ({breakfast:"Desayuno",lunch:"Almuerzo",dinner:"Cena",snack:"Snack"} as const)[type];
}
