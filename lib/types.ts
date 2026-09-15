export type LocationType = "fridge" | "freezer" | "pantry" | "organizer";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type Location = {
  id: string;
  name: string;
  type: LocationType;
};

export type Item = {
  id: string;
  householdId?: string;
  name: string;
  emoji: string;
  category: string;
  unit: string;
  quantity: number;
  min: number;
  ideal: number;
  locationId: string;
  locationName: string;
  locationType: LocationType;
  nextExpiry?: string | null;
};

export type Ingredient = {
  productId: string;
  quantity: number;
  unit: string;
  optional?: boolean;
};

export type Meal = {
  id: string;
  name: string;
  emoji: string;
  type: MealType;
  prepMinutes: number;
  ingredients: Ingredient[];
};

export type InventoryEvent = {
  id: string;
  productId: string;
  type: "purchase" | "consume" | "waste" | "adjust" | "move" | "open";
  delta: number;
  unit: string;
  occurredAt: string;
  reason?: string | null;
};

export type MealEvent = {
  id: string;
  mealId: string;
  servings: number;
  occurredAt: string;
};

export type KitchenState = {
  householdId?: string;
  locations: Location[];
  items: Item[];
  meals: Meal[];
  events: InventoryEvent[];
  mealEvents: MealEvent[];
};
