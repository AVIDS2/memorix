export function mergePlugins(defaults, requested) {
  return [...defaults, ...requested];
}
