package ReliefValve {
    doc
    /*
     * Demo: a spring-loaded pressure relief valve, from parts and
     * ports through requirements, behavior, analysis, and views.
     * Standard-conformant SysML v2 - validated against the OMG pilot
     * implementation.
     */

    private import ScalarValues::*;
    // Rendering methods (asTreeDiagram, asElementTable, ...) live in the
    // standard Views library.
    private import Views::*;

    // --- Structure -----------------------------------------------------

    port def FluidPort {
        attribute pressure : Real;
    }

    part def ValveBody {
        attribute mass : Real = 0.45;
        attribute seatDepth : Real = 30.0;
        port inlet : FluidPort;
        port outlet : FluidPort;
    }

    part def Piston {
        attribute mass : Real = 0.12;
        attribute length : Real = 28.0;
    }

    part def Spring {
        attribute mass : Real = 0.03;
        attribute solidHeight : Real = 1.5;
        attribute rate : Real = 8.6;
    }

    part def ReliefValveAsm {
        attribute mass : Real = 0.02;
        part body : ValveBody;
        part piston : Piston;
        part spring : Spring;
        port systemIn : FluidPort;
        port ventOut : FluidPort;
        connection supply : Connection connect systemIn to body.inlet;
        connection vent : Connection connect body.outlet to ventOut;
    }

    connection def Connection {
        end a : FluidPort;
        end b : FluidPort;
    }

    part relief : ReliefValveAsm;

    // --- Requirements --------------------------------------------------

    requirement def <'SYS-1'> OverpressureProtectionReq {
        doc
        /*
         * Vessel pressure shall never exceed the maximum allowable
         * accumulation (110% of rated pressure).
         */
        subject valve : ReliefValveAsm;
    }

    requirement def <'RV-1'> MinTravelReq {
        doc /* The piston shall retain at least 0.2 mm travel clearance. */
        subject valve : ReliefValveAsm;
    }

    requirement overpressureProtection : OverpressureProtectionReq {
        requirement minTravel : MinTravelReq;
    }

    satisfy overpressureProtection by relief;
    satisfy overpressureProtection.minTravel by relief;

    verification def PopTest {
        doc /* Pressurize past the set point; confirm full relief. */
        subject valve : ReliefValveAsm;
        objective {
            verify overpressureProtection;
        }
    }

    verification def TravelClearanceTest {
        doc /* Measure piston travel at spring solid on 30 assemblies. */
        subject valve : ReliefValveAsm;
        objective {
            verify overpressureProtection.minTravel;
        }
    }

    // --- Behavior ------------------------------------------------------

    state def ValveStates {
        entry; then closed;
        state closed;
        state open;
        transition closedToOpen
            first closed
            if systemPressure > setPoint
            then open;
        transition openToClosed
            first open
            if systemPressure <= reseatPoint
            then closed;
        attribute systemPressure : Real;
        attribute setPoint : Real = 10.0;
        attribute reseatPoint : Real = 9.2;
    }

    action def ProofTestValve {
        doc /* Bench proof test: prep in parallel, then pop test. */
        action mountValve;
        action connectGauge;
        action fillReservoir;
        action raisePressure;
        action recordPopPressure;

        first start then mountValve;
        first mountValve then prepFork;
        fork prepFork;
            then connectGauge;
            then fillReservoir;
        join prepJoin;
        first connectGauge then prepJoin;
        first fillReservoir then prepJoin;
        first prepJoin then raisePressure;
        first raisePressure then recordPopPressure;
        first recordPopPressure then done;
    }

    // --- Analysis ------------------------------------------------------

    calc def SpringForce {
        in deflection : Real;
        in rate : Real;
        return : Real = deflection * rate;
    }

    constraint def MassLimit {
        in totalMass : Real;
        in limit : Real;
        totalMass <= limit
    }

    analysis def TravelGapAnalysis {
        doc /* Piston travel at spring solid: seatDepth - length - solidHeight. */
        subject valve : ReliefValveAsm;
        return gap : Real;
    }

    // --- Views ---------------------------------------------------------

    // A view DEFINITION declares what it filters and how it renders;
    // a view USAGE exposes the elements to render. (The pilot rejects
    // `expose` inside a view def.)
    view def StructureOverview {
        filter @SysML::PartDefinition;
        render asTreeDiagram;
    }

    view def InterconnectionOverview {
        render asInterconnectionDiagram;
    }

    view def PartsTable {
        filter @SysML::PartUsage;
        render asElementTable;
    }

    view structureOverview : StructureOverview {
        expose ReliefValve::*;
    }

    view systemInterconnection : InterconnectionOverview {
        expose ReliefValve::ReliefValveAsm;
    }

    view partsTable : PartsTable {
        expose ReliefValve::*;
    }
}
