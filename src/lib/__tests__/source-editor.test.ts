import { describe, it, expect } from "vitest";
import {
  generateElementSource,
  insertElement,
  editElement,
  deleteElement,
} from "../source-editor";
import type { SysmlElement, SysmlModel, Category, SourceSpan } from "../element-types";

// ─── Helpers ───

function makeSpan(
  startLine: number,
  endLine: number,
  startCol = 0,
  endCol = 0,
): SourceSpan {
  return {
    start_line: startLine,
    start_col: startCol,
    end_line: endLine,
    end_col: endCol,
    start_byte: 0,
    end_byte: 0,
  };
}

function makeElement(overrides: Partial<SysmlElement> & { id: number; kind: string; span: SourceSpan }): SysmlElement {
  return {
    name: null,
    qualified_name: "",
    category: "structure" as Category,
    parent_id: null,
    children_ids: [],
    type_ref: null,
    specializations: [],
    modifiers: [],
    multiplicity: null,
    doc: null,
    short_name: null,
    ...overrides,
    kind: overrides.kind as any,
  };
}

function makeModel(elements: SysmlElement[]): SysmlModel {
  return {
    file_path: null,
    elements,
    errors: [],
    stats: {
      total_elements: elements.length,
      definitions: 0,
      usages: 0,
      relationships: 0,
      errors: 0,
      parse_time_ms: 0,
    },
  };
}

// ─── generateElementSource ───

