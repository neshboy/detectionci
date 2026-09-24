/**
 * Sigma wildcard helpers.
 *
 * Sigma string values use `*` (any run of characters) and `?` (any single
 * character) as wildcards. This module converts those patterns into
 * anchored, case-insensitive RegExps, and is used both for plain field-value
 * matching and for matching selection *names* in `N of selection*`-style
 * condition aggregates.
 */

/** Escape all regex-special characters except the Sigma wildcards `*`/`?`. */
function escapeRegExpExceptWildcards(input: string): string {
  return input.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a Sigma-style wildcard pattern (`*`, `?`) into an anchored,
 * case-insensitive RegExp matching the whole string.
 */
export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = escapeRegExpExceptWildcards(pattern)
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/** True if `pattern` contains a Sigma wildcard character. */
export function hasWildcard(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}
