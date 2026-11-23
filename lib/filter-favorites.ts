export type FavoriteScope = "dashboard" | "student-report";
export type ShareAudience = "admin" | "all";
export type FilterFavorite = { id: string; name: string; value: unknown; revision: number; audience?: ShareAudience | "private" };
// Received favorites have a namespaced UI id. Neither this id nor sharedOwner is persisted.
export type ListedFavorite = FilterFavorite & { sharedOwner?: string };
export type FavoriteAction =
  | { type: "save"; id: string; name: string; value: unknown; audience?: ShareAudience }
  | { type: "update"; id: string; name: string; value: unknown; revision: number }
  | { type: "share"; id: string; revision: number; audience?: ShareAudience }
  | { type: "delete"; id: string; revision: number };

export type FavoriteStore = {
  subscribe: (uid: string, scope: FavoriteScope, next: (items: ListedFavorite[]) => void, failed: () => void, isAdmin: boolean) => () => void;
  write: (uid: string, scope: FavoriteScope, action: FavoriteAction) => Promise<void>;
};

export type FilterFavoritesProps<T> = {
  uid: string;
  isAdmin: boolean;
  scope: FavoriteScope;
  value: T;
  decode: (saved: unknown) => T | null;
  onApply: (config: T) => void;
  store?: FavoriteStore;
};

export const maxFavoriteNameLength = 80;
const maxFavorites = 50;

export function sharedAudience(value: unknown): ShareAudience | undefined {
  return value === "all" || value === "admin" ? value : undefined;
}

export function validFavoriteId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

export function favoriteLabels(items: readonly ListedFavorite[]): Map<string, string> {
  const sharedNames = new Set<string>(), repeated = new Set<string>();
  for (const { name, sharedOwner } of items) {
    if (!sharedOwner) continue;
    if (sharedNames.has(name)) repeated.add(name);
    sharedNames.add(name);
  }
  return new Map(items.map(({ id, name, sharedOwner }) => [id, !sharedOwner ? name
    : repeated.has(name) ? `${name} (shared by ${sharedOwner})` : `${name} (shared)`]));
}

export function validFavoriteItem(id: string, item: unknown): item is FilterFavorite {
  if (!item || typeof item !== "object") return false;
  const record = item as Partial<FilterFavorite>;
  return Object.keys(record).every((key) => ["id", "name", "value", "revision", "audience"].includes(key))
    && validFavoriteId(id) && record.id === id && typeof record.name === "string" && !!record.name.trim()
    && record.name.length <= maxFavoriteNameLength && typeof record.revision === "number" && Number.isSafeInteger(record.revision) && record.revision >= 1
    && ("value" in record) && (!("audience" in record) || record.audience === "private" || !!sharedAudience(record.audience));
}

// The public mirror may contain only chart selection fields, never rows, scores, or nested objects.
export function shareableFilters(scope: FavoriteScope, value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const stringList = (list: unknown, max: number): list is string[] => Array.isArray(list) && list.length <= max
    && list.every((s) => typeof s === "string" && s.length > 0 && s.length <= 256 && !/[\r\n]/.test(s));
  if (scope === "student-report") {
    return Object.keys(v).length === 3 && stringList(v.studentIds, 2000) && stringList(v.assessmentIds, 512) && stringList(v.years, 128);
  }
  const students = "studentIds" in v ? "studentIds" : "studentKey";
  const keys = ["assessmentId", "chartType", "fieldKeys", "homerooms", "sectionIds", students, "teamId", "roundId", "years"];
  return Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key))
    && (v.chartType === "comparison" || v.chartType === "progression" || v.chartType === "average")
    && [v.assessmentId, v.teamId, v.roundId].every((s) => typeof s === "string")
    && [v.fieldKeys, v.homerooms, v.sectionIds].every((list) => stringList(list, 512)) && (v.years === null || stringList(v.years, 128))
    && (students === "studentIds" ? stringList(v.studentIds, 2000) && !v.studentIds.includes("all") && new Set(v.studentIds).size === v.studentIds.length
      : typeof v.studentKey === "string");
}

export function readFavorites(document: unknown): FilterFavorite[] {
  if (document === undefined) return [];
  const { version, items: byId } = (document ?? {}) as Record<string, unknown>;
  if (version !== 1 || !byId || typeof byId !== "object" || Array.isArray(byId)) throw new Error("Saved favorites could not be read.");
  const entries = Object.entries(byId);
  const items = entries.map(([, item]) => item);
  if (items.length > maxFavorites || !entries.every(([id, record]) => validFavoriteItem(id, record))) throw new Error("Saved favorites could not be read.");
  return items;
}

export function favoriteDocument(items: FilterFavorite[], changedId: string) {
  return { version: 1, changedId, items: Object.fromEntries(items.map((item) => [item.id, item])) };
}

export function changeFavorites(current: FilterFavorite[], action: FavoriteAction): FilterFavorite[] {
  if (!validFavoriteId(action.id)) throw new Error("Invalid favorite ID.");
  const prior = current.find((item) => item.id === action.id);
  if (action.type !== "save" && !prior) throw new Error("This favorite no longer exists.");
  if (action.type !== "save" && prior?.revision !== action.revision) throw new Error("This favorite changed. Select it again before editing.");
  if (action.type === "delete") return current.filter((item) => item.id !== action.id);
  if (action.type === "share") {
    return current.map((item) => item.id !== action.id ? item : {
      id: item.id, name: item.name, value: item.value, revision: item.revision + 1,
      ...(action.audience ? { audience: action.audience } : {})
    });
  }
  const name = action.name.trim();
  if (!name || name.length > maxFavoriteNameLength) throw new Error(`Enter a name of 1 to ${maxFavoriteNameLength} characters.`);
  if (current.some((item) => item.id !== action.id && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A favorite with this name already exists.");
  }
  const audience = sharedAudience(action.type === "save" ? action.audience : prior?.audience);
  const item = { id: action.id, name, value: action.value, revision: (prior?.revision ?? 0) + 1, ...(audience ? { audience } : {}) };
  if (action.type === "update") return current.map((entry) => entry.id === action.id ? item : entry);
  if (prior) throw new Error("This favorite already exists.");
  if (current.length >= maxFavorites) throw new Error(`You can save up to ${maxFavorites} favorites here.`);
  return [...current, item];
}