describe("generateElementSource", () => {
  it("generates a simple definition with braces", () => {
    const result = generateElementSource({
      kind: "part_def",
      name: "Vehicle",
    });
    expect(result).toBe("part def Vehicle {\n}");
  });

  it("generates a definition with a doc comment", () => {
    const result = generateElementSource({
      kind: "part_def",
      name: "Engine",
      doc: "The engine component",
    });
    expect(result).toBe("part def Engine {\n  doc /* The engine component */\n}");
  });

  it("generates a definition with children", () => {
    const result = generateElementSource({
      kind: "part_def",
      name: "Vehicle",
      children: ["part engine : Engine;", "part wheels : Wheel;"],
    });
    expect(result).toBe(
      "part def Vehicle {\n  part engine : Engine;\n  part wheels : Wheel;\n}"
    );
  });

  it("generates a definition with doc and children", () => {
    const result = generateElementSource({
      kind: "requirement_def",
      name: "SafeStop",
      doc: "Safety requirement",
      children: ["subject vehicle : Vehicle;"],
    });
    expect(result).toBe(
      "requirement def SafeStop {\n  doc /* Safety requirement */\n  subject vehicle : Vehicle;\n}"
    );
  });

  it("generates a package definition", () => {
    const result = generateElementSource({
      kind: "package",
      name: "VehicleModel",
    });
    // package is treated as isDefinition (it ends check or === 'package')
    expect(result).toBe("package VehicleModel {\n}");
  });

  it("generates a usage with a type reference", () => {
    const result = generateElementSource({
      kind: "part_usage",
      name: "engine",
      typeRef: "Engine",
    });
    expect(result).toBe("part engine : Engine;");
  });

  it("generates a usage without a type reference", () => {
    const result = generateElementSource({
      kind: "attribute_usage",
      name: "weight",
    });
    expect(result).toBe("attribute weight;");
  });

  it("generates a port usage with type ref", () => {
    const result = generateElementSource({
      kind: "port_usage",
      name: "fuelIn",
      typeRef: "FuelPort",
    });
    expect(result).toBe("port fuelIn : FuelPort;");
  });

  it("generates a satisfy statement", () => {
    const result = generateElementSource({
      kind: "satisfy_statement",
      name: "SafeStop",
    });
    expect(result).toBe("satisfy SafeStop;");
  });

  it("generates a verify statement", () => {
    const result = generateElementSource({
      kind: "verify_statement",
      name: "BrakeTest",
    });
    expect(result).toBe("verify BrakeTest;");
  });

  it("generates an enumeration definition", () => {
    const result = generateElementSource({
      kind: "enumeration_def",
      name: "Color",
      children: ["enum member red;", "enum member blue;"],
    });
    expect(result).toBe(
      "enum def Color {\n  enum member red;\n  enum member blue;\n}"
    );
  });

  it("falls back to replacing underscores for unknown kinds", () => {
    const result = generateElementSource({
      kind: "some_unknown_kind",
      name: "Foo",
    });
    // Not a definition or usage, falls to generic fallback
    expect(result).toBe("some unknown kind Foo;");
  });

  it("handles generic fallback with type ref", () => {
    const result = generateElementSource({
      kind: "some_unknown_kind",
      name: "Foo",
      typeRef: "Bar",
    });
    expect(result).toBe("some unknown kind Foo : Bar;");
  });

  // ─── Specialization (:>) ───

  it("generates a definition with specialization", () => {
    const result = generateElementSource({
      kind: "part_def",
      name: "SportsCar",
      specializes: "Car",
    });
    expect(result).toBe("part def SportsCar :> Car {\n}");
  });

  it("generates a definition with specialization, doc, and children", () => {
    const result = generateElementSource({
      kind: "part_def",
      name: "SportsCar",
      specializes: "Car",
      doc: "A fast car",
      children: ["attribute topSpeed : Real;"],
    });
    expect(result).toBe(
      "part def SportsCar :> Car {\n  doc /* A fast car */\n  attribute topSpeed : Real;\n}"
    );
  });

  // ─── Multiplicity ───

  it("generates a usage with type ref and multiplicity", () => {
    const result = generateElementSource({
      kind: "part_usage",
      name: "wheels",
      typeRef: "Wheel",
      multiplicity: "4",
    });
    expect(result).toBe("part wheels : Wheel[4];");
  });

  it("generates a usage with multiplicity but no type ref", () => {
    const result = generateElementSource({
      kind: "attribute_usage",
      name: "values",
      multiplicity: "0..*",
    });
    expect(result).toBe("attribute values [0..*];");
  });

  it("generates a usage with type ref and range multiplicity", () => {
    const result = generateElementSource({
      kind: "part_usage",
      name: "passengers",
      typeRef: "Person",
      multiplicity: "1..5",
    });
    expect(result).toBe("part passengers : Person[1..5];");
  });

  // ─── Transition ───

  it("generates a transition statement with source and target", () => {
    const result = generateElementSource({
      kind: "transition_statement",
      name: "idle",
      typeRef: "running",
    });
    expect(result).toBe("transition first idle then running;");
  });

  it("generates a transition statement with source only", () => {
    const result = generateElementSource({
      kind: "transition_statement",
      name: "idle",
    });
    expect(result).toBe("transition idle;");
  });

  // ─── Flow usage ───

  it("generates a flow usage with all fields", () => {
    const result = generateElementSource({
      kind: "flow_usage",
      name: "fuelFlow",
      flowItemType: "Fuel",
      flowSource: "tank.fuelOut",
      flowTarget: "engine.fuelIn",
    });
    expect(result).toBe("flow fuelFlow of Fuel from tank.fuelOut to engine.fuelIn;");
  });

  it("generates a flow usage with item type only", () => {
    const result = generateElementSource({
      kind: "flow_usage",
      name: "dataFlow",
      flowItemType: "Signal",
    });
    expect(result).toBe("flow dataFlow of Signal;");
  });

  it("generates a flow usage with name only", () => {
    const result = generateElementSource({
      kind: "flow_usage",
      name: "myFlow",
    });
    expect(result).toBe("flow myFlow;");
  });

  // ─── Connect statement ───

  it("generates a connect statement with source and target", () => {
    const result = generateElementSource({
      kind: "connect_statement",
      name: "engine.torqueOut",
      typeRef: "transmission.torqueIn",
    });
    expect(result).toBe("connect engine.torqueOut to transmission.torqueIn;");
  });

  // ─── Short Name / Alias ───

  it("generates a definition with short name", () => {
    const result = generateElementSource({
      kind: "part_def",
      name: "Vehicle",
      shortName: "V001",
    });
    expect(result).toBe("part def Vehicle <V001> {\n}");
  });

  it("generates a definition with short name and specialization", () => {
    const result = generateElementSource({
      kind: "part_def",
      name: "SportsCar",
      shortName: "SC-100",
      specializes: "Car",
    });
    expect(result).toBe("part def SportsCar <SC-100> :> Car {\n}");
  });

  it("generates a usage with short name and type ref", () => {
    const result = generateElementSource({
      kind: "part_usage",
      name: "engine",
      shortName: "ENG-01",
      typeRef: "Engine",
    });
    expect(result).toBe("part engine <ENG-01> : Engine;");
  });

  it("generates a usage with short name and multiplicity", () => {
    const result = generateElementSource({
      kind: "part_usage",
      name: "wheels",
      shortName: "WHL",
      typeRef: "Wheel",
      multiplicity: "4",
    });
    expect(result).toBe("part wheels <WHL> : Wheel[4];");
  });
});

