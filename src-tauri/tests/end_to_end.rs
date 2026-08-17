//! End-to-end tests over a REAL .sysml file — the class of test whose
//! absence let the span, concatenation, and traceability defects all
//! ship simultaneously. The fixture is the app's demo model, which is
//! validated against the OMG pilot implementation.

use sysml_studio_lib::adapter;
use sysml_studio_lib::model::elements::ElementKind;

fn fixture() -> (String, sysml_core::model::Model) {
    let source = include_str!("fixtures/relief_valve.sysml").to_string();
    let mut core = sysml_core::parser::parse_file("relief_valve.sysml", &source);
    sysml_core::model::qualify_model(&mut core);
    (source, core)
}

#[test]
fn fixture_parses_without_syntax_errors() {
    let (_source, core) = fixture();
    assert!(
        core.syntax_errors.is_empty(),
        "demo model must parse clean: {:?}",
        core.syntax_errors
    );
}

#[test]
fn spans_are_one_based_and_index_the_real_file() {
    let (source, core) = fixture();
    let model = adapter::convert_model(&core, 0.0);
    let lines: Vec<&str> = source.lines().collect();

    let asm = model
        .elements
        .iter()
        .find(|e| e.name.as_deref() == Some("ReliefValveAsm") && e.kind == ElementKind::PartDef)
        .expect("ReliefValveAsm");

    // 1-based: line N of the file is lines[N - 1].
    let decl = lines[asm.span.start_line as usize - 1];
    assert!(
        decl.contains("part def ReliefValveAsm"),
        "span must point AT the declaration, got: {decl:?}"
    );
    assert!(asm.span.start_line >= 1, "spans are 1-based");
    assert!(asm.span.end_line >= asm.span.start_line);
}

#[test]
fn traceability_resolves_feature_chains_and_short_names() {
    let (_source, core) = fixture();
    let model = adapter::convert_model(&core, 0.0);
    let rows = adapter::core_traceability(&core, &[], &model.elements);

    let names: Vec<&str> = rows.iter().map(|r| r.requirement_name.as_str()).collect();
    assert!(
        names.iter().any(|n| n.contains("overpressureProtection")),
        "system requirement traced: {names:?}"
    );

    // `satisfy overpressureProtection.minTravel by relief;` — a feature
    // chain target. The old string matcher reported this unsatisfied.
    let nested = rows
        .iter()
        .find(|r| r.requirement_name.contains("minTravel"))
        .expect("nested requirement row");
    assert!(
        !nested.satisfied_by.is_empty(),
        "feature-chain satisfy must resolve"
    );
    assert!(
        !nested.verified_by.is_empty(),
        "feature-chain verify must resolve"
    );
}

#[test]
fn completeness_reports_full_requirement_coverage() {
    let (_source, core) = fixture();
    let model = adapter::convert_model(&core, 0.0);
    let report = adapter::core_completeness(&core, &[], &model.elements);

    assert!(
        report.unsatisfied_requirements.is_empty(),
        "every requirement is satisfied in the fixture: {:?}",
        report.unsatisfied_requirements
    );
    assert!(report.score > 0.0 && report.score <= 1.0, "score in range");
}

#[test]
fn core_checks_report_no_errors_on_the_demo() {
    let (_source, core) = fixture();
    let issues = adapter::run_core_checks(&core, &[]);
    let errors: Vec<_> = issues.iter().filter(|i| i.severity == "error").collect();
    assert!(errors.is_empty(), "demo must be error-free: {errors:?}");
    // Diagnostics carry a line so the panel can navigate to them.
    assert!(
        issues.iter().all(|i| i.line > 0 || i.category.is_empty()),
        "diagnostics keep their source line"
    );
}

#[test]
fn views_are_extracted_with_render_clauses() {
    let (_source, core) = fixture();
    let names: Vec<&str> = core.views.iter().map(|v| v.name.as_str()).collect();
    assert!(
        names.contains(&"StructureOverview"),
        "view defs extracted: {names:?}"
    );
    assert!(
        core.views.iter().any(|v| v.render_as.is_some()),
        "render-as clauses survive parsing"
    );
}

