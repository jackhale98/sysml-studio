import { describe, it, expect } from "vitest";
import {
  generateElementSource,
} from "../source-editor";
import type { SysmlElement, SysmlModel, Category, SourceSpan } from "../element-types";

// ─── Helpers ───

/**
 * Spans are 1-based (sysml-core's `Span::from_node` convention). The
 * test call sites historically passed 0-based rows; the +1 here keeps
 * them meaning "the same source line" under the correct convention.
 */
function makeSpan(
  startLine: number,
  endLine: number,
  startCol = 0,
  endCol = 0,
): SourceSpan {
  return {
    start_line: startLine + 1,
    start_col: startCol,
    end_line: endLine + 1,
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
    value_expr: null,
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
    views: [],
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

  // ─── Conjugated port ───

  it("generates a conjugated port usage", () => {
    const result = generateElementSource({
      kind: "port_usage",
      name: "fuelIn",
      typeRef: "FuelPort",
      isConjugated: true,
    });
    expect(result).toBe("~port fuelIn : FuelPort;");
  });

  // ─── Transition guard and effect ───

  it("generates a transition with guard", () => {
    const result = generateElementSource({
      kind: "transition_statement",
      name: "idle",
      typeRef: "running",
      transitionGuard: "speed > 60",
    });
    expect(result).toBe("transition first idle if speed > 60 then running;");
  });

  it("generates a transition with effect", () => {
    const result = generateElementSource({
      kind: "transition_statement",
      name: "idle",
      typeRef: "running",
      transitionEffect: "logEvent",
    });
    expect(result).toBe("transition first idle do logEvent then running;");
  });

  it("generates a transition with guard and effect", () => {
    const result = generateElementSource({
      kind: "transition_statement",
      name: "S1",
      typeRef: "S2",
      transitionGuard: "temp > 100",
      transitionEffect: "alarm",
    });
    expect(result).toBe("transition first S1 if temp > 100 do alarm then S2;");
  });

  // ─── State entry/do/exit actions ───

  it("generates a state def with entry, do, and exit actions", () => {
    const result = generateElementSource({
      kind: "state_def",
      name: "Running",
      stateEntryAction: "initialize()",
      stateDoAction: "monitor()",
      stateExitAction: "cleanup()",
    });
    expect(result).toBe(
      "state def Running {\n  entry action { initialize() }\n  do action { monitor() }\n  exit action { cleanup() }\n}"
    );
  });

  // ─── Redefines and subsets ───

  it("generates a usage with redefines", () => {
    const result = generateElementSource({
      kind: "part_usage",
      name: "x",
      typeRef: "Type",
      redefines: "y",
    });
    expect(result).toBe("part x : Type :>> y;");
  });

  it("generates a usage with subsets", () => {
    const result = generateElementSource({
      kind: "part_usage",
      name: "x",
      typeRef: "Type",
      subsetsFeature: "y",
    });
    expect(result).toBe("part x : Type :> y;");
  });

  // ─── Action def with parameters ───

  it("generates an action def with parameters", () => {
    const result = generateElementSource({
      kind: "action_def",
      name: "Drive",
      calcParams: [
        { name: "speed", type: "Real", direction: "in" },
        { name: "distance", type: "Real", direction: "out" },
      ],
    });
    expect(result).toBe(
      "action def Drive {\n  in speed : Real;\n  out distance : Real;\n}"
    );
  });

  // ─── Binding connector ───

  it("generates a binding connector", () => {
    const result = generateElementSource({
      kind: "binding_usage",
      name: "a.x",
      bindTarget: "b.y",
    });
    expect(result).toBe("binding a.x = b.y;");
  });

  // ─── Dependency ───

  it("generates a dependency statement", () => {
    const result = generateElementSource({
      kind: "dependency_statement",
      name: "dep1",
      depClient: "ComponentA",
      depSupplier: "ComponentB",
    });
    expect(result).toBe("dependency dep1 from ComponentA to ComponentB;");
  });

  // ─── Assert constraint ───

  it("generates an assert constraint usage", () => {
    const result = generateElementSource({
      kind: "constraint_usage",
      name: "safeSpeed",
      typeRef: "SpeedConstraint",
      isAssert: true,
    });
    expect(result).toBe("assert constraint safeSpeed : SpeedConstraint;");
  });

  // ─── Control flow actions ───

  it("generates an if action", () => {
    const result = generateElementSource({
      kind: "if_action",
      name: "speed > 100",
      ifBody: "action brake;",
      elseBody: "action cruise;",
    });
    expect(result).toBe("if speed > 100 {\n  action brake;\n} else {\n  action cruise;\n}");
  });

  it("generates a while action", () => {
    const result = generateElementSource({
      kind: "while_action",
      name: "fuel > 0",
      whileBody: "action consume;",
    });
    expect(result).toBe("while fuel > 0 {\n  action consume;\n}");
  });

  it("generates a for action", () => {
    const result = generateElementSource({
      kind: "for_action",
      name: "for",
      forItem: "w",
      forType: "Wheel",
      forCollection: "wheels",
      forBody: "action inspect;",
    });
    expect(result).toBe("for w : Wheel in wheels {\n  action inspect;\n}");
  });

  // ─── Send/Accept actions ───

  it("generates a send action with via", () => {
    const result = generateElementSource({
      kind: "send_action",
      name: "StartSignal",
      sendVia: "controlPort",
    });
    expect(result).toBe("send StartSignal via controlPort;");
  });

  it("generates an accept action via generic fallback", () => {
    const result = generateElementSource({
      kind: "accept_action",
      name: "StopSignal",
      typeRef: "SignalType",
    });
    expect(result).toBe("accept StopSignal : SignalType;");
  });

  // ─── Perform/Exhibit statements ───

  it("generates a perform statement via generic fallback", () => {
    const result = generateElementSource({
      kind: "perform_statement",
      name: "doWork",
      typeRef: "WorkAction",
    });
    expect(result).toBe("perform action doWork : WorkAction;");
  });

  it("generates an exhibit statement via generic fallback", () => {
    const result = generateElementSource({
      kind: "exhibit_statement",
      name: "showState",
      typeRef: "DisplayState",
    });
    expect(result).toBe("exhibit state showState : DisplayState;");
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



// ─── editElement ───


// ─── deleteElement ───

