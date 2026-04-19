export function parseApiEntityPath(path: string): { collection: string; id: string } {
  const normalizedPath = path.replace(/^\/api\//, "").replace(/\/location$/, "");
  const [collection = "", id = ""] = normalizedPath.split("/");
  return { collection, id };
}