// ─── insertElement ───

describe("insertElement", () => {
  it("inserts into a parent that has braces (before closing brace)", () => {
    const source = [
      "package VehicleModel {",
      "  part def Vehicle {",
      "  }",
      "}",
    ].join("\n");

    const parentEl = makeElement({
      id: 1,
      kind: "part_def",
      name: "Vehicle",
      span: makeSpan(1, 2),
    });

    const model = makeModel([parentEl]);
    const newSrc = "attribute weight;";

    const result = insertElement(source, newSrc, parentEl, model);
    const lines = result.split("\n");

    // The new element should appear before the closing brace of Vehicle
    // Indent is parent indent ("  ") + "  " = 4 spaces since no existing children
    expect(lines).toContain("    attribute weight;");
    // The closing brace should still exist after the new element
    expect(lines.indexOf("  }")).toBeGreaterThan(lines.indexOf("    attribute weight;"));
  });

  it("inserts into a parent that has existing children (uses child indent)", () => {
    const source = [
      "part def Vehicle {",
      "    part engine : Engine;",
      "}",
    ].join("\n");

    const parentEl = makeElement({
      id: 0,
      kind: "part_def",
      name: "Vehicle",
      span: makeSpan(0, 2),
    });

    const model = makeModel([parentEl]);
    const newSrc = "part wheels : Wheel;";

    const result = insertElement(source, newSrc, parentEl, model);
    const lines = result.split("\n");

    // Should use the same indent as the existing child (4 spaces)
    expect(lines).toContain("    part wheels : Wheel;");
  });

  it("converts semicolon-terminated parent to block with child", () => {
    const source = [
      "package VehicleModel {",
      "  part engine : Engine;",
      "}",
    ].join("\n");

    const parentEl = makeElement({
      id: 1,
      kind: "part_usage",
      name: "engine",
      type_ref: "Engine",
      span: makeSpan(1, 1),
    });

    const model = makeModel([parentEl]);
    const newSrc = "attribute displacement : Real;";

    const result = insertElement(source, newSrc, parentEl, model);
    const lines = result.split("\n");

    // The semicolon should be replaced with `{`
    expect(lines[1]).toBe("  part engine : Engine {");
    // The child should be indented further
    expect(lines[2]).toBe("    attribute displacement : Real;");
    // Should have a closing brace at the parent's indent
    expect(lines[3]).toBe("  }");
  });

  it("appends before last top-level brace when no parent given", () => {
    const source = [
      "package VehicleModel {",
      "  part def Vehicle {",
      "  }",
      "}",
    ].join("\n");

    const model = makeModel([]);
    const newSrc = "part def Engine {\n}";

    const result = insertElement(source, newSrc, null, model);
    const lines = result.split("\n");

    // Should insert before the last `}` with 2-space indent
    const lastBrace = lines.lastIndexOf("}");
    expect(lines[lastBrace - 1]).toBe("  }");
    expect(lines[lastBrace - 2]).toBe("  part def Engine {");
  });

  it("appends at end when no parent and no closing braces found", () => {
    const source = "// empty file";

    const model = makeModel([]);
    const newSrc = "part def Engine {\n}";

    const result = insertElement(source, newSrc, null, model);
    const lines = result.split("\n");

    // Should append with a blank line
    expect(lines[0]).toBe("// empty file");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("part def Engine {");
    expect(lines[3]).toBe("}");
  });

  it("inserts multi-line element source into parent", () => {
    const source = [
      "package Model {",
      "}",
    ].join("\n");

    const parentEl = makeElement({
      id: 0,
      kind: "package",
      name: "Model",
      span: makeSpan(0, 1),
    });

    const model = makeModel([parentEl]);
    const newSrc = "part def Vehicle {\n  part engine : Engine;\n}";

    const result = insertElement(source, newSrc, parentEl, model);
    const lines = result.split("\n");

    // All lines of the new element should be indented at child level
    expect(lines[1]).toBe("  part def Vehicle {");
    expect(lines[2]).toBe("    part engine : Engine;");
    expect(lines[3]).toBe("  }");
    expect(lines[4]).toBe("}");
  });
});