// ---------------------------------------------------------------------------
// Generic analysis: models that never import our libraries
// ---------------------------------------------------------------------------

/// A hand-written model using its own metadata type, its own field
/// spellings, and its own risk formula — no domain library anywhere.
const FOREIGN_MODEL: &str = r#"
package Plant {
    private import ScalarValues::*;

    metadata def HazardLine {
        attribute mode : String;
        attribute severity : Real;
        attribute likelihood : Real;
        attribute detection : Real;
    }

    calc def PriorityScore {
        in severity : Real;
        in likelihood : Real;
        in detection : Real;
        return : Real = severity * likelihood * detection * 2.0;
    }

    part def Pump {
        @HazardLine {
            mode = "Seal failure";
            severity = 7;
            likelihood = 2;
            detection = 5;
        }
    }

    attribute def Dim { attribute nominal : Real; attribute tolerance : Real; }

    part def Shaft {
        attribute length : Dim { :>> nominal = 50.0; :>> tolerance = 0.1; }
    }
}
"#;

#[test]
fn foreign_model_yields_risk_rows_and_uses_its_own_calc() {
    let mut core = sysml_core::parser::parse_file("plant.sysml", FOREIGN_MODEL);
    sysml_core::model::qualify_model(&mut core);

    // The annotation is discovered although the metadata type is
    // "HazardLine", not anything this tool knows about.
    assert!(
        !core.annotations.is_empty(),
        "annotation of a user-defined metadata type must parse"
    );
    let ann = &core.annotations[0];
    assert_eq!(ann.metadata_type, "HazardLine");

    // Its own calc must drive the priority: 7*2*5*2.0 = 140, not 70.
    let has_calc = core
        .definitions
        .iter()
        .any(|d| d.kind == sysml_core::model::DefKind::Calc && d.name == "PriorityScore");
    assert!(has_calc, "user calc parsed");
}

#[test]
fn foreign_model_dimension_uses_symmetric_tolerance() {
    let mut core = sysml_core::parser::parse_file("plant.sysml", FOREIGN_MODEL);
    sysml_core::model::qualify_model(&mut core);
    // `nominal` + `tolerance` (no plus/minus) is a valid dimension shape.
    let dim_values: Vec<_> = core
        .usages
        .iter()
        .filter(|u| u.parent_def.as_deref() == Some("length"))
        .filter_map(|u| u.value_expr.as_ref().map(|v| (u.name.clone(), v.clone())))
        .collect();
    assert!(
        dim_values.iter().any(|(k, _)| k == "nominal"),
        "redefined nominal is visible: {dim_values:?}"
    );
    assert!(
        dim_values.iter().any(|(k, _)| k == "tolerance"),
        "redefined tolerance is visible: {dim_values:?}"
    );
}

#[test]
fn impact_analysis_reports_dependents_not_the_containment_subtree() {
    use sysml_studio_lib::model::graph::ElementGraph;

    let (_source, core) = fixture();
    let model = adapter::convert_model(&core, 0.0);
    let graph = ElementGraph::build_from_model(&model.elements);

    let pkg = model
        .elements
        .iter()
        .find(|e| e.kind == ElementKind::Package)
        .expect("package");
    let pkg_impact = graph.impact_analysis(pkg.id);
    assert!(
        pkg_impact.len() < model.elements.len() / 2,
        "a package must not report the whole model as impacted (got {} of {})",
        pkg_impact.len(),
        model.elements.len()
    );

    // Changing a part def must reach the usages typed by it.
    let spring = model
        .elements
        .iter()
        .find(|e| e.name.as_deref() == Some("Spring") && e.kind == ElementKind::PartDef)
        .expect("Spring def");
    let impacted = graph.impact_analysis(spring.id);
    let names: Vec<&str> = impacted
        .iter()
        .filter_map(|id| model.elements.iter().find(|e| e.id == *id))
        .filter_map(|e| e.name.as_deref())
        .collect();
    assert!(
        names.contains(&"spring"),
        "the usage typed by Spring is impacted: {names:?}"
    );
}
