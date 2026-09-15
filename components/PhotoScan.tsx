"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { detectKitchenObjects, estimateVisibleFill, groupPredictions, visionLabelEs } from "@/lib/vision";
import { getSupabase } from "@/lib/supabase";
import type { KitchenState, VisionGroup } from "@/lib/types";

type Candidate = VisionGroup & {
  productId: string;
  quantity: number;
  unit: string;
  accepted: boolean;
  edited: boolean;
};

export function PhotoScan({
  state, cloud, session, initialLocationId, onRefresh, onManageKitchen, flash
}: {
  state: KitchenState;
  cloud: boolean;
  session: any;
  initialLocationId?: string;
  onRefresh: () => Promise<void>;
  onManageKitchen: () => void;
  flash: (m: string) => void;
}) {
  const supabase = getSupabase();
  const [locationId, setLocationId] = useState(initialLocationId ?? state.locations[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [fill, setFill] = useState(50);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (initialLocationId) setLocationId(initialLocationId);
  }, [initialLocationId]);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const currentLocation = useMemo(
    () => state.locations.find(l => l.id === locationId),
    [state.locations, locationId]
  );

  async function buildAliasMap() {
    const aliases = new Map<string, string>();
    state.items.forEach(i => aliases.set(i.name.trim().toLowerCase(), i.id));

    if (cloud && supabase && state.householdId) {
      const { data } = await supabase
        .from("hfw_product_aliases")
        .select("alias,product_id")
        .eq("household_id", state.householdId);
      (data ?? []).forEach((r: any) => aliases.set(String(r.alias).toLowerCase(), r.product_id));
    }

    return aliases;
  }

  async function analyze() {
    if (!imgRef.current || !file) return flash("Primero toma o sube una foto.");
    setAnalyzing(true);

    try {
      const rows = await detectKitchenObjects(imgRef.current);
      const groups = groupPredictions(rows);
      const aliases = await buildAliasMap();

      const next: Candidate[] = groups.map(g => {
        const translated = (visionLabelEs[g.label] ?? g.label).toLowerCase();
        const productId = aliases.get(g.label) ?? aliases.get(translated) ?? "";
        const item = state.items.find(i => i.id === productId);

        return {
          ...g,
          productId,
          quantity: g.count,
          unit: item?.unit ?? "unidad",
          accepted: Boolean(productId),
          edited: false
        };
      });

      setCandidates(next);
      setFill(estimateVisibleFill(rows, imgRef.current.naturalWidth, imgRef.current.naturalHeight));

      if (!next.length) {
        flash("La IA no encontró objetos con suficiente confianza. Puedes seguir usando actualización manual.");
      }
    } catch (e: any) {
      flash(e?.message ?? "No se pudo analizar la foto.");
    } finally {
      setAnalyzing(false);
    }
  }

  function updateCandidate(index: number, patch: Partial<Candidate>) {
    setCandidates(rows => rows.map((r, i) => i === index ? { ...r, ...patch, edited: true } : r));
  }

  async function applyScan() {
    if (!cloud || !supabase || !session?.user || !state.householdId) {
      return flash("Para guardar scans y construir historial, entra con tu cuenta.");
    }
    if (!file || !locationId) return flash("Falta foto o storage space.");

    setSaving(true);
    let scanId = "";

    try {
      const { data: scan, error: scanError } = await supabase
        .from("hfw_scan_sessions")
        .insert({
          household_id: state.householdId,
          location_id: locationId,
          status: "processed",
          fill_percent: fill,
          model_name: "coco-ssd/lite_mobilenet_v2",
          inference_mode: "browser"
        })
        .select("id")
        .single();

      if (scanError) throw scanError;
      scanId = scan.id;

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = session.user.id + "/" + state.householdId + "/" + scanId + "/" + Date.now() + "-" + safeName;

      const { error: uploadError } = await supabase.storage
        .from("hfw-kitchen-scans")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: imageError } = await supabase.from("hfw_scan_images").insert({
        household_id: state.householdId,
        scan_session_id: scanId,
        storage_path: path,
        width: imgRef.current?.naturalWidth ?? null,
        height: imgRef.current?.naturalHeight ?? null
      });
      if (imageError) throw imageError;

      if (candidates.length) {
        const rows = candidates.map(c => {
          const accepted = c.accepted && Boolean(c.productId);
          const changed = c.edited || c.quantity !== c.count;

          return {
            household_id: state.householdId,
            scan_session_id: scanId,
            raw_label: c.label,
            product_id: c.productId || null,
            suggested_quantity: c.count,
            confirmed_quantity: accepted ? Math.max(0, c.quantity) : null,
            unit: c.unit,
            confidence: c.confidence,
            bbox: { boxes: c.bboxes },
            status: accepted ? (changed ? "edited" : "confirmed") : "rejected"
          };
        });

        const { error: candidateError } = await supabase.from("hfw_scan_candidates").insert(rows);
        if (candidateError) throw candidateError;
      }

      const { error: applyError } = await supabase.rpc("hfw_apply_scan", {
        p_scan_id: scanId,
        p_fill_percent: fill
      });
      if (applyError) throw applyError;

      await onRefresh();
      flash("Scan aplicado: stock, meals y reporting recalculados ✓");
      setFile(null);
      setCandidates([]);
      setFill(50);
    } catch (e: any) {
      if (scanId) {
        await supabase.from("hfw_scan_sessions").update({ status: "failed" }).eq("id", scanId);
      }
      flash(e?.message ?? "No se pudo guardar el scan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page">
      <div className="page-title">
        <div className="eyebrow">PHOTO SCAN BETA · ON DEVICE</div>
        <h2>Escanea tu cocina.</h2>
        <p>La IA propone. Tú confirmas. Solo entonces cambia el inventario. La inferencia inicial corre en tu navegador para mantener el costo del beta cercano a cero.</p>
      </div>

      <div className="scan-shell">
        <article className="scan-panel">
          <div className="eyebrow">1 · CAPTURE</div>
          <h3>{currentLocation?.name ?? "Storage space"}</h3>

          <label className="field-wide">
            Storage space
            <select value={locationId} onChange={e => setLocationId(e.target.value)}>
              {state.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>

          <div className="upload-zone">
            {preview ? (
              <img ref={imgRef} src={preview} alt="Vista previa del storage space" />
            ) : (
              <div>
                <strong>📷 Foto de refrigeradora, freezer u organizador</strong>
                <p className="scan-note">Una foto frontal, con buena luz y pocos objetos tapándose entre sí mejora la detección.</p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            )}
          </div>

          {preview && (
            <div className="scan-actions">
              <label className="soft-action">
                Cambiar foto
                <input
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button className="primary-action" onClick={analyze} disabled={analyzing}>
                {analyzing ? "Analizando…" : "✦ Analizar foto"}
              </button>
            </div>
          )}

          <div className="fill-control">
            <span>Ocupación visual del espacio</span>
            <strong>{fill}%</strong>
            <input type="range" min="0" max="100" value={fill} onChange={e => setFill(Number(e.target.value))} />
          </div>
          <p className="scan-note">El porcentaje es una sugerencia visual, no una medición volumétrica. Ajústalo si la perspectiva engaña.</p>
        </article>

        <article className="scan-panel">
          <div className="eyebrow">2 · REVIEW</div>
          <h3>Confirmación humana <span className="beta-pill">BETA</span></h3>

          {!candidates.length && (
            <div className="scan-empty">
              Después de analizar aparecerán aquí los objetos detectados. Los no reconocidos nunca actualizarán el stock por sí solos.
            </div>
          )}

          <div className="candidate-list">
            {candidates.map((c, index) => (
              <div className={"candidate-row " + (!c.accepted ? "rejected" : "")} key={c.label}>
                <input
                  type="checkbox"
                  checked={c.accepted}
                  onChange={e => updateCandidate(index, { accepted: e.target.checked })}
                />
                <div className="candidate-label">
                  <strong>{visionLabelEs[c.label] ?? c.label}</strong>
                  <small>detectado × {c.count}</small>
                </div>
                <select
                  value={c.productId}
                  onChange={e => {
                    const item = state.items.find(i => i.id === e.target.value);
                    updateCandidate(index, {
                      productId: e.target.value,
                      unit: item?.unit ?? "unidad",
                      accepted: Boolean(e.target.value)
                    });
                  }}
                >
                  <option value="">Sin mapear</option>
                  {state.items.map(i => <option key={i.id} value={i.id}>{i.emoji} {i.name}</option>)}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={c.quantity}
                  onChange={e => updateCandidate(index, { quantity: Number(e.target.value) })}
                />
                <span className="confidence">{Math.round(c.confidence * 100)}%</span>
              </div>
            ))}
          </div>

          {candidates.some(c => !c.productId) && (
            <p className="scan-note">
              ¿Falta un alimento de tu catálogo?{" "}
              <button className="manage-link" onClick={onManageKitchen}>Créalo en Personal Kitchen</button> y vuelve al scan.
            </p>
          )}

          <div className="scan-actions">
            <button className="primary-action" onClick={applyScan} disabled={saving || !file}>
              {saving ? "Aplicando…" : "✓ Confirmar y actualizar cocina"}
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
