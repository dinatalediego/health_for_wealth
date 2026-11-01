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
      return NextResponse.json({ configured: false, error: "meal_photo_not_configured" }, { status: 503 });
    }

    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const { user, error: authError } = await authenticateRequestToken(token);
    if (!user) return NextResponse.json({ error: authError ?? "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const householdId = String(body.householdId ?? "");
    const imageDataUrl = String(body.imageDataUrl ?? "");

    if (!householdId || !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "household_and_image_required" }, { status: 400 });
    }

    await assertMembership(user.id, householdId);

    const supabase = serviceClient();
    const { data: products, error } = await supabase
      .from("hfw_products")
      .select("id,name,default_unit,category")
      .eq("household_id", householdId)
      .eq("active", true)
      .order("name");

    if (error) throw error;

    const catalog = (products ?? []).map((p: any) => ({
      name: p.name,
      unit: p.default_unit,
      category: p.category
    }));

    const prompt = [
      "You are preparing a human-reviewed meal template for a household kitchen app.",
      "Inspect ONLY the plated meal in the supplied image. Ignore social-media UI, captions, watermarks, tableware and drinks unless they are clearly part of the meal itself.",
      "Propose a concise Spanish meal name, one emoji, meal type, prep minutes, and visible ingredients for ONE serving.",
      "When an ingredient clearly corresponds to the user's product catalog, matched_product_name MUST be the exact catalog name and quantity MUST use that catalog unit.",
      "When there is no reliable catalog match, set matched_product_name to an empty string and provide a suggested Spanish ingredient name and a practical unit (g, ml, unidad).",
      "Amounts are estimates for review, not facts. Be conservative and include a short note when uncertain.",
      "Do not invent sauces, oils, seasoning, hidden ingredients, brands, nutrition claims, calories, or health claims.",
      "Return 2 to 8 ingredients.",
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
            name: "meal_photo_draft",
            strict: true,
            schema: {
              type: "object",
              properties: {
                meal_name: { type: "string" },
                emoji: { type: "string" },
                meal_type: { type: "string", enum: ["breakfast","lunch","dinner","snack"] },
                prep_minutes: { type: "number" },
                ingredients: {
                  type: "array",
                  minItems: 2,
                  maxItems: 8,
                  items: {
                    type: "object",
                    properties: {
                      suggested_name: { type: "string" },
                      matched_product_name: { type: "string" },
                      quantity: { type: "number" },
                      unit: { type: "string" },
                      confidence: { type: "number" },
                      optional: { type: "boolean" },
                      note: { type: "string" }
                    },
                    required: ["suggested_name","matched_product_name","quantity","unit","confidence","optional","note"],
                    additionalProperties: false
                  }
                }
              },
              required: ["meal_name","emoji","meal_type","prep_minutes","ingredients"],
              additionalProperties: false
            }
          }
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({
        error: payload?.error?.message ?? "meal_photo_analysis_failed"
      }, { status: response.status });
    }

    const text = (payload?.output ?? [])
      .flatMap((item: any) => item?.content ?? [])
      .filter((part: any) => part?.type === "output_text")
      .map((part: any) => part?.text ?? "")
      .join("");

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "meal_photo_invalid_json" }, { status: 502 });
    }

    const byName = new Map((products ?? []).map((p: any) => [String(p.name).toLowerCase(), p]));
    const ingredients = (parsed.ingredients ?? []).slice(0, 8).map((row: any) => {
      const matched = byName.get(String(row.matched_product_name ?? "").toLowerCase());
      return {
        suggestedName: String(row.suggested_name ?? "Ingrediente"),
        productId: matched?.id ?? "",
        productName: matched?.name ?? "",
        quantity: Math.max(0, Number(row.quantity ?? 0)),
        unit: matched?.default_unit ?? String(row.unit ?? "g"),
        confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0))),
        optional: Boolean(row.optional),
        note: String(row.note ?? "")
      };
    });

    return NextResponse.json({
      configured: true,
      model: process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna",
      draft: {
        name: String(parsed.meal_name ?? "Meal desde foto").slice(0, 120),
        emoji: String(parsed.emoji ?? "🍽️").slice(0, 8),
        type: parsed.meal_type,
        prepMinutes: Math.max(0, Math.min(180, Math.round(Number(parsed.prep_minutes ?? 15)))),
        ingredients
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "meal_photo_analysis_failed" }, { status: 500 });
  }
}
