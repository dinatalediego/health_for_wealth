"use client";

import { useEffect, useRef, useState } from "react";
import { imageElementToJpegDataUrl } from "@/lib/vision";
import { getSupabase } from "@/lib/supabase";
import type { KitchenState, MealType } from "@/lib/types";

type DraftIngredient = {
  suggestedName: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  confidence: number;
  optional: boolean;
  note: string;
};

type MealDraft = {
  name: string;
  emoji: string;
  type: MealType;
  prepMinutes: number;
  ingredients: DraftIngredient[];
};

export function MealPhotoImport({
  state,
  onRefresh,
  flash
}: {
  state: KitchenState;
  onRefresh: () => Promise<void>;
  flash: (message: string) => void;
}) {
  const supabase = getSupabase();
  const [configured, setConfigured] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [target, setTarget] = useState(2);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    fetch("/api/meal-from-photo")
      .then(r => r.json())
      .then(data => setConfigured(Boolean(data?.configured)))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview("");
      setDraft(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    setDraft(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function analyze() {
    if (!configured) return flash("La lectura de meals por foto requiere OPENAI_API_KEY en Vercel.");
    if (!imgRef.current || !state.householdId || !supabase) return flash("Sube una foto primero.");

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return flash("Tu sesión expiró. Vuelve a ingresar.");

    setBusy(true);
    try {
      const imageDataUrl = imageElementToJpegDataUrl(imgRef.current, 1280, 0.76);
      const response = await fetch("/api/meal-from-photo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken
        },
        body: JSON.stringify({ householdId: state.householdId, imageDataUrl })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "No se pudo analizar la foto");
      setDraft(payload.draft);
      flash("Propuesta creada. Revisa antes de guardar.");
    } catch (error: any) {
      flash(error?.message ?? "No se pudo analizar la foto.");
    } finally {
      setBusy(false);
    }
  }

  function patchIngredient(index: number, patch: Partial<DraftIngredient>) {
    setDraft(current => current ? {
      ...current,
      ingredients: current.ingredients.map((row, i) => i === index ? { ...row, ...patch } : row)
    } : current);
  }

  async function saveMeal() {
    if (!supabase || !state.householdId || !draft) return;
    const valid = draft.ingredients.filter(row => row.productId && row.quantity > 0);
    if (valid.length < 2) return flash("Mapea al menos 2 ingredientes de tu catálogo antes de guardar.");

    setSaving(true);
    try {
      const { data: created, error } = await supabase
        .from("hfw_meal_templates")
        .insert({
          household_id: state.householdId,
          name: draft.name.trim(),
          emoji: draft.emoji || "🍽️",
          meal_type: draft.type,
          prep_minutes: Math.max(0, Number(draft.prepMinutes) || 0),
          target_servings_per_week: Math.max(0, Number(target) || 0)
        })
        .select("id")
        .single();

      if (error) throw error;

      const rows = valid.map(row => {
        const product = state.items.find(item => item.id === row.productId)!;
        return {
          household_id: state.householdId,
          meal_id: created.id,
          product_id: row.productId,
          quantity_per_serving: row.quantity,
          unit: product.unit,
          optional: row.optional
        };
      });

      const { error: ingredientError } = await supabase.from("hfw_meal_ingredients").insert(rows);
      if (ingredientError) {
        await supabase.from("hfw_meal_templates").delete().eq("id", created.id);
        throw ingredientError;
      }

      setFile(null);
      setDraft(null);
      await onRefresh();
      flash("Meal guardada y conectada a Meal Coverage ✓");
    } catch (error: any) {
      flash(error?.message ?? "No se pudo guardar la meal.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="manage-panel full">
      <div className="eyebrow">MEAL PHOTO BETA</div>
      <h3>Foto → propuesta → revisión → Meal Coverage.</h3>
      <p>Sube un plato que te gustaría repetir. La IA propone ingredientes y cantidades por porción, pero no guarda nada hasta que tú revisas el mapeo con tu catálogo.</p>

      {!configured && <div className="empty">El flujo está listo, pero el análisis multimodal está desactivado hasta configurar OPENAI_API_KEY.</div>}

      <div className="field-grid">
        <label className="field-wide">Foto del plato
          <input type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      {preview && (
        <div style={{display:"grid",gap:12,marginTop:12}}>
          <img ref={imgRef} src={preview} alt="Meal para analizar" style={{width:"100%",maxHeight:360,objectFit:"cover",borderRadius:18}} />
          <div className="form-actions">
            <button className="primary-action" disabled={busy || !configured} onClick={analyze}>{busy ? "Analizando…" : "✨ Proponer meal"}</button>
          </div>
        </div>
      )}

      {draft && (
        <div style={{display:"grid",gap:14,marginTop:18}}>
          <div className="field-grid">
            <label className="field">Nombre<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="field">Emoji<input value={draft.emoji} onChange={e => setDraft({ ...draft, emoji: e.target.value })} /></label>
            <label className="field">Momento
              <select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as MealType })}>
                <option value="breakfast">Desayuno</option>
                <option value="lunch">Almuerzo</option>
                <option value="dinner">Cena</option>
                <option value="snack">Snack</option>
              </select>
            </label>
            <label className="field">Preparación (min)<input type="number" min="0" value={draft.prepMinutes} onChange={e => setDraft({ ...draft, prepMinutes: Number(e.target.value) })} /></label>
            <label className="field">Objetivo / semana<input type="number" min="0" step="1" value={target} onChange={e => setTarget(Number(e.target.value))} /></label>
          </div>

          <div className="manager-list">
            {draft.ingredients.map((row, index) => (
              <div className="manager-row" key={index}>
                <div className="manager-row-head" style={{alignItems:"flex-start"}}>
                  <span>{row.productId ? "✓" : "?"}</span>
                  <div style={{flex:1}}>
                    <strong>{row.suggestedName}</strong>
                    <small>{Math.round(row.confidence * 100)}% confianza{row.note ? " · " + row.note : ""}</small>
                    <div className="edit-grid" style={{marginTop:8}}>
                      <select value={row.productId} onChange={e => {
                        const product = state.items.find(item => item.id === e.target.value);
                        patchIngredient(index, {
                          productId: e.target.value,
                          productName: product?.name ?? "",
                          unit: product?.unit ?? row.unit
                        });
                      }}>
                        <option value="">Sin mapear — crear/revisar alimento</option>
                        {state.items.map(item => <option key={item.id} value={item.id}>{item.emoji} {item.name} ({item.unit})</option>)}
                      </select>
                      <input type="number" min="0" step="0.1" value={row.quantity} onChange={e => patchIngredient(index, { quantity: Number(e.target.value) })} />
                      <input value={row.unit} readOnly />
                      <label><input type="checkbox" checked={row.optional} onChange={e => patchIngredient(index, { optional: e.target.checked })} /> opcional</label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {draft.ingredients.some(row => !row.productId) && (
            <div className="empty">Hay ingredientes sin mapear. Puedes elegir un alimento equivalente del catálogo o crearlo arriba en Food Catalog y volver a analizar/guardar.</div>
          )}

          <div className="form-actions">
            <button className="primary-action" disabled={saving} onClick={saveMeal}>{saving ? "Guardando…" : "Guardar meal revisada"}</button>
          </div>
        </div>
      )}
    </article>
  );
}
