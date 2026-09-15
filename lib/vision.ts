import type { VisionGroup, VisionPrediction } from "./types";

let modelPromise: Promise<any> | null = null;

export async function detectKitchenObjects(image: HTMLImageElement): Promise<VisionPrediction[]> {
  const tf = await import("@tensorflow/tfjs");
  await tf.ready();
  const coco = await import("@tensorflow-models/coco-ssd");
  if (!modelPromise) modelPromise = coco.load({ base: "lite_mobilenet_v2" });
  const model = await modelPromise;
  const rows = await model.detect(image, 30, 0.25);
  return rows.map((r: any) => ({
    label: String(r.class ?? "").toLowerCase(),
    score: Number(r.score ?? 0),
    bbox: [
      Number(r.bbox?.[0] ?? 0),
      Number(r.bbox?.[1] ?? 0),
      Number(r.bbox?.[2] ?? 0),
      Number(r.bbox?.[3] ?? 0)
    ]
  }));
}

export function groupPredictions(rows: VisionPrediction[]): VisionGroup[] {
  const grouped = new Map<string, VisionPrediction[]>();
  for (const row of rows) {
    const current = grouped.get(row.label) ?? [];
    current.push(row);
    grouped.set(row.label, current);
  }
  return [...grouped.entries()]
    .map(([label, items]) => ({
      label,
      count: items.length,
      confidence: items.reduce((s, x) => s + x.score, 0) / items.length,
      bboxes: items.map(x => x.bbox)
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

export function estimateVisibleFill(rows: VisionPrediction[], width: number, height: number) {
  const total = Math.max(1, width * height);
  const occupied = rows.reduce((s, r) => s + Math.max(0, r.bbox[2]) * Math.max(0, r.bbox[3]), 0);
  return Math.max(10, Math.min(95, Math.round((occupied / total) * 135)));
}

export const visionLabelEs: Record<string, string> = {
  banana: "plátano",
  apple: "manzana",
  orange: "naranja",
  broccoli: "brócoli",
  carrot: "zanahoria",
  bottle: "botella",
  cup: "taza",
  bowl: "bowl",
  sandwich: "sándwich",
  pizza: "pizza",
  cake: "torta",
  donut: "dona",
  "wine glass": "copa",
  diningtable: "mesa"
};
