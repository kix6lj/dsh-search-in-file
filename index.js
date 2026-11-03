/**
 * Host half of dsh-search-in-file.
 *
 * The feature is entirely browser-side: it searches the rendered document
 * preview and changes-review diff and paints matches with the CSS Custom
 * Highlight API. This Host entry exists only so the profile loader carries
 * the package and its `dsh.client` half into the Web composition.
 */

export const name = 'dsh-search-in-file'

export function apply() {}
