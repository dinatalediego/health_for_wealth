"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { Item, KitchenState, LocationType, MealType } from "@/lib/types";

export function PersonalKitchen({
  state, cloud, onRefresh, flash
}: {
  state: KitchenState;
  cloud: boolean;
  onRefresh: () => Promise<void>;
  flash: (m: string) => void;
}) {
  const supabase = getSupabase();
  const [product, setProduct] = useState({
    name: "", emoji: "🥗", category: "Otros", unit: "unidad",
    min: "1", ideal: "5", locationId: state.locations[0]?.id ?? "", isPerishable: true
  });
  const [location, setLocation] = useState({ name: "", type: "other" as LocationType });
  const [meal, setMeal] = useState({ name: "", emoji: "🍽️", type: "lunch" as MealType, prep: "15" });
  const [ingredientQty, setIngredientQty] = useState<Record<string, string>>({});

  if (!cloud || !supabase || !state.householdId) {
    return (
      <section className="page">
        <div className="page-title">
          <div className="eyebrow">PERSONAL KITCHEN</div>
          <h2>Tu catálogo real.</h2>
          <p>Entra con tu cuenta para crear alimentos, recetas y espacios que se sincronicen entre dispositivos.</p>
        </div>
      </section>
    );
  }

  async function addProduct() {
    if (!product.name.trim() || !product.locationId) return flash("Completa nombre y ubicación.");

    const { error } = await supabase.from("hfw_products").insert({
      household_id: state.householdId,
      name: product.name.trim(),
      emoji: product.emoji || "🥗",
      category: product.category || "Otros",
      default_unit: product.unit || "unidad",
      min_stock: Number(product.min) || 0,
      ideal_stock: Math.max(Number(product.ideal) || 0, Number(product.min) || 0),
      default_location_id: product.locationId,
      is_perishable: product.isPerishable
    });

    if (error) return flash(error.message);
    setProduct(p => ({ ...p, name: "" }));
    await onRefresh();
    flash("Alimento agregado ✓");
  }

  async function addLocation() {
    if (!location.name.trim()) return;

    const { error } = await supabase.from("hfw_locations").insert({
      household_id: state.householdId,
      name: location.name.trim(),
      type: location.type,
      sort_order: state.locations.length + 1
    });

    if (error) return flash(error.message);
    setLocation({ name: "", type: "other" });
    await onRefresh();
    flash("Storage space agregado ✓");
  }

  async function addMeal() {
    const selected = Object.entries(ingredientQty).filter(([, q]) => Number(q) > 0);
    if (!meal.name.trim() || !selected.length) return flash("Pon nombre y al menos un ingrediente.");

    const { data: newMeal, error } = await supabase
      .from("hfw_meal_templates")
      .insert({
        household_id: state.householdId,
        name: meal.name.trim(),
        emoji: meal.emoji || "🍽️",
        meal_type: meal.type,
        prep_minutes: Math.max(0, Number(meal.prep) || 0)
      })
      .select("id")
      .single();

    if (error) return flash(error.message);

    const rows = selected.map(([productId, q]) => {
      const item = state.items.find(i => i.id === productId)!;
      return {
        household_id: state.householdId,
        meal_id: newMeal.id,
        product_id: productId,
        quantity_per_serving: Number(q),
        unit: item.unit,
        optional: false
      };
    });

    const { error: ingredientError } = await supabase.from("hfw_meal_ingredients").insert(rows);
    if (ingredientError) {
      await supabase.from("hfw_meal_templates").delete().eq("id", newMeal.id);
      return flash(ingredientError.message);
    }

    setMeal({ name: "", emoji: "🍽️", type: "lunch", prep: "15" });
    setIngredientQty({});
    await onRefresh();
    flash("Meal creada ✓");
  }

  async function archiveMeal(id: string) {
    const { error } = await supabase.from("hfw_meal_templates").update({ active: false }).eq("id", id);
    if (error) return flash(error.message);
    await onRefresh();
    flash("Meal archivada.");
  }

  return (
    <section className="page">
      <div className="page-title">
        <div className="eyebrow">PERSONAL KITCHEN</div>
        <h2>Haz que la app se parezca a tu cocina.</h2>
        <p>Catálogo, recipes y storage spaces son tuyos. El scan visual aprende sobre esta base, no sobre un inventario genérico.</p>
      </div>

      <div className="manage-grid">
        <article className="manage-panel">
          <div className="eyebrow">FOOD CATALOG</div>
          <h3>Agregar alimento</h3>

          <div className="field-grid">
            <label className="field">Nombre<input value={product.name} onChange={e => setProduct({ ...product, name: e.target.value })} /></label>
            <label className="field">Emoji<input value={product.emoji} onChange={e => setProduct({ ...product, emoji: e.target.value })} /></label>
            <label className="field">Categoría<input value={product.category} onChange={e => setProduct({ ...product, category: e.target.value })} /></label>
            <label className="field">Unidad<input value={product.unit} onChange={e => setProduct({ ...product, unit: e.target.value })} placeholder="unidad, g, ml..." /></label>
            <label className="field">Mínimo<input type="number" min="0" value={product.min} onChange={e => setProduct({ ...product, min: e.target.value })} /></label>
            <label className="field">Ideal<input type="number" min="0" value={product.ideal} onChange={e => setProduct({ ...product, ideal: e.target.value })} /></label>

            <label className="field-wide">Ubicación
              <select value={product.locationId} onChange={e => setProduct({ ...product, locationId: e.target.value })}>
                {state.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>

            <label className="field-wide">
              <span><input type="checkbox" checked={product.isPerishable} onChange={e => setProduct({ ...product, isPerishable: e.target.checked })} /> Perecible</span>
            </label>
          </div>

          <div className="form-actions">
            <button className="primary-action" onClick={addProduct}>+ Agregar alimento</button>
          </div>

          <div className="manager-list">
            {state.items.map(i => <ProductRow key={i.id} item={i} state={state} onRefresh={onRefresh} flash={flash} />)}
          </div>
        </article>

        <article className="manage-panel">
          <div className="eyebrow">STORAGE SPACES</div>
          <h3>Agregar espacio</h3>

          <div className="field-grid">
            <label className="field">Nombre<input value={location.name} onChange={e => setLocation({ ...location, name: e.target.value })} placeholder="Cajón verduras, alacena..." /></label>
            <label className="field">Tipo
              <select value={location.type} onChange={e => setLocation({ ...location, type: e.target.value as LocationType })}>
                <option value="fridge">Refrigeradora</option>
                <option value="freezer">Freezer</option>
                <option value="pantry">Despensa</option>
                <option value="organizer">Organizador</option>
                <option value="other">Otro</option>
              </select>
            </label>
          </div>

          <div className="form-actions">
            <button className="primary-action" onClick={addLocation}>+ Agregar espacio</button>
          </div>

          <div className="manager-list">
            {state.locations.map(l => (
              <div className="manager-row" key={l.id}>
                <div className="manager-row-head">
                  <span>{({ fridge: "❄️", freezer: "🧊", pantry: "🥫", organizer: "🧺", other: "📦" } as Record<string, string>)[l.type]}</span>
                  <div><strong>{l.name}</strong><small>{l.type}</small></div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="manage-panel full">
          <div className="eyebrow">MEAL LIBRARY</div>
          <h3>Crear una meal propia</h3>

          <div className="field-grid">
            <label className="field">Nombre<input value={meal.name} onChange={e => setMeal({ ...meal, name: e.target.value })} /></label>
            <label className="field">Emoji<input value={meal.emoji} onChange={e => setMeal({ ...meal, emoji: e.target.value })} /></label>
            <label className="field">Momento
              <select value={meal.type} onChange={e => setMeal({ ...meal, type: e.target.value as MealType })}>
                <option value="breakfast">Desayuno</option>
                <option value="lunch">Almuerzo</option>
                <option value="dinner">Cena</option>
                <option value="snack">Snack</option>
              </select>
            </label>
            <label className="field">Preparación (min)<input type="number" min="0" value={meal.prep} onChange={e => setMeal({ ...meal, prep: e.target.value })} /></label>
          </div>

          <div className="ingredient-grid">
            {state.items.map(i => (
              <label className="ingredient-pick" key={i.id}>
                <span>{i.emoji} {i.name} <small>({i.unit})</small></span>
                <input type="number" min="0" step="0.1" placeholder="0" value={ingredientQty[i.id] ?? ""} onChange={e => setIngredientQty({ ...ingredientQty, [i.id]: e.target.value })} />
              </label>
            ))}
          </div>

          <div className="form-actions">
            <button className="primary-action" onClick={addMeal}>+ Crear meal</button>
          </div>

          <div className="manager-list">
            {state.meals.map(m => (
              <div className="manager-row" key={m.id}>
                <div className="manager-row-head">
                  <span>{m.emoji}</span>
                  <div><strong>{m.name}</strong><small>{m.type} · {m.ingredients.length} ingredientes · {m.prepMinutes} min</small></div>
                  <div className="manager-row-actions"><button className="soft-action" onClick={() => archiveMeal(m.id)}>Archivar</button></div>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function ProductRow({
  item, state, onRefresh, flash
}: {
  item: Item;
  state: KitchenState;
  onRefresh: () => Promise<void>;
  flash: (m: string) => void;
}) {
  const supabase = getSupabase()!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: item.name,
    emoji: item.emoji,
    category: item.category,
    unit: item.unit,
    min: String(item.min),
    ideal: String(item.ideal),
    locationId: item.locationId,
    isPerishable: item.isPerishable !== false
  });

  async function save() {
    const { error } = await supabase.from("hfw_products").update({
      name: draft.name.trim(),
      emoji: draft.emoji,
      category: draft.category,
      default_unit: draft.unit,
      min_stock: Number(draft.min) || 0,
      ideal_stock: Math.max(Number(draft.ideal) || 0, Number(draft.min) || 0),
      default_location_id: draft.locationId,
      is_perishable: draft.isPerishable
    }).eq("id", item.id);

    if (error) return flash(error.message);
    setEditing(false);
    await onRefresh();
    flash("Alimento actualizado ✓");
  }

  async function archive() {
    const { error } = await supabase.from("hfw_products").update({ active: false }).eq("id", item.id);
    if (error) return flash(error.message);
    await onRefresh();
    flash("Alimento archivado.");
  }

  return (
    <div className="manager-row">
      <div className="manager-row-head">
        <span>{item.emoji}</span>
        <div><strong>{item.name}</strong><small>{item.category} · {item.locationName} · min {item.min} / ideal {item.ideal}</small></div>
        <div className="manager-row-actions">
          <button className="soft-action" onClick={() => setEditing(!editing)}>{editing ? "Cerrar" : "Editar"}</button>
          <button className="soft-action" onClick={archive}>Archivar</button>
        </div>
      </div>

      {editing && (
        <div className="edit-grid">
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          <input value={draft.emoji} onChange={e => setDraft({ ...draft, emoji: e.target.value })} />
          <input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} />
          <input value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} />
          <input type="number" value={draft.min} onChange={e => setDraft({ ...draft, min: e.target.value })} />
          <input type="number" value={draft.ideal} onChange={e => setDraft({ ...draft, ideal: e.target.value })} />

          <select value={draft.locationId} onChange={e => setDraft({ ...draft, locationId: e.target.value })}>
            {state.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>

          <label><input type="checkbox" checked={draft.isPerishable} onChange={e => setDraft({ ...draft, isPerishable: e.target.checked })} /> Perecible</label>
          <button className="primary-action" onClick={save}>Guardar</button>
        </div>
      )}
    </div>
  );
}
