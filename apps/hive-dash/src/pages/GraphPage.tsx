import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import { Object3D } from "three";
import { AnimatePresence, motion } from "motion/react";
import { Search, X, Sparkles, GitBranch, Layers, Crosshair, Plus, Minus, Info, Trash2, Filter, RotateCcw } from "lucide-react";
import { api } from "../api.js";
import { useDashSocket } from "../useDashSocket.js";
import { NODE_COLORS, NODE_LABEL } from "../lib/palette.js";
import { cn } from "../lib/cn.js";
import { panel } from "../lib/motion.js";
import { Pill } from "../components/ui.js";
import { ConfirmDialog, useToast } from "@hive/ui";

interface GNode {
  id: string;
  name: string;
  type: string;
  memberId: string | null;
  val: number; // connection count (degree)
  group: string;
}
interface GLink {
  source: string | GNode;
  target: string | GNode;
  rel: string;
  confidence: number;
  invalidated: boolean;
  sourceMemoryId: string | null;
}
interface Graph {
  nodes: GNode[];
  links: GLink[];
}
interface MemberLite {
  id: string;
  name: string;
}

const TYPES = Object.keys(NODE_COLORS);
const idOf = (x: string | GNode) => (typeof x === "string" ? x : x.id);
const HUB_COUNT = 12; // always-label the N most-connected nodes so the graph is readable at rest

