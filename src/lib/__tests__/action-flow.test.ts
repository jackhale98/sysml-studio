import { describe, it, expect } from "vitest";
import { browserParse } from "../browser-parser";
import { browserListActions, browserExecuteAction } from "../tauri-bridge";

const TRANSPORT_SRC = `
action def TransportPassenger {
    action driverGetIn;
    action passengerGetIn;
    action checkSafety;
    action driveToDestination;
    action providePower;
    action monitorSystems;
    action driverGetOut;
    action passengerGetOut;

    join joinBoard;
    join joinDrive;
    join joinExit;

    first start then fork forkBoard;
      then driverGetIn;
      then passengerGetIn;
    first driverGetIn then joinBoard;
    first passengerGetIn then joinBoard;

    first joinBoard then checkSafety;
    first checkSafety then fork forkDrive;
      then driveToDestination;
      then providePower;
      then monitorSystems;
    first driveToDestination then joinDrive;
    first providePower then joinDrive;
    first monitorSystems then joinDrive;

    first joinDrive then fork forkExit;
      then driverGetOut;
      then passengerGetOut;
    first driverGetOut then joinExit;
    first passengerGetOut then joinExit;

    first joinExit then done;
}
`;

describe("action flow parsing", () => {
  it("parses fork/join/succession elements", () => {
    const model = browserParse(TRANSPORT_SRC);

    const actions = model.elements.filter(e => e.kind === "action_usage");
    expect(actions).toHaveLength(8);

    const forkNodes = model.elements.filter(e => e.kind === "fork_node");
    expect(forkNodes).toHaveLength(3);
    expect(new Set(forkNodes.map(f => f.name))).toEqual(new Set(["forkBoard", "forkDrive", "forkExit"]));

    const joinNodes = model.elements.filter(e => e.kind === "join_node");
    expect(joinNodes).toHaveLength(3);

    const succs = model.elements.filter(e => e.kind === "succession_usage");
    expect(succs.length).toBeGreaterThanOrEqual(8);

    const startToFork = succs.find(s => s.specializations[0] === "start");
    expect(startToFork?.type_ref).toBe("forkBoard");
  });

  it("parses sequential action with successions", () => {
    const model = browserParse(`
action def Drive {
    action startEngine;
    action checkMirrors;
    action accelerate;

    first startEngine then checkMirrors;
    first checkMirrors then accelerate;
}
`);
    const succs = model.elements.filter(e => e.kind === "succession_usage");
    expect(succs).toHaveLength(2);
    expect(succs[0].specializations[0]).toBe("startEngine");
    expect(succs[0].type_ref).toBe("checkMirrors");
  });
});

describe("action flow step building", () => {
  it("produces Fork/Join steps for TransportPassenger", () => {
    const model = browserParse(TRANSPORT_SRC);
    const actions = browserListActions(model);

    expect(actions).toHaveLength(1);
    const tp = actions[0];
    expect(tp.name).toBe("TransportPassenger");

    // Should have 3 Fork, 3 Join, 1 Action (checkSafety)
    const forkSteps = tp.steps.filter((s: any) => "Fork" in s);
    const joinSteps = tp.steps.filter((s: any) => "Join" in s);
    expect(forkSteps).toHaveLength(3);
    expect(joinSteps).toHaveLength(3);

    // forkBoard has 2 branches
    const first = tp.steps[0] as any;
    expect(first.Fork.name).toBe("forkBoard");
    expect(first.Fork.branches).toHaveLength(2);

    // forkDrive has 3 branches
    const drive = forkSteps[1] as any;
    expect(drive.Fork.name).toBe("forkDrive");
    expect(drive.Fork.branches).toHaveLength(3);

    // forkExit has 2 branches
    const exit = forkSteps[2] as any;
    expect(exit.Fork.name).toBe("forkExit");
    expect(exit.Fork.branches).toHaveLength(2);
  });

  it("sequential actions produce only Action steps", () => {
    const model = browserParse(`
action def Drive {
    action startEngine;
    action checkMirrors;
    action accelerate;
    first startEngine then checkMirrors;
    first checkMirrors then accelerate;
}
`);
    const actions = browserListActions(model);
    expect(actions[0].steps.every((s: any) => "Action" in s)).toBe(true);
  });
});

describe("action flow execution", () => {
  it("reports parallel savings for TransportPassenger", () => {
    const model = browserParse(TRANSPORT_SRC);
    const result = browserExecuteAction(model, "TransportPassenger");

    expect(result.status).toBe("Completed");

    // Should have Fork and Join events
    const forkEvents = result.trace.filter(t => t.kind === "Fork");
    const joinEvents = result.trace.filter(t => t.kind === "Join");
    expect(forkEvents.length).toBeGreaterThan(0);
    expect(joinEvents.length).toBeGreaterThan(0);

    // Should report parallel savings
    const bindings = result.env.bindings as Record<string, number>;
    expect(bindings.total_actions).toBe(8);
    expect(bindings.parallel_branches).toBe(7); // 2 + 3 + 2
    expect(bindings.critical_path_time).toBeLessThan(bindings.sequential_time);
    expect(bindings.parallel_savings).toBeGreaterThan(0);
  });

  it("sequential action has no parallel savings", () => {
    const model = browserParse(`
action def EmergencyStop {
    action detect;
    action brake;
    action alert;
    first detect then brake;
    first brake then alert;
}
`);
    const result = browserExecuteAction(model, "EmergencyStop");
    expect(result.status).toBe("Completed");

    const bindings = result.env.bindings as Record<string, number>;
    expect(bindings.parallel_branches).toBe(0);
    expect(bindings.parallel_savings).toBeUndefined();
  });
});
