export function sortByRecentId<T>(
  items: T[],
  recentId: string | null | undefined,
  getId: (item: T) => string,
  compare: (left: T, right: T) => number,
) {
  return items.slice().sort((left, right) => {
    const leftIsRecent = !!recentId && getId(left) === recentId;
    const rightIsRecent = !!recentId && getId(right) === recentId;

    if (leftIsRecent !== rightIsRecent) {
      return leftIsRecent ? -1 : 1;
    }

    return compare(left, right);
  });
}
