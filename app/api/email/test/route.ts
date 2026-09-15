import { NextRequest, NextResponse } from "next/server";
import {
  assertMembership,
  authenticateRequestToken,
  logNotification,
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
    const householdId = String(body.householdId ?? "");
    if (!householdId) return NextResponse.json({ error: "household_id_required" }, { status: 400 });

    await assertMembership(user.id, householdId);

    const supabase = serviceClient();
    const { data: pref } = await supabase
      .from("hfw_notification_preferences")
      .select("email")
      .eq("household_id", householdId)
      .maybeSingle();

    const to = pref?.email || user.email;
    if (!to) return NextResponse.json({ error: "email_missing" }, { status: 400 });

    const dedupeKey = "test:" + new Date().toISOString().slice(0, 13);

    try {
      const email = await sendResendEmail({
        to,
        subject: "Health for Wealth · email operativo",
        html: `
          <div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:auto;color:#173c2b">
            <p style="font-size:12px;letter-spacing:.14em;font-weight:800;color:#6f7c74">HEALTH FOR WEALTH</p>
            <h1>Kitchen Brief está conectado ✓</h1>
            <p>Resend, Vercel y Supabase pueden completar el loop de notificaciones.</p>
            <p>El siguiente correo automático solo llegará cuando exista una consecuencia importante: cobertura crítica, una caída material o recuperación del stock después de comprar.</p>
          </div>`
      });

      await logNotification({
        householdId,
        userId: user.id,
        type: "test_email",
        dedupeKey,
        status: "sent",
        providerMessageId: email?.id ?? null,
        reason: "Manual delivery test"
      });

      return NextResponse.json({ ok: true, sent: true, id: email?.id ?? null });
    } catch (error: any) {
      await logNotification({
        householdId,
        userId: user.id,
        type: "test_email",
        dedupeKey,
        status: "failed",
        errorMessage: error?.message ?? "email_failed",
        reason: "Manual delivery test"
      });
      return NextResponse.json({ ok: false, sent: false, error: error?.message ?? "email_failed" }, { status: 502 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "test_email_failed" }, { status: 500 });
  }
}
