import React, { useEffect } from "react";
import { AppShell } from "./components/layout/AppShell";
import { useModelStore } from "./stores/model-store";
import { useUIStore } from "./stores/ui-store";
import "./styles/globals.css";

// Sample SysML source for development/demo
const SAMPLE_SOURCE = `package VehicleSystem {
  part def Vehicle {
    part engine : Engine;
    part transmission : Transmission;
    part brakeSystem : BrakeSystem;
    part electricalSystem : ElectricalSystem;

    port fuelIn : FuelPort;
    port powerOut : DrivePort;
  }

  part def Engine {
    attribute displacement : Real;
    attribute maxRPM : Integer;

    port fuelIn : FuelPort;
    port torqueOut : TorquePort;

    state def EngineStates {
      state off;
      state idle;
      state running;

      transition off_to_idle
        first off then idle;
      transition idle_to_running
        first idle then running;
    }
  }

  part def Transmission {
    attribute gearCount : Integer;
    port torqueIn : TorquePort;
    port driveOut : DrivePort;
  }

  part def BrakeSystem {
    part frontBrakes : DiscBrake;
    part rearBrakes : DiscBrake;
    part abs : ABSController;

    requirement def StoppingDistance {
      doc /* The vehicle shall stop within 40m from 100km/h */
    }
  }

  part def ElectricalSystem {
    part battery : Battery;
    part alternator : Alternator;
    part ecu : ECU;
  }

  enum def FuelKind {
    enum gasoline;
    enum diesel;
    enum hydrogen;
  }

  action def Drive { }

  requirement def MaxSpeed {
    doc /* The vehicle shall achieve a top speed of 200 km/h */
  }

  requirement def Efficiency {
    doc /* The vehicle shall achieve 15 km/L fuel efficiency */
  }

  requirement def SafetyReq {
    doc /* The vehicle shall meet all safety regulations */
    requirement safetyBraking;
    requirement safetyAirbag;
  }

  part def DriverActor {
  }

  use case def DriveVehicle {
    doc /* Driver operates the vehicle */
  }

  use case def RefuelVehicle {
    doc /* Driver refuels the vehicle */
  }

  use case def PerformMaintenance {
    doc /* Maintain vehicle systems */
  }
}
`;

function App() {
  const loadSource = useModelStore((s) => s.loadSource);
  const theme = useUIStore((s) => s.theme);

  // Apply theme to document on mount and changes
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    // Load sample source on startup for development
    loadSource(SAMPLE_SOURCE);
  }, [loadSource]);

  return <AppShell />;
}

export default App;
