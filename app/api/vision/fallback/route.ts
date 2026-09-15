import { NextRequest, NextResponse } from "next/server";
import {
  assertMembership,
  authenticateRequestToken,
  serviceClient
} from "@/lib/server/kitchen";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna"
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ configured: false, error: "multimodal_fallback_not_configured" }, { status: 503 });
    }

    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const { user, error: authError } = await authenticateRequestToken(token);
    if (!user) return NextResponse.json({ error: authError ?? "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const householdId = String(body.householdId ?? "");
    const imageDataUrl = String(body.imageDataUrl ?? "");
    const unresolvedLabels = Array.isArray(body.unresolvedLabels) ? body.unresolvedLabels.slice(0, 20) : [];
    const ocrText = String(body.ocrText ?? "").slice(0, 2000);

    if (!householdId || !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "household_and_image_required" }, { status: 400 });
    }

    await assertMembership(user.id, householdId);

    const supabase = serviceClient();
    const { data: products, error } = await supabase
      .from("hfw_products")
      .select("id,name,default_unit,barcode")
      .eq("household_id", householdId)
      .eq("active", true)
      .order("name");

    if (error) throw error;

    const catalog = (products ?? []).map((p: any) => ({
      name: p.name,
      unit: p.default_unit,
      barcode: p.barcode ?? null
    }));

    const prompt = [
      "You are a kitchen inventory visual reviewer.",
      "Only resolve difficult or ambiguous food detections from the supplied kitchen photo.",
      "Choose product_name ONLY from the user's catalog below. If uncertain, omit it.",
      "Estimate visible count/quantity conservatively. Do not infer hidden food.",
      "Return at most 8 suggestions.",
      "Browser unresolved labels: " + JSON.stringify(unresolvedLabels),
      "OCR evidence: " + JSON.stringify(ocrText),
      "Catalog: " + JSON.stringify(catalog)
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna",
        reasoning: { effort: "low" },
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageDataUrl, detail: "low" }
          ]
        }],
        text: {
          format: {
            type: "json_schema",
            name: "kitchen_fallback",
            strict: true,
            schema: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      product_name: { type: "string" },
                      quantity: { type: "number" },
                      confidence: { type: "number" },
                      reason: { type: "string" }
                    },
                    required: ["product_name","quantity","confidence","reason"],
                    additionalProperties: false
                  }
                }
              },
              required: ["suggestions"],
              additionalProperties: false
            }
          }
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({
        error: payload?.error?.message ?? "openai_fallback_failed"
      }, { status: response.status });
    }

    const text = (payload?.output ?? [])
      .flatMap((item: any) => item?.content ?? [])
      .filter((part: any) => part?.type === "output_text")
      .map((part: any) => part?.text ?? "")
      .join("");

    let parsed: any = { suggestions: [] };
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "fallback_invalid_json" }, { status: 502 });
    }

    const byName = new Map((products ?? []).map((p: any) => [String(p.name).toLowerCase(), p]));
    const suggestions = (parsed.suggestions ?? [])
      .map((s: any) => {
        const product = byName.get(String(s.product_name ?? "").toLowerCase());
        if (!product) return null;
        return {
          productId: product.id,
          productName: product.name,
          unit: product.default_unit,
          quantity: Math.max(0, Number(s.quantity ?? 0)),
          confidence: Math.max(0, Math.min(1, Number(s.confidence ?? 0))),
          reason: String(s.reason ?? "")
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      configured: true,
      model: process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna",
      suggestions
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "multimodal_fallback_failed" }, { status: 500 });
  }
}
