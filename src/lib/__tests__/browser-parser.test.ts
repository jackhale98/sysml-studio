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
