import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!secret || !url || !serviceKey || !resendKey || !from) {
    return NextResponse.json({ error: "digest_not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: prefs, error } = await supabase
    .from("hfw_notification_preferences")
    .select("household_id,email,coverage_threshold,digest_enabled")
    .eq("digest_enabled", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const pref of prefs ?? []) {
    if (!pref.email) continue;

    const [{ data: items }, { data: meals }] = await Promise.all([
      supabase.from("hfw_inventory_state").select("*").eq("household_id", pref.household_id),
      supabase.from("hfw_meal_availability").select("*").eq("household_id", pref.household_id)
    ]);

    const byType: Record<string, number> = { breakfast:0,lunch:0,dinner:0,snack:0 };
    (meals ?? []).forEach((m:any) => {
      byType[m.meal_type] = Math.max(byType[m.meal_type] ?? 0, Number(m.servings_available ?? 0));
    });
    const coverage = Math.min(byType.breakfast,byType.lunch,byType.dinner,byType.snack);
    const low = (items ?? []).filter((i:any)=>Number(i.quantity)<=Number(i.min_stock));

    // Send the daily digest when there is something useful to act on.
    if (coverage > Number(pref.coverage_threshold ?? 3) && low.length === 0) continue;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#173c2b">
        <h1>Kitchen Readiness</h1>
        <p style="font-size:24px"><strong>${coverage} días</strong> de cobertura conservadora</p>
        <p>🥣 ${byType.breakfast} desayunos · 🍲 ${byType.lunch} almuerzos · 🌙 ${byType.dinner} cenas · 🍎 ${byType.snack} snacks</p>
        <h3>${low.length ? "Necesita atención" : "Tu cocina está preparada"}</h3>
        <ul>${low.slice(0,8).map((i:any)=>`<li>${i.emoji} ${i.name}: ${i.quantity} ${i.unit} → ideal ${i.ideal_stock}</li>`).join("")}</ul>
      </div>`;

    const response = await fetch("https://api.resend.com/emails", {
      method:"POST",
      headers:{ "Authorization":`Bearer ${resendKey}`,"Content-Type":"application/json" },
      body:JSON.stringify({from,to:[pref.email],subject:`Kitchen Brief · ${coverage} días cubiertos`,html})
    });
    if (response.ok) sent++;
  }
  return NextResponse.json({ ok:true, sent });
}
