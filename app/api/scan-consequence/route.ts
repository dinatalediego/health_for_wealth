import { NextRequest, NextResponse } from "next/server";
import {
  assertMembership,
  authenticateRequestToken,
  consequenceDecision,
  evaluateKitchen,
  kitchenEmailHtml,
  latestStateSnapshot,
  logNotification,
  recordStateSnapshot,
  sendResendEmail,
  serviceClient
} from "@/lib/server/kitchen";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const { user, error: authError } = await authenticateRequestToken(token);
    if (!user) return NextResponse.json({ error: authError ?? "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const scanId = String(body.scanId ?? "");
    if (!scanId) return NextResponse.json({ error: "scan_id_required" }, { status: 400 });

    const supabase = serviceClient();
    const { data: scan, error: scanError } = await supabase
      .from("hfw_scan_sessions")
      .select("id,household_id,status")
      .eq("id", scanId)
      .maybeSingle();

    if (scanError || !scan) return NextResponse.json({ error: "scan_not_found" }, { status: 404 });
    await assertMembership(user.id, scan.household_id);

    const previous = await latestStateSnapshot(scan.household_id);
    const evaluation = await evaluateKitchen(scan.household_id);

    const { data: pref } = await supabase
      .from("hfw_notification_preferences")
      .select("email,coverage_threshold,digest_enabled")
      .eq("household_id", scan.household_id)
      .maybeSingle();

    const threshold = Number(pref?.coverage_threshold ?? 3);
    const decision = consequenceDecision(evaluation, previous, threshold);

    await recordStateSnapshot(scan.household_id, evaluation, "scan", scanId);

    if (!decision.shouldSend) {
      return NextResponse.json({
        ok: true,
        sent: false,
        reason: decision.reason,
        coverage: evaluation.coverage,
        previousCoverage: decision.previousCoverage
      });
    }

    const dedupeKey = "scan:" + scanId + ":" + decision.type;
    const { data: existing } = await supabase
      .from("hfw_notification_events")
      .select("status,provider_message_id")
      .eq("household_id", scan.household_id)
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();

    if (existing?.status === "sent") {
      return NextResponse.json({
        ok: true,
        sent: false,
        duplicate: true,
        reason: decision.reason,
        coverage: evaluation.coverage,
        previousCoverage: decision.previousCoverage
      });
    }

    if (!pref?.digest_enabled || !pref?.email) {
      await logNotification({
        householdId: scan.household_id,
        userId: user.id,
        type: decision.type,
        dedupeKey,
        status: "skipped",
        coverage: evaluation.coverage,
        previousCoverage: decision.previousCoverage,
        reason: decision.reason,
        metadata: { scanId, cause: "notifications_disabled_or_email_missing" }
      });
      return NextResponse.json({
        ok: true,
        sent: false,
        skipped: true,
        reason: decision.reason,
        coverage: evaluation.coverage
      });
    }

    try {
      const email = await sendResendEmail({
        to: pref.email,
        subject: decision.type === "coverage_recovered"
          ? "Kitchen Readiness · cobertura recuperada"
          : "Kitchen Readiness · " + evaluation.coverage + " días cubiertos",
        html: kitchenEmailHtml({
          evaluation,
          previousCoverage: decision.previousCoverage,
          reason: decision.reason,
          recovered: decision.type === "coverage_recovered"
        })
      });

      await logNotification({
        householdId: scan.household_id,
        userId: user.id,
        type: decision.type,
        dedupeKey,
        status: "sent",
        coverage: evaluation.coverage,
        previousCoverage: decision.previousCoverage,
        reason: decision.reason,
        providerMessageId: email?.id ?? null,
        metadata: { scanId }
      });

      return NextResponse.json({
        ok: true,
        sent: true,
        eventType: decision.type,
        reason: decision.reason,
        coverage: evaluation.coverage,
        previousCoverage: decision.previousCoverage
      });
    } catch (emailError: any) {
      await logNotification({
        householdId: scan.household_id,
        userId: user.id,
        type: decision.type,
        dedupeKey,
        status: "failed",
        coverage: evaluation.coverage,
        previousCoverage: decision.previousCoverage,
        reason: decision.reason,
        errorMessage: emailError?.message ?? "email_failed",
        metadata: { scanId }
      });

      return NextResponse.json({
        ok: false,
        sent: false,
        error: emailError?.message ?? "email_failed",
        coverage: evaluation.coverage
      }, { status: 502 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "scan_consequence_failed" }, { status: 500 });
  }
}
