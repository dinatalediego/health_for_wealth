"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export function VisionReporting({ householdId, cloud }: { householdId?: string; cloud: boolean }) {
  const supabase = getSupabase();
  const [sessions, setSessions] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      if (!cloud || !supabase || !householdId) return;

      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: ss } = await supabase
        .from("hfw_scan_sessions")
        .select("id,status,location_id,created_at")
        .eq("household_id", householdId)
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      setSessions(ss ?? []);

      const ids = (ss ?? []).map((x: any) => x.id);
      if (ids.length) {
        const { data: cc } = await supabase
          .from("hfw_scan_candidates")
          .select("scan_session_id,status,confidence")
          .in("scan_session_id", ids);
        setCandidates(cc ?? []);
      } else {
        setCandidates([]);
      }

      const { data: sn } = await supabase
        .from("hfw_location_snapshots")
        .select("location_id,fill_percent,created_at")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false })
        .limit(80);
      setSnapshots(sn ?? []);
    }

    load();
  }, [cloud, householdId, supabase]);

  const stats = useMemo(() => {
    const reviewed = candidates.filter(c => ["confirmed", "edited", "rejected"].includes(c.status));
    const accepted = reviewed.filter(c => ["confirmed", "edited"].includes(c.status));
    const avgConfidence = candidates.length
      ? Math.round(candidates.reduce((s, c) => s + Number(c.confidence || 0), 0) / candidates.length * 100)
      : 0;
    const acceptance = reviewed.length ? Math.round(accepted.length / reviewed.length * 100) : 0;

    const latest = new Map<string, any>();
    for (const s of snapshots) {
      if (!latest.has(s.location_id)) latest.set(s.location_id, s);
    }

    return {
      scans: sessions.length,
      accepted: acceptance,
      confidence: avgConfidence,
      latest: [...latest.values()]
    };
  }, [sessions, candidates, snapshots]);

  if (!cloud) return null;

  return (
    <article className="chart-card">
      <div className="eyebrow">COMPUTER VISION · 30 DÍAS</div>
      <h3>Calidad y continuidad del Digital Twin</h3>

      <div className="vision-kpis">
        <div className="vision-kpi"><small>Scans</small><strong>{stats.scans}</strong><span>últimos 30 días</span></div>
        <div className="vision-kpi"><small>Aceptación humana</small><strong>{stats.accepted}%</strong><span>candidatos aceptados/editados</span></div>
        <div className="vision-kpi"><small>Confianza modelo</small><strong>{stats.confidence}%</strong><span>promedio de candidatos</span></div>
        <div className="vision-kpi"><small>Espacios con twin</small><strong>{stats.latest.length}</strong><span>con snapshot visual</span></div>
      </div>

      {!!stats.latest.length && (
        <div className="fill-bars" style={{ marginTop: 16 }}>
          {stats.latest.map((s: any) => (
            <div className="fill-bar-row" key={s.location_id}>
              <span>Storage</span>
              <div><i style={{ width: String(s.fill_percent) + "%" }} /></div>
              <strong>{s.fill_percent}%</strong>
            </div>
          ))}
        </div>
      )}

      <p className="scan-note">
        “Aceptación humana” es una métrica de revisión, no precisión científica del modelo.
      </p>
    </article>
  );
}
