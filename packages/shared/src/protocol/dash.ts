import type { ActivityEntry, Disclosure, Member, Nudge } from "../types.js";

// Hive -> Dashboard, broadcast only. Dashboard mutations go over HTTP.
export type HiveToDash =
  | { type: "graph.dirty" }
  | { type: "activity.append"; entry: ActivityEntry }
  | { type: "nudge.updated"; nudge: Nudge }
  | { type: "disclosure.created"; disclosure: Disclosure }
  | { type: "member.updated"; member: Member }
  | { type: "bee.presence"; beeId: string; online: boolean };
