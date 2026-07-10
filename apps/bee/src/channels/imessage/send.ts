import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Send via AppleScript through the Messages app. Requires Automation permission.
export async function sendIMessage(handle: string, text: string): Promise<void> {
  const script = `on run {targetHandle, msg}
    tell application "Messages"
      set targetService to 1st account whose service type = iMessage
      set targetBuddy to participant targetHandle of targetService
      send msg to targetBuddy
    end tell
  end run`;
  await run("osascript", ["-e", script, handle, text]);
}
