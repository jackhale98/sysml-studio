/**
 * SysML v2 view evaluation — matches elements against expose/filter patterns.
 */
import type { SysmlElement, ViewData } from "./element-types";

/**
 * Match a qualified name against an expose pattern.
 * Supports `::*` (single-level wildcard) and `::**` (recursive wildcard).
 *
 *   matchExpose("A::B::C", "A::**")  → true  (recursive)
 *   matchExpose("A::B",    "A::*")   → true  (single-level)
 *   matchExpose("A::B::C", "A::*")   → false (too deep)
 *   matchExpose("A",       "A")      → true  (exact)
 */
export function matchExpose(qualifiedName: string, pattern: string): boolean {
  // Handle recursive wildcard ::**
  if (pattern.endsWith("::**")) {
    const prefix = pattern.slice(0, -4); // remove "::**"
    return qualifiedName.startsWith(prefix + "::") || qualifiedName === prefix;
  }
  // Handle single-level wildcard ::*
  if (pattern.endsWith("::*")) {
    const prefix = pattern.slice(0, -3); // remove "::*"
    if (!qualifiedName.startsWith(prefix + "::")) return false;
    const remainder = qualifiedName.slice(prefix.length + 2);
    return !remainder.includes("::"); // exactly one more segment
  }
  // Exact match
  return qualifiedName === pattern;
}

/** Map SysML v2 filter kind names (lowercased) to element kind strings. */
const KIND_FILTER_MAP: Record<string, string[]> = {
  partusage: ["part_usage"], partdef: ["part_def"],
  part: ["part_def", "part_usage"],
  portusage: ["port_usage"], portdef: ["port_def"],
  port: ["port_def", "port_usage"],
  attributeusage: ["attribute_usage"], attributedef: ["attribute_def"],
  attribute: ["attribute_def", "attribute_usage"],
  requirementusage: ["requirement_usage"], requirementdef: ["requirement_def"],
  requirement: ["requirement_def", "requirement_usage"],
  actionusage: ["action_usage"], actiondef: ["action_def"],
  action: ["action_def", "action_usage"],
  stateusage: ["state_usage"], statedef: ["state_def"],
  state: ["state_def", "state_usage"],
  constraintusage: ["constraint_usage"], constraintdef: ["constraint_def"],
  constraint: ["constraint_def", "constraint_usage"],
  itemusage: ["item_usage"], itemdef: ["item_def"],
  item: ["item_def", "item_usage"],
  connectionusage: ["connection_usage"], connectiondef: ["connection_def"],
  connection: ["connection_def", "connect_statement"],
  interfaceusage: ["interface_usage"], interfacedef: ["interface_def"],
  interface: ["interface_def", "interface_usage"],
  allocationusage: ["allocation_usage"], allocationdef: ["allocation_def"],
  allocation: ["allocation_def", "allocation_usage"],
  usecaseusage: ["use_case_usage"], usecasedef: ["use_case_def"],
  usecase: ["use_case_def", "use_case_usage"],
  enumerationdef: ["enumeration_def"],
  enumeration: ["enumeration_def"],
  calcdef: ["calc_def"],
  calc: ["calc_def"],
  viewdef: ["view_def"], viewusage: ["view_usage"],
  view: ["view_def", "view_usage"],
  flowusage: ["flow_usage"],
  flow: ["flow_usage", "flow_def"],
};

/**
 * Evaluate a view against a set of elements, returning the filtered subset.
 * If the view has no expose patterns, all elements are candidates.
 * If the view has no kind filters, all kinds pass.
 */
export function evaluateView(view: ViewData, elements: SysmlElement[]): SysmlElement[] {
  let result = elements;

  // Apply expose patterns
  if (view.exposes.length > 0) {
    result = result.filter(el =>
      el.qualified_name != null &&
      view.exposes.some(pattern => matchExpose(el.qualified_name, pattern))
    );
  }

  // Apply kind filters
  if (view.kind_filters.length > 0) {
    const allowedKinds = new Set<string>();
    for (const kf of view.kind_filters) {
      const key = kf.toLowerCase().replace(/_/g, "");
      const mapped = KIND_FILTER_MAP[key] ?? [kf];
      for (const k of mapped) allowedKinds.add(k);
    }
    result = result.filter(el => {
      const kindStr = typeof el.kind === "string" ? el.kind : "";
      return allowedKinds.has(kindStr);
    });
  }

  return result;
}

/**
 * Merge a view usage's data with its parent view def's data.
 * Usage exposes override (if present); kind filters are combined.
 */
export function mergeViewData(usage: ViewData, def: ViewData | null): ViewData {
  if (!def) return usage;
  return {
    name: usage.name,
    exposes: usage.exposes.length > 0 ? usage.exposes : def.exposes,
    kind_filters: [...def.kind_filters, ...usage.kind_filters],
    render_as: usage.render_as ?? def.render_as,
  };
}
