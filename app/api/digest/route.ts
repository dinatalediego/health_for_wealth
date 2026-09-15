import { NextRequest, NextResponse } from "next/server";
import {
  evaluateKitchen,
  kitchenEmailHtml,
  logNotification,
  recordStateSnapshot,
  sendResendEmail,
  serviceClient
} from "@/lib/server/kitchen";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_missing" }, { status: 503 });
  if (req.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = serviceClient();
  const { data: prefs, error } = await supabase
    .from("hfw_notification_preferences")
    .select("household_id,user_id,email,coverage_threshold,digest_enabled")
    .eq("digest_enabled", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const day = new Date().toISOString().slice(0, 10);

  for (const pref of prefs ?? []) {
    if (!pref.email) {
      skipped++;
      continue;
    }

    try {
      const evaluation = await evaluateKitchen(pref.household_id);
      await recordStateSnapshot(pref.household_id, evaluation, "digest", null);

      const threshold = Number(pref.coverage_threshold ?? 3);
      const needsAttention = evaluation.coverage <= threshold || evaluation.lowStockCount > 0;
      if (!needsAttention) {
        skipped++;
        continue;
      }

      const dedupeKey = "digest:" + day;
      const { data: existing } = await supabase
        .from("hfw_notification_events")
        .select("status")
        .eq("household_id", pref.household_id)
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();

      if (existing?.status === "sent") {
        skipped++;
        continue;
      }

      const reason = evaluation.coverage <= threshold
        ? "Cobertura en o por debajo del umbral de " + threshold + " días"
        : evaluation.lowStockCount + " productos están en o por debajo de su mínimo";

      const email = await sendResendEmail({
        to: pref.email,
        subject: "Kitchen Brief · " + evaluation.coverage + " días cubiertos",
        html: kitchenEmailHtml({
          evaluation,
          previousCoverage: null,
          reason,
          recovered: false
        })
      });

      await logNotification({
        householdId: pref.household_id,
        userId: pref.user_id,
        type: "daily_digest",
        dedupeKey,
        status: "sent",
        coverage: evaluation.coverage,
        reason,
        providerMessageId: email?.id ?? null,
        metadata: { threshold }
      });

      sent++;
    } catch (e: any) {
      failed++;
      try {
        await logNotification({
          householdId: pref.household_id,
          userId: pref.user_id,
          type: "daily_digest",
          dedupeKey: "digest:" + day,
          status: "failed",
          reason: "Daily Kitchen Brief",
          errorMessage: e?.message ?? "digest_failed"
        });
      } catch {}
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, failed });
}