// ─── editElement ───

describe("editElement", () => {
  it("changes the element name", () => {
    const source = "part def Vehicle {\n}";
    const el = makeElement({
      id: 0,
      kind: "part_def",
      name: "Vehicle",
      span: makeSpan(0, 1),
    });

    const result = editElement(source, el, { name: "Car" });
    expect(result.startsWith("part def Car {")).toBe(true);
  });

  it("does not change name when new name equals old name", () => {
    const source = "part def Vehicle {\n}";
    const el = makeElement({
      id: 0,
      kind: "part_def",
      name: "Vehicle",
      span: makeSpan(0, 1),
    });

    const result = editElement(source, el, { name: "Vehicle" });
    expect(result).toBe(source);
  });

  it("changes an existing type reference", () => {
    const source = "part engine : Engine;";
    const el = makeElement({
      id: 0,
      kind: "part_usage",
      name: "engine",
      type_ref: "Engine",
      span: makeSpan(0, 0),
    });

    const result = editElement(source, el, { typeRef: "V8Engine" });
    expect(result).toBe("part engine : V8Engine;");
  });

  it("adds a type reference where there was none (semicolon-terminated)", () => {
    const source = "part engine;";
    const el = makeElement({
      id: 0,
      kind: "part_usage",
      name: "engine",
      type_ref: null,
      span: makeSpan(0, 0),
    });

    const result = editElement(source, el, { typeRef: "Engine" });
    expect(result).toBe("part engine : Engine;");
  });

  it("adds a type reference where there was none (brace-terminated)", () => {
    const source = "part def Vehicle {";
    const el = makeElement({
      id: 0,
      kind: "part_def",
      name: "Vehicle",
      type_ref: null,
      span: makeSpan(0, 0),
    });

    const result = editElement(source, el, { typeRef: "Transport" });
    expect(result).toBe("part def Vehicle : Transport {");
  });

  it("changes an existing doc comment", () => {
    const source = [
      "part def Vehicle {",
      "  doc /* A vehicle */",
      "}",
    ].join("\n");

    const el = makeElement({
      id: 0,
      kind: "part_def",
      name: "Vehicle",
      span: makeSpan(0, 2),
    });

    const result = editElement(source, el, { doc: "An automobile" });
    const lines = result.split("\n");
    expect(lines[1]).toBe("  doc /* An automobile */");
  });

  it("removes a doc comment when doc is empty string", () => {
    const source = [
      "part def Vehicle {",
      "  doc /* A vehicle */",
      "  part engine : Engine;",
      "}",
    ].join("\n");

    const el = makeElement({
      id: 0,
      kind: "part_def",
      name: "Vehicle",
      span: makeSpan(0, 3),
    });

    const result = editElement(source, el, { doc: "" });
    const lines = result.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[1]).toBe("  part engine : Engine;");
  });

  it("adds a doc comment to a definition that has none", () => {
    const source = [
      "part def Vehicle {",
      "  part engine : Engine;",
      "}",
    ].join("\n");

    const el = makeElement({
      id: 0,
      kind: "part_def",
      name: "Vehicle",
      span: makeSpan(0, 2),
    });

    const result = editElement(source, el, { doc: "Main vehicle" });
    const lines = result.split("\n");
    expect(lines[1]).toBe("  doc /* Main vehicle */");
    expect(lines[2]).toBe("  part engine : Engine;");
  });

  it("returns source unchanged when start_line is out of range", () => {
    const source = "part def Vehicle {\n}";
    const el = makeElement({
      id: 0,
      kind: "part_def",
      name: "Vehicle",
      span: makeSpan(100, 100),
    });

    const result = editElement(source, el, { name: "Car" });
    expect(result).toBe(source);
  });

  it("changes both name and type ref simultaneously", () => {
    const source = "part engine : Engine;";
    const el = makeElement({
      id: 0,
      kind: "part_usage",
      name: "engine",
      type_ref: "Engine",
      span: makeSpan(0, 0),
    });

    const result = editElement(source, el, { name: "motor", typeRef: "V8Engine" });
    expect(result).toBe("part motor : V8Engine;");
  });
});

