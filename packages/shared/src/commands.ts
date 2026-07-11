// Single source of truth for the bee's slash commands. Drives the /help text, the web
// autocomplete dropdown, and Telegram's native command menu — so they can never drift
// apart (they used to: /help listed 6, the code implemented 9).

export interface SlashCommand {
  name: string; // canonical, no leading slash, e.g. "me" (may contain a space, e.g. "privacy set")
  aliases?: string[]; // alternate spellings, no slash
  args?: string; // arg hint shown after the name, e.g. "<message>"
  description: string; // one line, shown in help + autocomplete
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "login", args: "<code>", description: "Link this chat to your Hive account with your invite code" },
  { name: "logout", description: "Unlink this chat from your account" },
  { name: "me", description: "See what I remember about you" },
  { name: "shared", aliases: ["privacy"], description: "See what I've shared about you with others" },
  { name: "forget", description: "Forget the last thing you told me" },
  { name: "private", aliases: ["offrecord"], args: "<message>", description: "Talk off the record — I store nothing" },
  { name: "privacy set", args: "<rule>", description: "A standing rule before I share anything about you" },
  { name: "nopoll", aliases: ["optout"], description: "Leave me out when gathering the group's opinions" },
  { name: "pollme", aliases: ["optin"], description: "Rejoin group opinion gathering" },
  { name: "constitution", aliases: ["values", "why"], description: "Read the principles I operate by" },
  { name: "help", description: "List everything you can ask me" },
];

// The /help body the bee sends — generated from the registry so it can't go stale.
export function helpText(): string {
  return (
    "Things you can ask me:\n" +
    SLASH_COMMANDS.map((c) => `• /${c.name}${c.args ? " " + c.args : ""} — ${c.description}`).join("\n")
  );
}

// Match a typed prefix (with or without the leading slash) to commands, for autocomplete.
export function matchCommands(input: string): SlashCommand[] {
  const q = input.replace(/^\//, "").toLowerCase().trimStart();
  return SLASH_COMMANDS.filter(
    (c) => c.name.startsWith(q) || (c.aliases ?? []).some((a) => a.startsWith(q)),
  );
}
