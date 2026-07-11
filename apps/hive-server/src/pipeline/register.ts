import { registerHandler, sweepPendingExtractions, sweepPendingImplications } from "./queue.js";
import { runExtraction } from "./extract.js";
import { runConclude } from "./conclude.js";
import { runImplications } from "./implications.js";

// Wire pipeline stage handlers.
export function registerPipeline(): void {
  registerHandler("extract", (j) => runExtraction((j as { memberId: string; sessionId: string }).memberId, (j as { sessionId: string }).sessionId));
  registerHandler("conclude", (j) => runConclude((j as { memberId: string }).memberId));
  registerHandler("implications", (j) =>
    runImplications((j as { memberId: string; memoryIds: string[] }).memberId, (j as { memoryIds: string[] }).memoryIds),
  );
  sweepPendingExtractions(); // recover any turns left unextracted by a prior crash
  sweepPendingImplications(); // recover any memories whose implications pass was lost to a crash
}