export function GraphPage() {
  const [graph, setGraph] = useState<Graph>({ nodes: [], links: [] });
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [member, setMember] = useState("");
  const [showInvalidated, setShowInvalidated] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [rel, setRel] = useState("");
  const [minDegree, setMinDegree] = useState(0);
  const [minConf, setMinConf] = useState(0);
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const fgRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const refetch = useRef<number | null>(null);
  const fitDone = useRef(false);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (member) q.set("member", member);
    if (showInvalidated) q.set("showInvalidated", "1");
    api<Graph>(`/api/graph?${q}`).then((g) => {
      fitDone.current = false;
      setGraph(g);
    }).catch(() => {});
  }, [member, showInvalidated]);

  useEffect(() => {
    api<MemberLite[]>("/api/members").then(setMembers).catch(() => {});
  }, []);
  useEffect(() => load(), [load]);

  useDashSocket((e) => {
    if (e.type === "graph.dirty") {
      if (refetch.current) window.clearTimeout(refetch.current);
      refetch.current = window.setTimeout(load, 900);
    }
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // calm, settling physics (not the jittery GPU kind)
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-140);
    fg.d3Force("link")?.distance(60);
  }, [graph]);

  const relTypes = useMemo(() => [...new Set(graph.links.map((l) => l.rel))].sort(), [graph.links]);

  const data = useMemo(() => {
    const nodes = graph.nodes.filter((n) => !hidden.has(n.type) && n.val >= minDegree);
    const keep = new Set(nodes.map((n) => n.id));
    const links = graph.links.filter(
      (l) => keep.has(idOf(l.source)) && keep.has(idOf(l.target)) && l.confidence >= minConf && (!rel || l.rel === rel),
    );
    return { nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) };
  }, [graph, hidden, minDegree, minConf, rel]);

  // adjacency for hover/selection highlight
  const adj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data.links) {
      const s = idOf(l.source), t = idOf(l.target);
      (m.get(s) ?? m.set(s, new Set()).get(s)!).add(t);
      (m.get(t) ?? m.set(t, new Set()).get(t)!).add(s);
    }
    return m;
  }, [data]);

  // the always-labelled hubs (most connected), so names are visible even before you interact
  const hubIds = useMemo(() => {
    return new Set([...data.nodes].sort((a, b) => b.val - a.val).slice(0, HUB_COUNT).map((n) => n.id));
  }, [data.nodes]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => new Set(q ? graph.nodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.id) : []),
    [q, graph.nodes],
  );

  const selId = selected?.id ?? null;
  // a node gets an in-scene name label if: it's a hub, it's selected, it neighbours the
  // selection, or it matches the search — everything else stays a clean dot (no mush).
  const labelled = useCallback(
    (id: string) => hubIds.has(id) || id === selId || (selId != null && (adj.get(selId)?.has(id) ?? false)) || matches.has(id),
    [hubIds, selId, adj, matches],
  );

  const isDim = useCallback(
    (id: string) => {
      if (q) return !matches.has(id);
      const focus = hoverId ?? selId;
      if (focus) return id !== focus && !(adj.get(focus)?.has(id) ?? false);
      return false;
    },
    [q, matches, hoverId, selId, adj],
  );

  // rebuild node/link scene objects when the selection changes (labels follow focus)
  useEffect(() => {
    fgRef.current?.refresh();
  }, [selId, hubIds, matches]);

  async function onNode(node: GNode) {
    setSelected(node);
    setDetail(null);
    setDetail(await api(`/api/entities/${node.id}`).catch(() => null));
    const fg = fgRef.current;
    const n = node as any;
    if (fg && n.x != null) {
      const ratio = 1 + 120 / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
      fg.cameraPosition({ x: n.x * ratio, y: n.y * ratio, z: n.z * ratio }, n, 900);
    }
  }

  const dolly = (factor: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const p = fg.camera().position;
    fg.cameraPosition({ x: p.x * factor, y: p.y * factor, z: p.z * factor }, undefined, 250);
  };

  const resetView = () => {
    setQuery("");
    setHidden(new Set());
    setRel("");
    setMinDegree(0);
    setMinConf(0);
    setSelected(null);
    setHoverId(null);
    fgRef.current?.zoomToFit(700, 80);
  };

  const toast = useToast();
  const [confirm, setConfirm] = useState<{ kind: "entity" | "memory"; id: string; label: string } | null>(null);

  async function forgetMemory(memoryId: string) {
    try {
      await api(`/api/memories/${memoryId}`, { method: "DELETE" });
      if (selected) setDetail(await api(`/api/entities/${selected.id}`).catch(() => null));
      load();
      toast("Fact forgotten");
    } catch {
      toast("Couldn't forget that fact", "error");
    }
  }
  async function removeEntity(entityId: string) {
    try {
      await api(`/api/entities/${entityId}`, { method: "DELETE" });
      setSelected(null);
      load();
      toast("Removed from the graph");
    } catch {
      toast("Couldn't remove that node", "error");
    }
  }

  const filtersActive = hidden.size > 0 || !!rel || minDegree > 0 || minConf > 0;

  return (
    <div ref={wrapRef} className="relative h-full overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
      {/* toolbar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start gap-3 p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-popover/80 px-3 py-2 shadow-lg backdrop-blur-md">
          <Search size={15} className="text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the graph…"
            className="w-40 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-faint hover:text-fg">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-popover/80 px-3 py-2 shadow-lg backdrop-blur-md">
          <Layers size={14} className="text-faint" />
          <select value={member} onChange={(e) => setMember(e.target.value)} className="bg-transparent text-[13px] text-fg outline-none">
            <option value="" className="bg-popover">All members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id} className="bg-popover">{m.name}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-xl border bg-popover/80 px-3 py-2 text-[13px] shadow-lg backdrop-blur-md transition",
            showFilters || filtersActive ? "border-accent/40 text-accent" : "border-border text-muted hover:text-fg",
          )}
        >
          <Filter size={14} /> Filters{filtersActive ? " ·" : ""}
        </button>

        <div className="pointer-events-auto ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className={cn("rounded-xl border border-border bg-popover/80 p-2 shadow-lg backdrop-blur-md transition", showHelp ? "text-accent" : "text-muted hover:text-fg")}
            title="What am I looking at?"
          >
            <Info size={15} />
          </button>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-popover/80 px-3 py-2 text-[12px] text-muted shadow-lg backdrop-blur-md">
            <GitBranch size={13} className="text-faint" />
            {data.nodes.length} nodes · {data.links.length} edges
          </div>
        </div>
      </div>

      {/* filters panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-auto absolute left-4 top-20 z-20 w-[280px] space-y-4 rounded-2xl border border-border bg-popover/95 p-4 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">Node types</div>
              <div className="flex flex-wrap gap-1.5">
                {TYPES.map((t) => {
                  const on = !hidden.has(t);
                  return (
                    <button
                      key={t}
                      onClick={() =>
                        setHidden((h) => {
                          const n = new Set(h);
                          n.has(t) ? n.delete(t) : n.add(t);
                          return n;
                        })
                      }
                      className={cn("flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-[11px] font-medium transition", on ? "text-fg" : "text-faint opacity-50")}
                    >
                      <span className="size-2.5 rounded-full" style={{ background: NODE_COLORS[t], boxShadow: on ? `0 0 6px ${NODE_COLORS[t]}` : "none" }} />
                      {NODE_LABEL[t]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">Relationship</div>
              <select value={rel} onChange={(e) => setRel(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-fg outline-none">
                <option value="">All relationships</option>
                {relTypes.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>

            <label className="block">
              <div className="mb-1 flex items-center justify-between text-[11px] text-faint">
                <span className="font-medium uppercase tracking-wider">Min connections</span>
                <span className="text-fg">{minDegree}</span>
              </div>
              <input type="range" min={0} max={10} value={minDegree} onChange={(e) => setMinDegree(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
            </label>

            <label className="block">
              <div className="mb-1 flex items-center justify-between text-[11px] text-faint">
                <span className="font-medium uppercase tracking-wider">Min confidence</span>
                <span className="text-fg">{minConf.toFixed(2)}</span>
              </div>
              <input type="range" min={0} max={1} step={0.05} value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
            </label>

            <div className="flex items-center justify-between border-t border-border pt-3">
              <button onClick={() => setShowInvalidated((v) => !v)} className={cn("rounded-full border border-border px-2.5 py-1 text-[11px] font-medium transition", showInvalidated ? "text-fg" : "text-faint")}>
                {showInvalidated ? "showing past facts" : "past facts hidden"}
              </button>
              <button onClick={resetView} className="flex items-center gap-1.5 text-[11px] text-muted transition hover:text-accent">
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* view controls */}
      <div className="absolute bottom-5 right-5 z-10 flex flex-col overflow-hidden rounded-xl border border-border bg-popover/80 shadow-lg backdrop-blur-md">
        <button onClick={() => dolly(0.75)} className="p-2.5 text-muted transition hover:bg-fg/[0.06] hover:text-fg" title="Zoom in"><Plus size={15} /></button>
        <span className="mx-2 h-px bg-border" />
        <button onClick={() => dolly(1.35)} className="p-2.5 text-muted transition hover:bg-fg/[0.06] hover:text-fg" title="Zoom out"><Minus size={15} /></button>
        <span className="mx-2 h-px bg-border" />
        <button onClick={() => fgRef.current?.zoomToFit(600, 70)} className="p-2.5 text-muted transition hover:bg-fg/[0.06] hover:text-fg" title="Fit everything to view"><Crosshair size={15} /></button>
        <span className="mx-2 h-px bg-border" />
        <button onClick={resetView} className="p-2.5 text-muted transition hover:bg-fg/[0.06] hover:text-accent" title="Reset view"><RotateCcw size={15} /></button>
      </div>

      {/* legend / help */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-5 left-5 z-10 w-[300px] rounded-2xl border border-border bg-popover/95 p-4 shadow-2xl backdrop-blur-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-fg">Reading the graph</span>
              <button onClick={() => setShowHelp(false)} className="text-faint hover:text-fg"><X size={14} /></button>
            </div>
            <ul className="space-y-2 text-[12px] text-muted">
              <li><b className="text-fg">Dots are entities</b> — colour = type, bigger = more connections.</li>
              <li><b className="text-fg">The busiest nodes are always named</b>; hover any dot to see its name.</li>
              <li><b className="text-fg">Click a dot</b> to focus it — its neighbours light up and every <b className="text-fg">relationship gets labelled</b> (lives in, works at…).</li>
              <li><b className="text-fg">Faded links</b> are past facts that changed. Drag to rotate, scroll to zoom.</li>
              <li><b className="text-fg">Reset</b> reframes everything and clears filters + selection.</li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {dims.w > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={data}
          backgroundColor="#1a1a1d"
          showNavInfo={false}
          nodeRelSize={5}
          nodeVal={(n: any) => n.val}
          nodeLabel={(n: any) => n.name}
          cooldownTime={4000}
          warmupTicks={40}
          enableNodeDrag={false}
          onEngineStop={() => {
            if (!fitDone.current) {
              fitDone.current = true;
              fgRef.current?.zoomToFit(600, 70);
            }
          }}
          nodeThreeObjectExtend
          nodeThreeObject={(n: any) => {
            if (!labelled(n.id)) return new Object3D(); // clean dot; hover shows the name tooltip
            const dim = isDim(n.id);
            const focus = n.id === hoverId || n.id === selId;
            const s = new SpriteText(n.name);
            s.color = dim ? "rgba(200,196,186,0.4)" : "#f7f3e9";
            s.textHeight = focus ? 5 : 3.6;
            s.fontFace = "Geist Variable, sans-serif";
            s.backgroundColor = dim ? "rgba(0,0,0,0)" : focus ? "rgba(91,157,255,0.2)" : "rgba(16,16,18,0.72)";
            s.padding = dim ? 0 : 2;
            s.borderRadius = 3;
            (s as any).material.depthWrite = false;
            s.position.y = -(3 + Math.sqrt(n.val) * 2.2);
            return s;
          }}
          linkThreeObjectExtend
          linkThreeObject={(l: any) => {
            // only label the focused node's relationships — that's how you "see relations" without mush
            const focus = selId ?? hoverId;
            if (!focus || (idOf(l.source) !== focus && idOf(l.target) !== focus)) return new Object3D();
            const s = new SpriteText(String(l.rel).replace(/_/g, " "));
            s.color = l.invalidated ? "rgba(150,110,80,0.6)" : "rgba(224,206,160,0.92)";
            s.textHeight = 2.4;
            s.fontFace = "Geist Variable, sans-serif";
            s.backgroundColor = "rgba(16,16,18,0.6)";
            s.padding = 1.2;
            s.borderRadius = 2;
            (s as any).material.depthWrite = false;
            return s;
          }}
          linkPositionUpdate={(sprite: any, { start, end }: any) => {
            if (sprite) sprite.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
            return false;
          }}
          nodeColor={(n: any) => (isDim(n.id) ? "rgba(120,112,96,0.25)" : matches.has(n.id) ? "#ffffff" : NODE_COLORS[n.type] ?? "#8fb0ff")}
          nodeOpacity={0.95}
          onNodeHover={(n: any) => setHoverId(n?.id ?? null)}
          linkColor={(l: any) => {
            const focus = hoverId ?? selId;
            const hot = focus && (idOf(l.source) === focus || idOf(l.target) === focus);
            if (l.invalidated) return hot ? "rgba(229,97,90,0.55)" : "rgba(120,90,60,0.22)";
            return hot ? "rgba(91,157,255,0.8)" : "rgba(160,170,190,0.26)";
          }}
          linkWidth={(l: any) => {
            const focus = hoverId ?? selId;
            const hot = focus && (idOf(l.source) === focus || idOf(l.target) === focus);
            return l.invalidated ? 0.3 : hot ? 1.8 : 0.7;
          }}
          linkDirectionalParticles={(l: any) => {
            if (l.invalidated) return 0;
            const focus = hoverId ?? selId;
            return focus && (idOf(l.source) === focus || idOf(l.target) === focus) ? 3 : 0;
          }}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleColor={() => "rgba(91,157,255,0.85)"}
          onNodeClick={onNode as any}
          onBackgroundClick={() => setSelected(null)}
        />
      )}

      {graph.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2 text-center">
            <Sparkles size={26} className="text-faint" />
            <div className="text-[15px] font-medium text-fg">The hive is still learning</div>
            <div className="max-w-xs text-[13px] text-muted">As members talk to their bees, people, places and relationships appear here.</div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {selected && (
          <motion.aside
            variants={panel}
            initial="hidden"
            animate="show"
            exit="exit"
            className="absolute bottom-3 right-3 top-3 z-20 w-[340px] overflow-y-auto rounded-2xl border border-border bg-elevated/95 p-5 shadow-[var(--shadow-pop)] backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: NODE_COLORS[selected.type] }} />
                <div>
                  <h2 className="text-[17px] font-semibold leading-tight text-fg">{selected.name}</h2>
                  <span className="text-[12px] capitalize text-muted">{selected.type}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-faint transition hover:text-fg"><X size={16} /></button>
            </div>

            <button
              onClick={() => setConfirm({ kind: "entity", id: selected.id, label: selected.name })}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-withhold/25 px-3 py-1.5 text-[12px] text-withhold/90 transition hover:bg-withhold/10"
            >
              <Trash2 size={13} /> Remove this from the graph
            </button>

            {detail === null ? (
              <div className="mt-6 space-y-2">
                <div className="skeleton h-16 rounded-xl" />
                <div className="skeleton h-16 rounded-xl" />
              </div>
            ) : (
              <>
                {detail?.entity?.attrs && Object.keys(detail.entity.attrs).length > 0 && (
                  <div className="mt-5 rounded-xl border border-border bg-card p-3 text-[13px]">
                    {Object.entries(detail.entity.attrs).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3 py-0.5">
                        <span className="text-faint">{k}</span>
                        <span className="text-fg">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <Section label="Relations" count={detail?.edges?.length ?? 0} />
                <div className="space-y-1.5">
                  {(detail?.edges ?? []).map((e: any) => (
                    <div key={e.id} className={cn("rounded-lg border border-border bg-card px-3 py-2 text-[13px]", e.invalidated_at && "opacity-45")}>
                      <span className="font-mono text-accent/90">{e.rel}</span>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                        <span>confidence {Number(e.confidence).toFixed(2)}</span>
                        {e.invalidated_at && <Pill tone="withhold">past</Pill>}
                      </div>
                    </div>
                  ))}
                  {(detail?.edges ?? []).length === 0 && <p className="text-[12px] text-faint">No relations yet.</p>}
                </div>

                <Section label="Source memories" count={detail?.memories?.length ?? 0} />
                <div className="space-y-1.5">
                  {(detail?.memories ?? []).map((m: any) => (
                    <div key={m.id} className="group/mem rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-fg/90">
                      <div className="flex items-start justify-between gap-2">
                        <span>{m.text}</span>
                        <button
                          onClick={() => setConfirm({ kind: "memory", id: m.id, label: "this fact" })}
                          className="shrink-0 text-faint opacity-0 transition hover:text-withhold group-hover/mem:opacity-100"
                          title="Forget this fact"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="mt-1 text-[11px] text-faint">salience {Number(m.salience).toFixed(2)}</div>
                    </div>
                  ))}
                  {(detail?.memories ?? []).length === 0 && <p className="text-[12px] text-faint">No source memories linked.</p>}
                </div>
              </>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "entity") removeEntity(confirm.id);
          else if (confirm?.kind === "memory") forgetMemory(confirm.id);
        }}
        title={confirm?.kind === "entity" ? "Remove from the graph?" : "Forget this fact?"}
        description={
          confirm?.kind === "entity"
            ? `“${confirm?.label}” and its relations will be deleted from the hive's memory. This can't be undone.`
            : "The hive will permanently forget this fact. This can't be undone."
        }
        confirmLabel={confirm?.kind === "entity" ? "Remove" : "Forget"}
      />
    </div>
  );
}

function Section({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2 mt-6 flex items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>
      <span className="rounded-full bg-fg/[0.06] px-1.5 text-[11px] text-muted">{count}</span>
    </div>
  );
}
