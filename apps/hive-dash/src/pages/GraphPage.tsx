import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import { AnimatePresence, motion } from "motion/react";
import { Search, X, Sparkles, GitBranch, Layers, Crosshair, Plus, Minus, Info, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useDashSocket } from "../useDashSocket.js";
import { NODE_COLORS, NODE_LABEL } from "../lib/palette.js";
import { cn } from "../lib/cn.js";
import { panel } from "../lib/motion.js";
import { Pill } from "../components/ui.js";

interface GNode {
  id: string;
  name: string;
  type: string;
  memberId: string | null;
  val: number;
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

export function GraphPage() {
  const [graph, setGraph] = useState<Graph>({ nodes: [], links: [] });
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [member, setMember] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showInvalidated, setShowInvalidated] = useState(true);
  const [query, setQuery] = useState("");
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

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-190);
    fg.d3Force("link")?.distance(58);
  }, [graph]);

  const data = useMemo(() => {
    const nodes = graph.nodes.filter((n) => !hidden.has(n.type));
    const keep = new Set(nodes.map((n) => n.id));
    const links = graph.links.filter((l) => keep.has(idOf(l.source)) && keep.has(idOf(l.target)));
    return { nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) };
  }, [graph, hidden]);

  // adjacency for hover highlight
  const adj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data.links) {
      const s = idOf(l.source), t = idOf(l.target);
      (m.get(s) ?? m.set(s, new Set()).get(s)!).add(t);
      (m.get(t) ?? m.set(t, new Set()).get(t)!).add(s);
    }
    return m;
  }, [data]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => new Set(q ? graph.nodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.id) : []),
    [q, graph.nodes],
  );

  const isDim = useCallback(
    (id: string) => {
      if (q) return !matches.has(id);
      if (hoverId) return id !== hoverId && !(adj.get(hoverId)?.has(id) ?? false);
      return false;
    },
    [q, matches, hoverId, adj],
  );

  async function onNode(node: GNode) {
    setSelected(node);
    setDetail(null);
    setDetail(await api(`/api/entities/${node.id}`).catch(() => null));
    const fg = fgRef.current;
    const n = node as any;
    if (fg && n.x != null) {
      const ratio = 1 + 90 / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
      fg.cameraPosition({ x: n.x * ratio, y: n.y * ratio, z: n.z * ratio }, n, 800);
    }
  }

  // dolly the camera toward/away from the scene centre
  const dolly = (factor: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const p = fg.camera().position;
    fg.cameraPosition({ x: p.x * factor, y: p.y * factor, z: p.z * factor }, undefined, 250);
  };

  async function forgetMemory(memoryId: string) {
    await api(`/api/memories/${memoryId}`, { method: "DELETE" }).catch(() => {});
    if (selected) setDetail(await api(`/api/entities/${selected.id}`).catch(() => null));
    load();
  }
  async function removeEntity(entityId: string) {
    await api(`/api/entities/${entityId}`, { method: "DELETE" }).catch(() => {});
    setSelected(null);
    load();
  }

  return (
    <div ref={wrapRef} className="relative h-full">
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
              <option key={m.id} value={m.id} className="bg-popover">
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-popover/80 px-2.5 py-2 shadow-lg backdrop-blur-md">
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
                className={cn("flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition", on ? "text-fg" : "text-faint opacity-50")}
              >
                <span className="size-2.5 rounded-full transition" style={{ background: NODE_COLORS[t], boxShadow: on ? `0 0 6px ${NODE_COLORS[t]}` : "none" }} />
                {NODE_LABEL[t]}
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-border" />
          <button onClick={() => setShowInvalidated((v) => !v)} className={cn("rounded-full px-2 py-1 text-[11px] font-medium transition", showInvalidated ? "text-fg" : "text-faint")}>
            past facts
          </button>
        </div>

        <div className="pointer-events-auto ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className={cn(
              "rounded-xl border border-border bg-popover/80 p-2 shadow-lg backdrop-blur-md transition",
              showHelp ? "text-honey" : "text-muted hover:text-fg",
            )}
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

      {/* zoom controls */}
      <div className="absolute bottom-5 right-5 z-10 flex flex-col overflow-hidden rounded-xl border border-border bg-popover/80 shadow-lg backdrop-blur-md">
        <button onClick={() => dolly(0.75)} className="p-2.5 text-muted transition hover:bg-fg/[0.06] hover:text-fg" title="Zoom in">
          <Plus size={15} />
        </button>
        <span className="mx-2 h-px bg-border" />
        <button onClick={() => dolly(1.35)} className="p-2.5 text-muted transition hover:bg-fg/[0.06] hover:text-fg" title="Zoom out">
          <Minus size={15} />
        </button>
        <span className="mx-2 h-px bg-border" />
        <button onClick={() => fgRef.current?.zoomToFit(600, 70)} className="p-2.5 text-muted transition hover:bg-fg/[0.06] hover:text-fg" title="Fit everything to view">
          <Crosshair size={15} />
        </button>
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
              <button onClick={() => setShowHelp(false)} className="text-faint hover:text-fg">
                <X size={14} />
              </button>
            </div>
            <ul className="space-y-2 text-[12px] text-muted">
              <li>
                <b className="text-fg">Dots are entities</b> — people, places, orgs, events, things, topics. Colour = type (see the top filter).
              </li>
              <li>
                <b className="text-fg">Bigger dots</b> know more people — size grows with connections.
              </li>
              <li>
                <b className="text-fg">Lines are relationships</b>, labelled with what they mean (lives in, works at, friends with…). Gold sparks flow along the ones that are currently true.
              </li>
              <li>
                <b className="text-fg">Faded lines</b> are past facts that changed (turn “past facts” off to hide them).
              </li>
              <li>
                <b className="text-fg">Hover</b> to focus a dot and its connections. <b className="text-fg">Click</b> to open its full profile.
              </li>
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
          backgroundColor="#100e0a"
          showNavInfo={false}
          nodeRelSize={5}
          nodeVal={(n: any) => n.val}
          onEngineStop={() => {
            if (!fitDone.current) {
              fitDone.current = true;
              fgRef.current?.zoomToFit(500, 70);
            }
          }}
          nodeThreeObject={(n: any) => {
            const dim = isDim(n.id);
            const focus = n.id === hoverId || n.id === selected?.id;
            const s = new SpriteText(n.name);
            s.color = dim ? "rgba(168,158,136,0.35)" : "#f7f3e9";
            s.textHeight = focus ? 4.4 : 3.4;
            s.fontFace = "Geist Variable, sans-serif";
            // readable chip behind the name so it stays legible over the 3D scene
            s.backgroundColor = dim ? "rgba(0,0,0,0)" : focus ? "rgba(244,184,60,0.16)" : "rgba(20,17,11,0.66)";
            s.padding = dim ? 0 : 1.8;
            s.borderRadius = 2.5;
            (s as any).material.depthWrite = false;
            s.position.y = -(2 + Math.sqrt(n.val) * 2.2);
            return s;
          }}
          nodeThreeObjectExtend
          linkThreeObjectExtend
          linkThreeObject={(l: any) => {
            const s = new SpriteText(String(l.rel).replace(/_/g, " "));
            s.color = l.invalidated ? "rgba(150,110,80,0.45)" : "rgba(214,194,150,0.6)";
            s.textHeight = 1.9;
            s.fontFace = "Geist Variable, sans-serif";
            (s as any).material.depthWrite = false;
            return s;
          }}
          linkPositionUpdate={(sprite: any, { start, end }: any) => {
            sprite.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
            return true;
          }}
          nodeColor={(n: any) =>
            isDim(n.id) ? "rgba(120,112,96,0.2)" : matches.has(n.id) ? "#ffffff" : NODE_COLORS[n.type] ?? "#8fb0ff"
          }
          nodeOpacity={0.95}
          onNodeHover={(n: any) => setHoverId(n?.id ?? null)}
          linkColor={(l: any) => {
            const hot = hoverId && (idOf(l.source) === hoverId || idOf(l.target) === hoverId);
            if (l.invalidated) return hot ? "rgba(229,97,90,0.5)" : "rgba(120,90,60,0.25)";
            return hot ? "rgba(244,184,60,0.7)" : "rgba(200,180,140,0.3)";
          }}
          linkWidth={(l: any) => {
            const hot = hoverId && (idOf(l.source) === hoverId || idOf(l.target) === hoverId);
            return l.invalidated ? 0.3 : hot ? 1.6 : 0.8;
          }}
          linkDirectionalParticles={(l: any) => {
            if (l.invalidated) return 0;
            const hot = hoverId && (idOf(l.source) === hoverId || idOf(l.target) === hoverId);
            return hot ? 4 : 2;
          }}
          linkDirectionalParticleWidth={(l: any) => {
            const hot = hoverId && (idOf(l.source) === hoverId || idOf(l.target) === hoverId);
            return hot ? 2.4 : 1.5;
          }}
          linkDirectionalParticleColor={() => "rgba(244,184,60,0.85)"}
          linkDirectionalArrowLength={2.5}
          linkDirectionalArrowRelPos={1}
          linkLabel={(l: any) => `${l.rel}${l.invalidated ? " (past)" : ""}`}
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
            className="absolute right-0 top-0 z-20 h-full w-[350px] overflow-y-auto border-l border-border bg-surface/95 p-5 backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: NODE_COLORS[selected.type] }} />
                <div>
                  <h2 className="text-[17px] font-semibold leading-tight text-fg">{selected.name}</h2>
                  <span className="text-[12px] capitalize text-muted">{selected.type}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-faint transition hover:text-fg">
                <X size={16} />
              </button>
            </div>

            <button
              onClick={() => removeEntity(selected.id)}
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
                      <span className="font-mono text-honey/90">{e.rel}</span>
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
                          onClick={() => forgetMemory(m.id)}
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
