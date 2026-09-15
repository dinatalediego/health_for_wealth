import { createClient } from "@supabase/supabase-js";
import { coverageDays, mealCounts, restockSuggestions } from "@/lib/engine";
import type { Item, KitchenState, Meal } from "@/lib/types";

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment is not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function authenticateRequestToken(token: string | null) {
  if (!token) return { user: null, error: "missing_token" };
  const supabase = serviceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { user: null, error: error?.message ?? "invalid_token" };
  return { user: data.user, error: null };
}

export async function assertMembership(userId: string, householdId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("hfw_household_members")
    .select("household_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("not_authorized");
}

export type KitchenEvaluation = {
  coverage: number;
  counts: { breakfast: number; lunch: number; dinner: number; snack: number };
  lowStockCount: number;
  stockoutCount: number;
  lowItems: Array<Item & { suggested: number }>;
  state: KitchenState;
};

export async function evaluateKitchen(householdId: string): Promise<KitchenEvaluation> {
  const supabase = serviceClient();
  const [inv, meals, ingredients] = await Promise.all([
    supabase.from("hfw_inventory_state").select("*").eq("household_id", householdId),
    supabase.from("hfw_meal_templates").select("*").eq("household_id", householdId).eq("active", true),
    supabase.from("hfw_meal_ingredients").select("*").eq("household_id", householdId)
  ]);

  if (inv.error) throw inv.error;
  if (meals.error) throw meals.error;
  if (ingredients.error) throw ingredients.error;

  const items: Item[] = (inv.data ?? []).map((r: any) => ({
    id: r.product_id,
    householdId: r.household_id,
    name: r.name,
    emoji: r.emoji,
    category: r.category,
    unit: r.unit,
    quantity: Number(r.quantity),
    min: Number(r.min_stock),
    ideal: Number(r.ideal_stock),
    locationId: r.location_id,
    locationName: r.location_name,
    locationType: r.location_type,
    nextExpiry: r.next_expiry,
    isPerishable: r.is_perishable,
    barcode: r.barcode
  }));

  const mealList: Meal[] = (meals.data ?? []).map((m: any) => ({
    id: m.id,
    name: m.name,
    emoji: m.emoji,
    type: m.meal_type,
    prepMinutes: m.prep_minutes,
    ingredients: (ingredients.data ?? [])
      .filter((i: any) => i.meal_id === m.id)
      .map((i: any) => ({
        productId: i.product_id,
        quantity: Number(i.quantity_per_serving),
        unit: i.unit,
        optional: i.optional
      }))
  }));

  const state: KitchenState = {
    householdId,
    locations: [],
    items,
    meals: mealList,
    events: [],
    mealEvents: []
  };

  const counts = mealCounts(state);
  const coverage = coverageDays(state);
  const lowItems = restockSuggestions(state);

  return {
    coverage,
    counts,
    lowStockCount: items.filter(i => i.quantity <= i.min).length,
    stockoutCount: items.filter(i => i.quantity <= 0).length,
    lowItems,
    state
  };
}

export async function latestStateSnapshot(householdId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("hfw_kitchen_state_snapshots")
    .select("*")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function recordStateSnapshot(
  householdId: string,
  evaluation: KitchenEvaluation,
  triggerSource: "scan" | "digest" | "manual" | "purchase",
  sourceId?: string | null
) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("hfw_kitchen_state_snapshots")
    .insert({
      household_id: householdId,
      trigger_source: triggerSource,
      source_id: sourceId ?? null,
      coverage_days: evaluation.coverage,
      breakfast_count: evaluation.counts.breakfast,
      lunch_count: evaluation.counts.lunch,
      dinner_count: evaluation.counts.dinner,
      snack_count: evaluation.counts.snack,
      low_stock_count: evaluation.lowStockCount,
      stockout_count: evaluation.stockoutCount
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export function appUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return "https://" + prod.replace(/\/$/, "");
  return "https://healthforwealth.vercel.app";
}

export async function sendResendEmail(args: {
  to: string;
  subject: string;
  html: string;
}) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error("email_not_configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message ?? "resend_error_" + response.status);
  }
  return payload;
}

export async function logNotification(args: {
  householdId: string;
  userId?: string | null;
  type: "coverage_alert" | "coverage_recovered" | "daily_digest" | "test_email";
  dedupeKey: string;
  status: "pending" | "sent" | "failed" | "skipped";
  coverage?: number | null;
  previousCoverage?: number | null;
  reason?: string | null;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("hfw_notification_events")
    .upsert({
      household_id: args.householdId,
      user_id: args.userId ?? null,
      channel: "email",
      event_type: args.type,
      dedupe_key: args.dedupeKey,
      status: args.status,
      coverage_days: args.coverage ?? null,
      previous_coverage_days: args.previousCoverage ?? null,
      reason: args.reason ?? null,
      provider_message_id: args.providerMessageId ?? null,
      error_message: args.errorMessage ?? null,
      metadata: args.metadata ?? {},
      sent_at: args.status === "sent" ? new Date().toISOString() : null
    }, { onConflict: "household_id,dedupe_key" })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export function consequenceDecision(
  current: KitchenEvaluation,
  previous: any,
  threshold: number
) {
  const previousCoverage = previous ? Number(previous.coverage_days) : null;
  const zeroMealTypes = Object.entries(current.counts)
    .filter(([, value]) => value <= 0)
    .map(([key]) => key);

  if (zeroMealTypes.length) {
    return {
      type: "coverage_alert" as const,
      shouldSend: true,
      reason: "Sin cobertura para " + zeroMealTypes.join(", "),
      previousCoverage
    };
  }

  if (previousCoverage !== null && previousCoverage <= threshold && current.coverage > threshold) {
    return {
      type: "coverage_recovered" as const,
      shouldSend: true,
      reason: "Cobertura recuperada por encima del umbral",
      previousCoverage
    };
  }

  if (current.coverage <= threshold && (previousCoverage === null || previousCoverage > threshold)) {
    return {
      type: "coverage_alert" as const,
      shouldSend: true,
      reason: "Cobertura cayó al umbral crítico de " + threshold + " días",
      previousCoverage
    };
  }

  if (previousCoverage !== null && previousCoverage - current.coverage >= 2) {
    return {
      type: "coverage_alert" as const,
      shouldSend: true,
      reason: "La cobertura cayó " + (previousCoverage - current.coverage) + " días desde el último scan",
      previousCoverage
    };
  }

  if (previous && current.stockoutCount > Number(previous.stockout_count ?? 0)) {
    return {
      type: "coverage_alert" as const,
      shouldSend: true,
      reason: "Aumentaron los productos agotados",
      previousCoverage
    };
  }

  return {
    type: "coverage_alert" as const,
    shouldSend: false,
    reason: "Sin consecuencia material",
    previousCoverage
  };
}

export function kitchenEmailHtml(args: {
  evaluation: KitchenEvaluation;
  previousCoverage?: number | null;
  reason: string;
  recovered?: boolean;
}) {
  const { evaluation } = args;
  const url = appUrl();
  const restockRows = evaluation.lowItems.slice(0, 8)
    .map(i => "<li><strong>" + i.emoji + " " + i.name + "</strong>: comprar " + i.suggested + " " + i.unit + "</li>")
    .join("");

  const headline = args.recovered
    ? "Tu cocina volvió a estar preparada"
    : "Tu cobertura necesita atención";

  const delta = args.previousCoverage === null || args.previousCoverage === undefined
    ? ""
    : "<p style=\"color:#6f7c74\">Scan anterior: " + args.previousCoverage + " días → ahora: <strong>" + evaluation.coverage + "</strong></p>";

  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:auto;color:#173c2b;background:#f7f9f5;padding:28px;border-radius:24px">
    <p style="font-size:12px;letter-spacing:.14em;font-weight:800;color:#6f7c74">HEALTH FOR WEALTH · KITCHEN READINESS</p>
    <h1 style="margin:8px 0 4px">${headline}</h1>
    <p style="font-size:30px;margin:12px 0"><strong>${evaluation.coverage} días</strong> cubiertos</p>
    ${delta}
    <p><strong>Por qué recibes esto:</strong> ${args.reason}</p>
    <p>🥣 ${evaluation.counts.breakfast} desayunos · 🍲 ${evaluation.counts.lunch} almuerzos · 🌙 ${evaluation.counts.dinner} cenas · 🍎 ${evaluation.counts.snack} snacks</p>
    ${evaluation.lowItems.length ? "<h3>Compra mínima sugerida</h3><ul>" + restockRows + "</ul>" : "<p>✓ No hay items críticos por reponer.</p>"}
    <div style="margin-top:24px">
      <a href="${url}/#shopping" style="display:inline-block;background:#173c2b;color:white;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;margin-right:8px">Abrir Smart Restock</a>
      <a href="${url}/#scan" style="display:inline-block;background:#e8f2a7;color:#173c2b;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700">Nuevo scan</a>
    </div>
  </div>`;
}
