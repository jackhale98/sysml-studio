import { describe, it, expect } from "vitest";
import { filterElements, createDefaultFilter, type ClientFilter } from "../filter-engine";
import type { SysmlElement, Category } from "../element-types";

function makeEl(
  id: number,
  kind: string,
  name: string,
  category: Category,
  typeRef?: string,
): SysmlElement {
  return {
    id,
    kind: kind as any,
    name,
    qualified_name: name,
    category,
    parent_id: null,
    children_ids: [],
    span: { start_line: 0, start_col: 0, end_line: 0, end_col: 0, start_byte: 0, end_byte: 0 },
    type_ref: typeRef ?? null,
    specializations: [],
    modifiers: [],
    multiplicity: null,
    doc: null,
    short_name: null,
  };
}

describe("filterElements", () => {
  const elements: SysmlElement[] = [
    makeEl(0, "part_def", "Vehicle", "structure"),
    makeEl(1, "part_def", "Engine", "structure"),
    makeEl(2, "action_def", "Drive", "behavior"),
    makeEl(3, "requirement_def", "SafeStop", "requirement"),
    makeEl(4, "port_usage", "fuelIn", "interface", "FuelPort"),
    makeEl(5, "attribute_usage", "displacement", "property", "Real"),
  ];

  it("returns all elements with default filter", () => {
    const filter = createDefaultFilter();
    const result = filterElements(elements, filter);
    expect(result.length).toBe(elements.length);
  });

  it("filters by category", () => {
    const filter = createDefaultFilter();
    filter.categories = ["structure" as Category];
    const result = filterElements(elements, filter);
    expect(result.length).toBe(2);
    expect(result.every((e) => e.category === "structure")).toBe(true);
  });

  it("filters by search term on name", () => {
    const filter = createDefaultFilter();
    filter.searchTerm = "eng";
    const result = filterElements(elements, filter);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Engine");
  });

  it("filters by search term on type_ref", () => {
    const filter = createDefaultFilter();
    filter.searchTerm = "fuel";
    const result = filterElements(elements, filter);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("fuelIn");
  });

  it("returns empty when no matches", () => {
    const filter = createDefaultFilter();
    filter.searchTerm = "nonexistent";
    const result = filterElements(elements, filter);
    expect(result.length).toBe(0);
  });

  it("combines category and search filters", () => {
    const filter = createDefaultFilter();
    filter.categories = ["structure" as Category];
    filter.searchTerm = "vehicle";
    const result = filterElements(elements, filter);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Vehicle");
  });

  it("filters definitions only", () => {
    const filter = createDefaultFilter();
    filter.showUsages = false;
    const result = filterElements(elements, filter);
    expect(result.every(e => typeof e.kind === "string" && e.kind.endsWith("_def"))).toBe(true);
  });
});
