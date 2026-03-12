import { describe, it, expect } from "vitest";
import { browserParse } from "../browser-parser";

describe("browserParse value_expr and multiplicity", () => {
  it("extracts value_expr from attribute with default value", () => {
    const model = browserParse(`
package Test {
  part def Engine {
    attribute mass : Real = 150.0;
    attribute cost : Real = 5000.0;
    attribute label : String;
  }
}
`);
    const mass = model.elements.find(e => e.name === "mass");
    const cost = model.elements.find(e => e.name === "cost");
    const label = model.elements.find(e => e.name === "label");

    expect(mass).toBeDefined();
    expect(mass!.value_expr).toBe("150.0");
    expect(cost!.value_expr).toBe("5000.0");
    expect(label!.value_expr).toBeNull();
  });

  it("extracts multiplicity from part usage", () => {
    const model = browserParse(`
package Test {
  part def Vehicle {
    part wheels : Wheel [4];
    part engine : Engine;
  }
}
`);
    const wheels = model.elements.find(e => e.name === "wheels");
    const engine = model.elements.find(e => e.name === "engine");

    expect(wheels).toBeDefined();
    expect(wheels!.multiplicity).toBe("4");
    expect(engine!.multiplicity).toBeNull();
  });

  it("BOM rollup produces correct totals via browser parser", () => {
    const model = browserParse(`
package VehicleBOM {
  part def Engine {
    attribute mass : Real = 150.0;
    attribute cost : Real = 5000.0;
  }
  part def Wheel {
    attribute mass : Real = 12.5;
    attribute cost : Real = 200.0;
  }
  part def Chassis {
    attribute mass : Real = 800.0;
    attribute cost : Real = 3000.0;
  }
  part def Vehicle {
    attribute mass : Real = 100.0;
    attribute cost : Real = 500.0;
    part engine : Engine;
    part wheels : Wheel [4];
    part chassis : Chassis;
  }
}
`);

    // Verify elements parsed
    const vehicle = model.elements.find(e => e.name === "Vehicle" && e.kind === "part_def");
    expect(vehicle).toBeDefined();

    const vehicleMass = model.elements.find(
      e => e.name === "mass" && e.parent_id === vehicle!.id
    );
    expect(vehicleMass?.value_expr).toBe("100.0");

    const wheelsUsage = model.elements.find(
      e => e.name === "wheels" && e.parent_id === vehicle!.id
    );
    expect(wheelsUsage?.multiplicity).toBe("4");
    expect(wheelsUsage?.type_ref).toBe("Wheel");

    // Verify the Wheel def's attributes parsed correctly
    const wheelDef = model.elements.find(e => e.name === "Wheel" && e.kind === "part_def");
    expect(wheelDef).toBeDefined();
    const wheelMass = model.elements.find(
      e => e.name === "mass" && e.parent_id === wheelDef!.id
    );
    expect(wheelMass?.value_expr).toBe("12.5");
  });
});

describe("browserParse new element patterns", () => {
  it("parses binding connectors", () => {
    const model = browserParse("binding a.x = b.y;");
    const el = model.elements.find(e => e.kind === "binding_usage");
    expect(el).toBeDefined();
    expect(el!.name).toBe("a.x");
    expect(el!.type_ref).toBe("b.y");
  });

  it("parses dependency statements", () => {
    const model = browserParse("dependency dep1 from ComponentA to ComponentB;");
    const el = model.elements.find(e => e.kind === "dependency_statement");
    expect(el).toBeDefined();
    expect(el!.name).toBe("dep1");
    expect(el!.specializations).toContain("ComponentA");
    expect(el!.type_ref).toBe("ComponentB");
  });

  it("parses perform statements", () => {
    const model = browserParse("perform action doWork : WorkAction;");
    const el = model.elements.find(e => e.kind === "perform_statement");
    expect(el).toBeDefined();
    expect(el!.name).toBe("doWork");
    expect(el!.type_ref).toBe("WorkAction");
  });

  it("parses exhibit statements", () => {
    const model = browserParse("exhibit state showState : DisplayState;");
    const el = model.elements.find(e => e.kind === "exhibit_statement");
    expect(el).toBeDefined();
    expect(el!.name).toBe("showState");
    expect(el!.type_ref).toBe("DisplayState");
  });

  it("parses assert constraint as constraint_usage", () => {
    const model = browserParse("assert constraint safeSpeed : SpeedConstraint;");
    const el = model.elements.find(e => e.name === "safeSpeed");
    expect(el).toBeDefined();
    expect(el!.kind).toBe("constraint_usage");
    expect(el!.type_ref).toBe("SpeedConstraint");
  });

  it("parses send action with via", () => {
    const model = browserParse("send StartSignal via controlPort;");
    const el = model.elements.find(e => e.kind === "send_action");
    expect(el).toBeDefined();
    expect(el!.name).toBe("StartSignal");
    expect(el!.type_ref).toBe("controlPort");
  });

  it("parses accept action with type", () => {
    const model = browserParse("accept StopSignal : SignalType;");
    const el = model.elements.find(e => e.kind === "accept_action");
    expect(el).toBeDefined();
    expect(el!.name).toBe("StopSignal");
    expect(el!.type_ref).toBe("SignalType");
  });

  it("parses if action", () => {
    const model = browserParse("if speed > 100 {\n  action brake;\n}");
    const el = model.elements.find(e => e.kind === "if_action");
    expect(el).toBeDefined();
    expect(el!.name).toBe("speed > 100");
  });

  it("parses while action", () => {
    const model = browserParse("while fuel > 0 {\n  action consume;\n}");
    const el = model.elements.find(e => e.kind === "while_action");
    expect(el).toBeDefined();
    expect(el!.name).toBe("fuel > 0");
  });

  it("parses for action", () => {
    const model = browserParse("for w : Wheel in wheels {\n  action inspect;\n}");
    const el = model.elements.find(e => e.kind === "for_action");
    expect(el).toBeDefined();
    expect(el!.name).toBe("w");
    expect(el!.type_ref).toBe("Wheel");
  });
});
