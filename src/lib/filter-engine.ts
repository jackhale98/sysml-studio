import type { SysmlElement, Category } from "./element-types";

export interface ClientFilter {
  categories: Category[];
  searchTerm: string;
  showDefinitions: boolean;
  showUsages: boolean;
  showRelationships: boolean;
}

export function createDefaultFilter(): ClientFilter {
  return {
    categories: [
      "structure", "behavior", "requirement", "interface",
      "property", "relationship", "constraint", "analysis", "view",
    ],
    searchTerm: "",
    showDefinitions: true,
    showUsages: true,
    showRelationships: true,
  };
}

export function isDefinition(kind: string): boolean {
  return kind.endsWith("_def") || kind === "package" || kind.endsWith("_definition");
}

export function isUsage(kind: string): boolean {
  return kind.endsWith("_usage") || kind.endsWith("_statement") ||
         kind === "enum_member" || kind === "end_feature";
}

export function filterElements(
  elements: SysmlElement[],
  filter: ClientFilter,
): SysmlElement[] {
  const term = filter.searchTerm.toLowerCase();

  return elements.filter((el) => {
    // Skip auxiliary elements like comments and imports by default unless explicitly shown
    if (el.category === "auxiliary" && !filter.categories.includes("auxiliary")) {
      return false;
    }

    // Category filter
    if (filter.categories.length > 0 && !filter.categories.includes(el.category)) {
      return false;
    }

    // Definition/Usage filter
    const kindStr = typeof el.kind === "string" ? el.kind : "";
    if (!filter.showDefinitions && isDefinition(kindStr)) return false;
    if (!filter.showUsages && isUsage(kindStr)) return false;
    if (!filter.showRelationships && el.category === "relationship") return false;

    // Search term filter
    if (term) {
      const matchesName = el.name?.toLowerCase().includes(term) ?? false;
      const matchesQName = el.qualified_name.toLowerCase().includes(term);
      const matchesType = el.type_ref?.toLowerCase().includes(term) ?? false;
      const matchesDoc = el.doc?.toLowerCase().includes(term) ?? false;
      const matchesKind = kindStr.toLowerCase().includes(term);
      if (!matchesName && !matchesQName && !matchesType && !matchesDoc && !matchesKind) {
        return false;
      }
    }

    return true;
  });
}