// ─── deleteElement ───

describe("deleteElement", () => {
  it("deletes a single-line element", () => {
    const source = [
      "package VehicleModel {",
      "  part engine : Engine;",
      "  part wheels : Wheel;",
      "}",
    ].join("\n");

    const el = makeElement({
      id: 1,
      kind: "part_usage",
      name: "engine",
      span: makeSpan(1, 1),
    });

    const result = deleteElement(source, el);
    const lines = result.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe("package VehicleModel {");
    expect(lines[1]).toBe("  part wheels : Wheel;");
    expect(lines[2]).toBe("}");
  });

  it("deletes a multi-line definition with braces", () => {
    const source = [
      "package VehicleModel {",
      "  part def Vehicle {",
      "    part engine : Engine;",
      "  }",
      "  part def Engine {",
      "  }",
      "}",
    ].join("\n");

    const el = makeElement({
      id: 1,
      kind: "part_def",
      name: "Vehicle",
      span: makeSpan(1, 3),
    });

    const result = deleteElement(source, el);
    const lines = result.split("\n");
    // Vehicle and its 3 lines (1,2,3) should be gone
    expect(lines).toContain("  part def Engine {");
    expect(lines).not.toContain("  part def Vehicle {");
    expect(lines).not.toContain("    part engine : Engine;");
  });

  it("cleans up consecutive blank lines after deletion", () => {
    const source = [
      "package Model {",
      "",
      "  part engine : Engine;",
      "",
      "  part wheels : Wheel;",
      "}",
    ].join("\n");

    const el = makeElement({
      id: 1,
      kind: "part_usage",
      name: "engine",
      span: makeSpan(2, 2),
    });

    const result = deleteElement(source, el);
    const lines = result.split("\n");
    // After deleting line 2, lines[1] and lines[2] would both be blank
    // The cleanup should remove one of them
    let consecutiveBlanks = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].trim() === "" && lines[i + 1].trim() === "") {
        consecutiveBlanks++;
      }
    }
    expect(consecutiveBlanks).toBe(0);
  });

  it("deletes the last element in a block", () => {
    const source = [
      "package Model {",
      "  part engine : Engine;",
      "}",
    ].join("\n");

    const el = makeElement({
      id: 1,
      kind: "part_usage",
      name: "engine",
      span: makeSpan(1, 1),
    });

    const result = deleteElement(source, el);
    const lines = result.split("\n");
    expect(lines[0]).toBe("package Model {");
    expect(lines[1]).toBe("}");
  });

  it("deletes a definition and finds its closing brace", () => {
    const source = [
      "part def Engine {",
      "  attribute displacement : Real;",
      "  attribute horsepower : Real;",
      "}",
    ].join("\n");

    const el = makeElement({
      id: 0,
      kind: "part_def",
      name: "Engine",
      // Even if end_line is just 0, the function should find the closing brace
      span: makeSpan(0, 0),
    });

    const result = deleteElement(source, el);
    // All lines should be removed
    expect(result.trim()).toBe("");
  });

  it("handles deletion when element is at the very start of the file", () => {
    const source = [
      "part engine : Engine;",
      "part wheels : Wheel;",
    ].join("\n");

    const el = makeElement({
      id: 0,
      kind: "part_usage",
      name: "engine",
      span: makeSpan(0, 0),
    });

    const result = deleteElement(source, el);
    expect(result).toBe("part wheels : Wheel;");
  });

  it("handles deletion when element is at the very end of the file", () => {
    const source = [
      "part engine : Engine;",
      "part wheels : Wheel;",
    ].join("\n");

    const el = makeElement({
      id: 1,
      kind: "part_usage",
      name: "wheels",
      span: makeSpan(1, 1),
    });

    const result = deleteElement(source, el);
    expect(result).toBe("part engine : Engine;");
  });
});
