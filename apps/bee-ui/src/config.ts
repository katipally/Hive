// The bee runtime's HTTP API base. Defaults to "/api" (dev, via Vite proxy).
// In the hosted single-origin build it's set to "/bee-api" so it doesn't collide
// with the dashboard's own "/api" (which points at the hive server).
export const API_BASE: string = (import.meta.env as Record<string, string | undefined>).VITE_BEE_API ?? "/api";
