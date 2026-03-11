import React, { useEffect } from "react";
import { AppShell } from "./components/layout/AppShell";
import { useModelStore } from "./stores/model-store";
import { useUIStore } from "./stores/ui-store";
import "./styles/globals.css";

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// Sample SysML source for development/demo
export const SAMPLE_SOURCE = `package VehicleSystem {
  part def Vehicle {
    doc /* Top-level vehicle assembly — mass and cost roll up from children */

    attribute passengerCount : Real = 4;
    attribute passengerMass : Real = 75;
    attribute efficiency : Real = 15;
    attribute velocity : Real = 120;
    attribute friction : Real = 0.7;
    attribute gravity : Real = 9.81;
    attribute laborCost : Real = 2000;
    attribute overheadRate : Real = 0.35;

    part engine : Engine;
    part transmission : Transmission;
    part brakeSystem : BrakeSystem;
    part electricalSystem : ElectricalSystem;
    part wheels[4] : WheelAssembly;
    part body : BodyStructure;

    port fuelIn : FuelPort;
    port powerOut : DrivePort;
  }

  part def Engine {
    attribute mass : Real = 180;
    attribute cost : Real = 4500;
    attribute displacement : Real = 2.0;

    port fuelIn : FuelPort;
    port torqueOut : TorquePort;

    state def EngineStates {
      state off;
      state idle;
      state running;

      transition off_to_idle
        first off accept StartSignal then idle;
      transition idle_to_running
        first idle accept ThrottleSignal then running;
      transition running_to_idle
        first running accept IdleSignal then idle;
      transition idle_to_off
        first idle accept StopSignal then off;
    }
  }

  part def Transmission {
    attribute mass : Real = 75;
    attribute cost : Real = 2200;
    port torqueIn : TorquePort;
    port driveOut : DrivePort;
  }

  part def WheelAssembly {
    doc /* Each wheel is a tire + rim sub-assembly */
    part tire : Tire;
    part rim : Rim;
  }

  part def Tire {
    attribute mass : Real = 10;
    attribute cost : Real = 120;
  }

  part def Rim {
    attribute mass : Real = 9;
    attribute cost : Real = 180;
  }

  part def BodyStructure {
    attribute mass : Real = 350;
    attribute cost : Real = 5200;
  }

  part def BrakeSystem {
    doc /* Brake assembly — mass/cost from brake components */
    part frontBrakes[2] : DiscBrake;
    part rearBrakes[2] : DrumBrake;
    part abs : ABSController;
  }

  part def DiscBrake {
    attribute mass : Real = 4.5;
    attribute cost : Real = 180;
  }

  part def DrumBrake {
    attribute mass : Real = 3.2;
    attribute cost : Real = 95;
  }

  part def ABSController {
    attribute mass : Real = 1.8;
    attribute cost : Real = 350;
  }

  part def ElectricalSystem {
    doc /* Electrical sub-assembly — mass/cost from components */
    part battery : Battery;
    part alternator : Alternator;
    part ecu : ECU;
    part sensors[6] : Sensor;
  }

  part def Battery {
    attribute mass : Real = 20;
    attribute cost : Real = 800;
    attribute capacity : Real = 70;
  }

  part def Alternator {
    attribute mass : Real = 7;
    attribute cost : Real = 350;
  }

  part def ECU {
    attribute mass : Real = 0.8;
    attribute cost : Real = 600;
  }

  part def Sensor {
    attribute mass : Real = 0.15;
    attribute cost : Real = 45;
  }

  enum def FuelKind {
    enum gasoline;
    enum diesel;
    enum hydrogen;
  }

  // Sequential driving procedure with explicit succession (SysML v2 §7.13)
  action def Drive {
    action startEngine;
    action checkMirrors;
    action releaseBrake;
    action accelerate;
    action cruise;
    action decelerate;
    action applyBrake;
    action stopEngine;

    first startEngine then checkMirrors;
    first checkMirrors then releaseBrake;
    first releaseBrake then accelerate;
    first accelerate then cruise;
    first cruise then decelerate;
    first decelerate then applyBrake;
    first applyBrake then stopEngine;
  }

  // Parallel workflow with fork/join (adapted from SysML v2 Annex A — TransportPassenger)
  action def TransportPassenger {
    // Declare action steps
    action driverGetIn;
    action passengerGetIn;
    action checkSafety;
    action driveToDestination;
    action providePower;
    action monitorSystems;
    action driverGetOut;
    action passengerGetOut;

    // Declare control flow nodes
    join joinBoard;
    join joinDrive;
    join joinExit;

    // Phase 1: Boarding — driver and passenger board in parallel
    first start then fork forkBoard;
      then driverGetIn;
      then passengerGetIn;
    first driverGetIn then joinBoard;
    first passengerGetIn then joinBoard;

    // Phase 2: Safety check, then 3 concurrent driving activities
    first joinBoard then checkSafety;
    first checkSafety then fork forkDrive;
      then driveToDestination;
      then providePower;
      then monitorSystems;
    first driveToDestination then joinDrive;
    first providePower then joinDrive;
    first monitorSystems then joinDrive;

    // Phase 3: Disembark — driver and passenger exit in parallel
    first joinDrive then fork forkExit;
      then driverGetOut;
      then passengerGetOut;
    first driverGetOut then joinExit;
    first passengerGetOut then joinExit;

    first joinExit then done;
  }

  // Emergency response: strictly sequential critical path
  action def EmergencyStop {
    action detectObstacle;
    action activateABS;
    action applyFullBrake;
    action activateHazardLights;
    action callEmergencyServices;

    first detectObstacle then activateABS;
    first activateABS then applyFullBrake;
    first applyFullBrake then activateHazardLights;
    first activateHazardLights then callEmergencyServices;
  }

  calc def GrossVehicleMass {
    in mass : Real;
    in passengerCount : Real;
    in passengerMass : Real;
    return result : Real = mass + passengerCount * passengerMass;
  }

  calc def FuelRange {
    in capacity : Real;
    in efficiency : Real;
    return result : Real = capacity * efficiency;
  }

  calc def BrakingDistance {
    in velocity : Real;
    in friction : Real;
    in gravity : Real;
    return result : Real = velocity * velocity / (2 * friction * gravity);
  }

  calc def UnitCost {
    in cost : Real;
    in laborCost : Real;
    in overheadRate : Real;
    return result : Real = cost + laborCost * (1 + overheadRate);
  }

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

  part def Driver {
    doc /* Primary vehicle operator */
  }

  use case def DriveVehicle {
    doc /* Driver operates the vehicle */
    actor driver : Driver;
  }

  use case def RefuelVehicle {
    doc /* Driver refuels the vehicle */
    actor driver : Driver;
  }

  use case def PerformMaintenance {
    doc /* Maintain vehicle systems */
    actor mechanic : Driver;
  }

  part def VehicleVerification {
    doc /* Verification activities for the vehicle */
    verify MaxSpeed;
    verify Efficiency;
    verify SafetyReq;
  }

  part def VehicleDesign {
    doc /* Vehicle design satisfying requirements */
    satisfy MaxSpeed;
    satisfy Efficiency;
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
    // Browser mode: load demo content so users can explore without files
    // Tauri app: start empty — user must open or create a file
    if (!isTauri) {
      loadSource(SAMPLE_SOURCE);
    }
  }, [loadSource]);

  return <AppShell />;
}

export default App;
