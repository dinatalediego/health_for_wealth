# Personal Kitchen + Photo Scan Beta

## Closed visual loop

photo → on-device detection → human review → inventory update → meal capacity → reporting → restock

The Computer Vision layer is deliberately human-in-the-loop. A model prediction never changes stock until the user confirms it.

## Free-first inference

The beta uses TensorFlow.js + COCO-SSD in the browser. This gives a zero-per-image inference path for common objects such as fruit, bottles, bowls and some vegetables. It is a baseline, not a claim that generic object detection can identify every food item inside a refrigerator.

The valuable evidence loop is:

1. object proposed
2. mapped to the user's product catalog
3. confirmed / edited / rejected
4. correction stored
5. confirmed quantity applied to the selected storage space

## Digital Twin

Every storage space can keep its latest private photo, visual fill %, detected candidate count, confirmed count and current stock. Images live in private Supabase Storage bucket hfw-kitchen-scans with user-scoped object policies.

## Reporting

Vision reporting separates number of scans, model confidence, human acceptance rate and storage spaces with visual snapshots. Human acceptance is not labeled model accuracy because true accuracy requires explicit ground truth.

## Next upgrades

- barcode detection for packaged foods
- OCR for labels and expiry dates
- learned product aliases from accepted scans
- optional multimodal server fallback for low-confidence scans
- change detection between consecutive photos
- predicted depletion and recommended scan frequency
