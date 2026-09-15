"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { KitchenState, Location } from "@/lib/types";

type Twin = { snapshot: any; imageUrl?: string };

export function DigitalTwin({
  state, cloud, onScanLocation
}: {
  state: KitchenState;
  cloud: boolean;
  onScanLocation: (id: string) => void;
}) {
  const [twins, setTwins] = useState<Record<string, Twin>>({});
  const supabase = getSupabase();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!cloud || !supabase || !state.householdId) {
        setTwins({});
        return;
      }

      const { data: snapshots } = await supabase
        .from("hfw_location_snapshots")
        .select("*")
        .eq("household_id", state.householdId)
        .order("created_at", { ascending: false })
        .limit(80);

      const latest = new Map<string, any>();
      for (const row of snapshots ?? []) {
        if (!latest.has(row.location_id)) latest.set(row.location_id, row);
      }

      const scanIds = [...latest.values()].map(x => x.scan_session_id).filter(Boolean);
      const imagesByScan = new Map<string, string>();

      if (scanIds.length) {
        const { data: images } = await supabase
          .from("hfw_scan_images")
          .select("scan_session_id,storage_path")
          .in("scan_session_id", scanIds);

        for (const image of images ?? []) {
          if (imagesByScan.has(image.scan_session_id)) continue;
          const { data } = await supabase.storage
            .from("hfw-kitchen-scans")
            .createSignedUrl(image.storage_path, 3600);
          if (data?.signedUrl) imagesByScan.set(image.scan_session_id, data.signedUrl);
        }
      }

      const next: Record<string, Twin> = {};
      latest.forEach((snapshot, locationId) => {
        next[locationId] = {
          snapshot,
          imageUrl: imagesByScan.get(snapshot.scan_session_id)
        };
      });

      if (!cancelled) setTwins(next);
    }

    load();
    return () => { cancelled = true; };
  }, [cloud, state.householdId, state.locations.length, supabase]);

  if (!cloud) return null;

  return (
    <div className="digital-twin-grid">
      {state.locations.map(location => (
        <TwinCard
          key={location.id}
          location={location}
          state={state}
          twin={twins[location.id]}
          onClick={() => onScanLocation(location.id)}
        />
      ))}
    </div>
  );
}

function TwinCard({
  location, state, twin, onClick
}: {
  location: Location;
  state: KitchenState;
  twin?: Twin;
  onClick: () => void;
}) {
  const items = state.items.filter(i => i.locationId === location.id);
  const stocked = items.filter(i => i.quantity > 0).length;
  const icons: Record<string, string> = {
    fridge: "❄️",
    freezer: "🧊",
    pantry: "🥫",
    organizer: "🧺",
    other: "📦"
  };
  const icon = icons[location.type] ?? "📦";
  const style = twin?.imageUrl ? { backgroundImage: "url(" + JSON.stringify(twin.imageUrl) + ")" } : undefined;
  const badge = twin?.snapshot ? String(twin.snapshot.fill_percent) + "% ocupado" : "Aún sin scan";
  const scanText = twin?.snapshot ? " · " + String(twin.snapshot.confirmed_item_count) + " confirmados en último scan" : "";

  return (
    <button className="twin-card" style={style} onClick={onClick}>
      <div className="twin-card-content">
        <span className="twin-badge">{icon} {badge}</span>
        <h3>{location.name}</h3>
        <p>{stocked}/{items.length} items con stock{scanText}</p>
      </div>
    </button>
  );
}
