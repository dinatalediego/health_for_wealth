"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  detectBarcodeValues,
  detectKitchenObjects,
  estimateVisibleFill,
  groupPredictions,
  imageElementToJpegDataUrl,
  normalizeVisionText,
  readKitchenText,
  visionLabelEs
} from "@/lib/vision";
import { getSupabase } from "@/lib/supabase";
import type { KitchenState, VisionGroup } from "@/lib/types";

type EvidenceType = "object" | "ocr" | "barcode" | "multimodal";

type Candidate = VisionGroup & {
  productId: string;
  quantity: number;
  unit: string;
  accepted: boolean;
  edited: boolean;
  evidenceType: EvidenceType;
  note?: string;
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
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const [fallbackConfigured, setFallbackConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [multimodalUsed, setMultimodalUsed] = useState(false);
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

  useEffect(() => {
    fetch("/api/vision/fallback")
      .then(r => r.json())
      .then(data => setFallbackConfigured(Boolean(data?.configured)))
      .catch(() => setFallbackConfigured(false));
  }, []);

  const currentLocation = useMemo(
    () => state.locations.find(l => l.id === locationId),
    [state.locations, locationId]
  );

  async function buildAliasMap() {
    const aliases = new Map<string, string>();
    state.items.forEach(i => aliases.set(normalizeVisionText(i.name), i.id));

    if (cloud && supabase && state.householdId) {
      const { data } = await supabase
        .from("hfw_product_aliases")
        .select("alias,product_id")
        .eq("household_id", state.householdId);

      (data ?? []).forEach((r: any) => {
        aliases.set(normalizeVisionText(String(r.alias)), r.product_id);
      });
    }

    return aliases;
  }

  function mergeCandidates(next: Candidate[]) {
    setCandidates(current => {
      const merged = [...current];
      for (const candidate of next) {
        const index = merged.findIndex(row =>
          row.productId &&
          candidate.productId &&
          row.productId === candidate.productId &&
          row.evidenceType === candidate.evidenceType
        );
        if (index >= 0) {
          merged[index] = candidate;
        } else {
          merged.push(candidate);
        }
      }
      return merged;
    });
  }

  async function analyzeObjects() {
    if (!imgRef.current || !file) return flash("Primero toma o sube una foto.");
    setAnalyzing(true);

    try {
      const rows = await detectKitchenObjects(imgRef.current);
      const groups = groupPredictions(rows);
      const aliases = await buildAliasMap();

      const next: Candidate[] = groups.map(g => {
        const translated = normalizeVisionText(visionLabelEs[g.label] ?? g.label);
        const productId =
          aliases.get(normalizeVisionText(g.label)) ??
          aliases.get(translated) ??
          "";
        const item = state.items.find(i => i.id === productId);

        return {
          ...g,
          productId,
          quantity: g.count,
          unit: item?.unit ?? "unidad",
          accepted: Boolean(productId),
          edited: false,
          evidenceType: "object"
        };
      });

      mergeCandidates(next);
      setFill(estimateVisibleFill(rows, imgRef.current.naturalWidth, imgRef.current.naturalHeight));

      if (!next.length) {
        flash("El detector genérico no encontró objetos suficientes. Prueba barcode, OCR o fallback.");
      }
    } catch (e: any) {
      flash(e?.message ?? "No se pudo analizar la foto.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeBarcodes() {
    if (!imgRef.current || !file) return flash("Primero toma o sube una foto.");
    setBarcodeBusy(true);

    try {
      const values = await detectBarcodeValues(imgRef.current);
      setBarcodes(values);

      if (!values.length) {
        flash("No encontré un barcode legible en esta foto.");
        return;
      }

      const next: Candidate[] = values.map(value => {
        const item = state.items.find(i => i.barcode && String(i.barcode) === value);
        return {
          label: "barcode:" + value,
          count: 1,
          confidence: 0.99,
          bboxes: [],
          productId: item?.id ?? "",
          quantity: 1,
          unit: item?.unit ?? "unidad",
          accepted: Boolean(item),
          edited: false,
          evidenceType: "barcode",
          note: item ? "Barcode exacto del catálogo" : "Barcode sin producto asociado"
        };
      });

      mergeCandidates(next);
      flash(values.length + " barcode(s) detectado(s).");
    } catch (e: any) {
      flash(e?.message ?? "No se pudo leer el barcode.");
    } finally {
      setBarcodeBusy(false);
    }
  }

  async function analyzeOcr() {
    if (!imgRef.current || !file) return flash("Primero toma o sube una foto.");
    setOcrBusy(true);
    setOcrProgress(0);

    try {
      const result = await readKitchenText(imgRef.current, setOcrProgress);
      setOcrText(result.text);

      if (!result.text) {
        flash("No encontré texto suficientemente legible.");
        return;
      }

      const normalized = normalizeVisionText(result.text);
      const aliases = await buildAliasMap();
      const matchedProductIds = new Set<string>();

      for (const [alias, productId] of aliases.entries()) {
        if (alias.length >= 4 && normalized.includes(alias)) {
          matchedProductIds.add(productId);
        }
      }

      const next: Candidate[] = [...matchedProductIds].map(productId => {
        const item = state.items.find(i => i.id === productId)!;
        return {
          label: "ocr:" + item.name,
          count: 1,
          confidence: Math.max(0.35, Math.min(0.95, result.confidence)),
          bboxes: [],
          productId,
          quantity: 1,
          unit: item.unit,
          accepted: true,
          edited: false,
          evidenceType: "ocr",
          note: "Coincidencia por texto visible"
        };
      });

      mergeCandidates(next);
      flash(next.length
        ? next.length + " producto(s) sugerido(s) por OCR."
        : "Leí texto, pero no coincide todavía con tu catálogo.");
    } catch (e: any) {
      flash(e?.message ?? "No se pudo ejecutar OCR.");
    } finally {
      setOcrBusy(false);
      setOcrProgress(0);
    }
  }

  async function analyzeFallback() {
    if (!fallbackConfigured) {
      return flash("Fallback multimodal aún no está configurado con OPENAI_API_KEY.");
    }
    if (!imgRef.current || !session?.access_token || !state.householdId) {
      return flash("Necesitas foto y sesión cloud.");
    }

    setFallbackBusy(true);
    try {
      const unresolvedLabels = candidates
        .filter(c => !c.productId || c.confidence < 0.55)
        .map(c => c.label);

      const response = await fetch("/api/vision/fallback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.access_token
        },
        body: JSON.stringify({
          householdId: state.householdId,
          imageDataUrl: imageElementToJpegDataUrl(imgRef.current),
          unresolvedLabels,
          ocrText
        })
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "fallback_failed");

      const next: Candidate[] = (payload.suggestions ?? []).map((s: any) => ({
        label: "multimodal:" + s.productName,
        count: Number(s.quantity ?? 1),
        confidence: Number(s.confidence ?? 0.5),
        bboxes: [],
        productId: s.productId,
        quantity: Number(s.quantity ?? 1),
        unit: s.unit ?? "unidad",
        accepted: true,
        edited: false,
        evidenceType: "multimodal",
        note: s.reason
      }));

      mergeCandidates(next);
      setMultimodalUsed(true);
      flash(next.length
        ? "Fallback multimodal resolvió " + next.length + " candidato(s)."
        : "El fallback no encontró evidencia suficiente para agregar productos.");
    } catch (e: any) {
      flash(e?.message ?? "No se pudo ejecutar el fallback multimodal.");
    } finally {
      setFallbackBusy(false);
    }
  }

  function updateCandidate(index: number, patch: Partial<Candidate>) {
    setCandidates(rows =>
      rows.map((r, i) => i === index ? { ...r, ...patch, edited: true } : r)
    );
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
          model_name: multimodalUsed
            ? "coco-ssd+tesseract+zxing+multimodal"
            : "coco-ssd+tesseract+zxing",
          inference_mode: multimodalUsed ? "server" : "browser",
          ocr_text: ocrText || null,
          barcodes,
          multimodal_used: multimodalUsed
        })
        .select("id")
        .single();

      if (scanError) throw scanError;
      scanId = scan.id;

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path =
        session.user.id + "/" +
        state.householdId + "/" +
        scanId + "/" +
        Date.now() + "-" +
        safeName;

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
            bbox: { boxes: c.bboxes, note: c.note ?? null },
            evidence_type: c.evidenceType,
            status: accepted ? (changed ? "edited" : "confirmed") : "rejected"
          };
        });

        const { error: candidateError } = await supabase
          .from("hfw_scan_candidates")
          .insert(rows);
        if (candidateError) throw candidateError;
      }

      const { error: applyError } = await supabase.rpc("hfw_apply_scan", {
        p_scan_id: scanId,
        p_fill_percent: fill
      });
      if (applyError) throw applyError;

      await onRefresh();

      let consequenceMessage = "";
      try {
        const consequenceResponse = await fetch("/api/scan-consequence", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + session.access_token
          },
          body: JSON.stringify({ scanId })
        });
        const consequence = await consequenceResponse.json();

        if (consequence?.sent) {
          consequenceMessage = consequence.eventType === "coverage_recovered"
            ? " · cobertura recuperada y email enviado ✓"
            : " · consecuencia importante: email enviado ✓";
        } else if (!consequenceResponse.ok) {
          consequenceMessage = " · stock actualizado; email pendiente de revisión";
        }
      } catch {
        consequenceMessage = " · stock actualizado; email pendiente de revisión";
      }

      flash("Scan aplicado: meals y reporting recalculados ✓" + consequenceMessage);
      setFile(null);
      setCandidates([]);
      setFill(50);
      setOcrText("");
      setBarcodes([]);
      setMultimodalUsed(false);
    } catch (e: any) {
      if (scanId) {
        await supabase
          .from("hfw_scan_sessions")
          .update({ status: "failed" })
          .eq("id", scanId);
      }
      flash(e?.message ?? "No se pudo guardar el scan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page">
      <div className="page-title">
        <div className="eyebrow">PHOTO SCAN · EVIDENCE STACK</div>
        <h2>Escanea tu cocina.</h2>
        <p>
          Objeto + barcode + OCR primero. El fallback multimodal queda reservado para
          detecciones difíciles. Tú confirmas antes de modificar inventario.
        </p>
      </div>

      <div className="scan-shell">
        <article className="scan-panel">
          <div className="eyebrow">1 · CAPTURE + FREE-FIRST</div>
          <h3>{currentLocation?.name ?? "Storage space"}</h3>

          <label className="field-wide">
            Storage space
            <select value={locationId} onChange={e => setLocationId(e.target.value)}>
              {state.locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>

          <div className="upload-zone">
            {preview ? (
              <img ref={imgRef} src={preview} alt="Vista previa del storage space" />
            ) : (
              <div>
                <strong>📷 Foto de refrigeradora, freezer u organizador</strong>
                <p className="scan-note">
                  Buena luz, foto frontal y etiquetas visibles ayudan a los tres detectores.
                </p>
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
            <>
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

                <button className="primary-action" onClick={analyzeObjects} disabled={analyzing}>
                  {analyzing ? "Detectando…" : "✦ Objetos"}
                </button>

                <button className="soft-action" onClick={analyzeBarcodes} disabled={barcodeBusy}>
                  {barcodeBusy ? "Leyendo…" : "▥ Barcode"}
                </button>

                <button className="soft-action" onClick={analyzeOcr} disabled={ocrBusy}>
                  {ocrBusy
                    ? "OCR " + Math.round(ocrProgress * 100) + "%"
                    : "Aa OCR"}
                </button>
              </div>

              <div className="evidence-strip">
                <span className={candidates.some(c => c.evidenceType === "object") ? "done" : ""}>Objetos</span>
                <span className={barcodes.length ? "done" : ""}>Barcode {barcodes.length ? "· " + barcodes.length : ""}</span>
                <span className={ocrText ? "done" : ""}>OCR {ocrText ? "✓" : ""}</span>
                <span className={multimodalUsed ? "done" : ""}>Multimodal {multimodalUsed ? "✓" : ""}</span>
              </div>
            </>
          )}

          {!!ocrText && (
            <div className="ocr-preview">
              <small>OCR visible</small>
              <p>{ocrText.slice(0, 360)}</p>
            </div>
          )}

          {!!barcodes.length && (
            <div className="ocr-preview">
              <small>Barcodes</small>
              <p>{barcodes.join(" · ")}</p>
            </div>
          )}

          <div className="fill-control">
            <span>Ocupación visual del espacio</span>
            <strong>{fill}%</strong>
            <input
              type="range"
              min="0"
              max="100"
              value={fill}
              onChange={e => setFill(Number(e.target.value))}
            />
          </div>
          <p className="scan-note">
            Es una señal visual de continuidad, no una medición volumétrica exacta.
          </p>
        </article>

        <article className="scan-panel">
          <div className="eyebrow">2 · REVIEW + ESCALATE ONLY IF NEEDED</div>
          <h3>Confirmación humana <span className="beta-pill">HITL</span></h3>

          {!candidates.length && (
            <div className="scan-empty">
              Ejecuta objetos, barcode u OCR. Solo candidatos confirmados modificarán el stock.
            </div>
          )}

          <div className="candidate-list">
            {candidates.map((c, index) => (
              <div
                className={"candidate-row " + (!c.accepted ? "rejected" : "")}
                key={c.label + ":" + index}
              >
                <input
                  type="checkbox"
                  checked={c.accepted}
                  onChange={e => updateCandidate(index, { accepted: e.target.checked })}
                />

                <div className="candidate-label">
                  <strong>{visionLabelEs[c.label] ?? c.label.replace(/^(ocr|barcode|multimodal):/, "")}</strong>
                  <small>
                    {c.evidenceType} · sugerido × {c.count}
                    {c.note ? " · " + c.note : ""}
                  </small>
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
                  {state.items.map(i => (
                    <option key={i.id} value={i.id}>{i.emoji} {i.name}</option>
                  ))}
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

          {(candidates.some(c => !c.productId || c.confidence < 0.55) || !candidates.length) && (
            <div className="fallback-card">
              <div>
                <strong>¿Quedan detecciones difíciles?</strong>
                <small>
                  {fallbackConfigured
                    ? "Usa multimodal solo ahora; evita pagar por scans fáciles."
                    : "Infraestructura lista. Requiere OPENAI_API_KEY para activarla."}
                </small>
              </div>
              <button
                onClick={analyzeFallback}
                disabled={fallbackBusy || !fallbackConfigured || !preview}
              >
                {fallbackBusy ? "Resolviendo…" : "Resolver difíciles"}
              </button>
            </div>
          )}

          {candidates.some(c => !c.productId) && (
            <p className="scan-note">
              ¿Falta un alimento?{" "}
              <button className="manage-link" onClick={onManageKitchen}>
                Créalo en Personal Kitchen
              </button>.
            </p>
          )}

          <div className="scan-actions">
            <button
              className="primary-action"
              onClick={applyScan}
              disabled={saving || !file}
            >
              {saving ? "Aplicando…" : "✓ Confirmar → actualizar → evaluar cobertura"}
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
