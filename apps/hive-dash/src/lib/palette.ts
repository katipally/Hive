// Shared color maps used by the graph and the badges. Keep in sync with styles.css @theme.
export const NODE_COLORS: Record<string, string> = {
  person: "#f4b83c",
  place: "#57c8bf",
  org: "#c68bff",
  event: "#ff7a6b",
  thing: "#8fb0ff",
  topic: "#74d68a",
};

export const NODE_LABEL: Record<string, string> = {
  person: "People",
  place: "Places",
  org: "Orgs",
  event: "Events",
  thing: "Things",
  topic: "Topics",
};

export const DECISION_COLORS: Record<string, string> = {
  share: "#46c07a",
  partial: "#e3ac3e",
  withhold: "#e5615a",
};
