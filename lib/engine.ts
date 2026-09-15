import type { Item, KitchenState, Meal, MealType } from "./types";

export function servingsForMeal(meal: Meal, items: Item[]) {
  const required = meal.ingredients.filter(i => !i.optional);
  if (!required.length) return 0;
  return Math.max(0, Math.floor(Math.min(...required.map(ing => {
    const item = items.find(x => x.id === ing.productId);
    return (item?.quantity ?? 0) / ing.quantity;
  }))));
}

export function mealCounts(state: KitchenState) {
  const result: Record<MealType, number> = { breakfast:0, lunch:0, dinner:0, snack:0 };
  state.meals.forEach(m => { result[m.type] += servingsForMeal(m, state.items); });
  return result;
}

export function coverageDays(state: KitchenState) {
  const c = mealCounts(state);
  return Math.max(0, Math.min(c.breakfast, c.lunch, c.dinner, c.snack));
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
    .sort((a,b) => (a.quantity/a.ideal) - (b.quantity/b.ideal));
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
