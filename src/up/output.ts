import { truncateText } from "../utils/text";

const DETAIL_MAX_LENGTH = 160;
// Tailscale SSH in "check" mode holds the session open until someone approves this URL.
const TAILSCALE_CHECK_URL = /https:\/\/login\.tailscale\.com\/[A-Za-z0-9\-._~/?=&%]+/;

/** The approval URL of a Tailscale SSH check, when the command's output contains one. */
export function approvalNote(output: string): string {
  const url = TAILSCALE_CHECK_URL.exec(output)?.[0];
  return url ? ` (Tailscale SSH check, approve the login at ${url})` : "";
}

/**
 * The line that says why a git transfer failed. With `--progress` stderr is full of progress
 * lines and ssh may print notices first, so the last `fatal:` or `error:` line wins, then the
 * last line.
 */
export function failureDetail(stderr: string): string {
  const lines = stderr
    .split(/[\r\n]+/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line !== "");
  const reason = lines.findLast((line) => /^(fatal|error):/i.test(line)) ?? lines.at(-1) ?? "";
  return truncateText(reason, DETAIL_MAX_LENGTH);
}
