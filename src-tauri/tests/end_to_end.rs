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
