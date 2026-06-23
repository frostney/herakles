const posixHomePath = /\/(?:Users|home)\/[^/\s:;,)\]]+(?:\/[^\s:;,)\]]*)*/g;
const windowsHomePath = /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s:;,)\]]+(?:[\\/]+[^\\/\s:;,)\]]*)*/g;

export function displayPath(path: string): string {
  return path
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
    .replace(/^[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+(?=[\\/]|$)/, "~")
    .replaceAll("\\", "/");
}

export function displayTextWithHomePaths(text: string): string {
  return text
    .replace(posixHomePath, (path) => displayPath(path))
    .replace(windowsHomePath, (path) => displayPath(path));
}
