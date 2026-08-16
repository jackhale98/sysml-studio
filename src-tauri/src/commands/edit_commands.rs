//! Model-modification commands built on sysml-core's byte-accurate
//! edit machinery (`codegen::edit`): every change is a `TextEdit` at
//! parser-recorded byte offsets, applied back-to-front with overlap
//! rejection, then re-parsed before it is accepted — an edit that would
//! break parsing is refused, not written.
//!
//! The old line-splicing editor in the frontend corrupted sources: it
//! replaced the first substring occurrence anywhere on a line, counted
//! braces inside comments, and never re-validated.

use serde::{Deserialize, Serialize};
use sysml_core::codegen::edit::{self, EditPlan, TextEdit};
use sysml_core::model::Model;

#[derive(Debug, Clone, Deserialize)]
pub struct ElementChanges {
    pub name: Option<String>,
    pub type_ref: Option<String>,
    pub value_expr: Option<String>,
    pub doc: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditOutcome {
    pub new_source: String,
    /// Unified diff of the change, for preview/undo confidence.
    pub diff: String,
    /// Parse errors present AFTER the edit (also present before, if any
    /// — an edit is rejected only when it makes things worse).
    pub parse_errors: Vec<String>,
}

fn parse(source: &str) -> Model {
    let mut m = sysml_core::parser::parse_file("<edit>", source);
    sysml_core::model::qualify_model(&mut m);
    m
}

fn error_count(m: &Model) -> usize {
    m.syntax_errors.len()
}

/// Apply a plan, then re-parse and refuse edits that increase the
/// parse-error count — the text on disk must never get WORSE.
fn apply_validated(source: &str, plan: &EditPlan) -> Result<EditOutcome, String> {
    let before_errors = error_count(&parse(source));
    let new_source = edit::apply_edits(source, plan).map_err(|e| e.message)?;
    let after = parse(&new_source);
    if error_count(&after) > before_errors {
        return Err(format!(
            "edit rejected: it would introduce {} new parse error(s)",
            error_count(&after) - before_errors
        ));
    }
    Ok(EditOutcome {
        diff: edit::diff(source, &new_source, "model.sysml"),
        parse_errors: after.syntax_errors.iter().map(|e| e.message.clone()).collect(),
        new_source,
    })
}

/// Locate the model element (def or usage) whose declaration starts at
/// the given byte — the frontend identifies elements by their span.
fn element_span_at(model: &Model, start_byte: usize) -> Option<(usize, usize)> {
    model
        .definitions
        .iter()
        .map(|d| (d.span.start_byte, d.span.end_byte))
        .chain(model.usages.iter().map(|u| (u.span.start_byte, u.span.end_byte)))
        .find(|(s, _)| *s == start_byte)
}

fn is_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'\''
}

/// Whole-word replacement of `old` by `new` restricted to a byte range.
fn word_replace_in_range(
    source: &str,
    range: (usize, usize),
    old: &str,
    new: &str,
    plan: &mut EditPlan,
) {
    let bytes = source.as_bytes();
    let old_b = old.as_bytes();
    let (lo, hi) = range;
    let mut pos = lo;
    while pos + old_b.len() <= hi.min(bytes.len()) {
        if &bytes[pos..pos + old_b.len()] == old_b {
            let before_ok = pos == 0 || !is_ident(bytes[pos - 1]);
            let after_ok =
                pos + old_b.len() >= bytes.len() || !is_ident(bytes[pos + old_b.len()]);
            if before_ok && after_ok {
                plan.add(TextEdit {
                    start_byte: pos,
                    end_byte: pos + old_b.len(),
                    new_text: new.to_string(),
                });
                pos += old_b.len();
                continue;
            }
        }
        pos += 1;
    }
}

#[tauri::command]
pub fn edit_element_source(
    source: String,
    start_byte: usize,
    old_name: Option<String>,
    old_type_ref: Option<String>,
    old_value_expr: Option<String>,
    changes: ElementChanges,
) -> Result<EditOutcome, String> {
    let model = parse(&source);
    let (span_start, span_end) =
        element_span_at(&model, start_byte).ok_or("element not found at span")?;

    let mut plan = EditPlan::new();

    // Rename: whole-file, word-boundary — references follow the name.
    if let (Some(old), Some(new)) = (old_name.as_deref(), changes.name.as_deref()) {
        if !new.is_empty() && old != new {
            let rename_plan = edit::rename_element(&source, &model, old, new)
                .map_err(|e| e.message)?;
            for e in rename_plan.edits {
                plan.add(e);
            }
        }
    }

    // Type change: word-boundary, restricted to the declaration span.
    if let (Some(old), Some(new)) = (old_type_ref.as_deref(), changes.type_ref.as_deref()) {
        if !new.is_empty() && old != new {
            word_replace_in_range(&source, (span_start, span_end), old, new, &mut plan);
        }
    }

    // Value change: replace the old value text within the span, or
    // insert `= value` before the terminator when there was none.
    if let Some(new_val) = changes.value_expr.as_deref() {
        match old_value_expr.as_deref() {
            Some(old) if !old.is_empty() => {
                if let Some(rel) = source[span_start..span_end.min(source.len())].find(old) {
                    let at = span_start + rel;
                    plan.add(TextEdit {
                        start_byte: at,
                        end_byte: at + old.len(),
                        new_text: new_val.to_string(),
                    });
                }
            }
            _ => {
                if !new_val.is_empty() {
                    // Insert before the `;` or `{` that ends the declaration head.
                    let head = &source[span_start..span_end.min(source.len())];
                    if let Some(rel) = head.find([';', '{']) {
                        let at = span_start + rel;
                        plan.add(TextEdit {
                            start_byte: at,
                            end_byte: at,
                            new_text: format!("= {} ", new_val),
                        });
                    }
                }
            }
        }
    }

    // Doc change: replace an existing doc /* ... */ inside the span
    // (byte-accurate, multi-line safe), or insert one into the body.
    if let Some(new_doc) = changes.doc.as_deref() {
        let span_text = &source[span_start..span_end.min(source.len())];
        if let Some(doc_rel) = span_text.find("doc") {
            if let Some(open_rel) = span_text[doc_rel..].find("/*") {
                if let Some(close_rel) = span_text[doc_rel + open_rel..].find("*/") {
                    let start = span_start + doc_rel;
                    let end = span_start + doc_rel + open_rel + close_rel + 2;
                    plan.add(TextEdit {
                        start_byte: start,
                        end_byte: end,
                        new_text: format!("doc /* {} */", new_doc),
                    });
                }
            }
        } else if !new_doc.is_empty() {
            if let Some(brace_rel) = span_text.find('{') {
                let at = span_start + brace_rel + 1;
                plan.add(TextEdit {
                    start_byte: at,
                    end_byte: at,
                    new_text: format!("\n    doc /* {} */", new_doc),
                });
            }
        }
    }

    if plan.edits.is_empty() {
        return Ok(EditOutcome {
            new_source: source.clone(),
            diff: String::new(),
            parse_errors: Vec::new(),
        });
    }
    apply_validated(&source, &plan)
}

#[tauri::command]
pub fn delete_element_source(source: String, start_byte: usize) -> Result<EditOutcome, String> {
    let model = parse(&source);
    let (span_start, span_end) =
        element_span_at(&model, start_byte).ok_or("element not found at span")?;

    // Expand to full lines so no dangling fragments remain.
    let bytes = source.as_bytes();
    let mut lo = span_start;
    while lo > 0 && bytes[lo - 1] != b'\n' {
        lo -= 1;
    }
    let mut hi = span_end.min(bytes.len());
    while hi < bytes.len() && bytes[hi] != b'\n' {
        hi += 1;
    }
    if hi < bytes.len() {
        hi += 1; // include the newline
    }

    let mut plan = EditPlan::new();
    plan.add(TextEdit {
        start_byte: lo,
        end_byte: hi,
        new_text: String::new(),
    });
    apply_validated(&source, &plan)
}

#[tauri::command]
pub fn insert_element_source(
    source: String,
    parent_name: Option<String>,
    element_text: String,
) -> Result<EditOutcome, String> {
    let model = parse(&source);
    let mut plan = EditPlan::new();
    let edit = match parent_name.as_deref().filter(|p| !p.is_empty()) {
        Some(parent) => {
            edit::insert_member(&source, &model, parent, &element_text).map_err(|e| e.message)?
        }
        None => edit::insert_top_level(&source, &element_text),
    };
    plan.add(edit);
    apply_validated(&source, &plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = "package P {\n    part def Wheel {\n        attribute wheelMass : Real = 12.5;\n    }\n    part def Vehicle {\n        part wheels : Wheel[4];\n    }\n}\n";

    fn span_of(source: &str, name: &str) -> usize {
        let m = parse(source);
        m.definitions
            .iter()
            .find(|d| d.name == name)
            .map(|d| d.span.start_byte)
            .or_else(|| {
                m.usages
                    .iter()
                    .find(|u| u.name == name)
                    .map(|u| u.span.start_byte)
            })
            .expect("element")
    }

    #[test]
    fn rename_does_not_corrupt_similar_identifiers() {
        // The old line editor turned `wheelMass` into `enginewheelMass`
        // when renaming Wheel. Word boundaries prevent that.
        let start = span_of(SRC, "Wheel");
        let out = edit_element_source(
            SRC.to_string(),
            start,
            Some("Wheel".into()),
            None,
            None,
            ElementChanges {
                name: Some("Rim".into()),
                type_ref: None,
                value_expr: None,
                doc: None,
            },
        )
        .expect("edit ok");
        assert!(out.new_source.contains("part def Rim"));
        assert!(out.new_source.contains("part wheels : Rim[4]"), "references follow");
        assert!(out.new_source.contains("wheelMass"), "similar identifier untouched");
        assert!(out.parse_errors.is_empty());
        assert!(out.diff.contains("-    part def Wheel"));
    }

    #[test]
    fn delete_removes_whole_element_only() {
        let start = span_of(SRC, "Wheel");
        let out = delete_element_source(SRC.to_string(), start).expect("delete ok");
        assert!(!out.new_source.contains("Wheel {"));
        assert!(out.new_source.contains("part def Vehicle"), "sibling untouched");
        assert!(out.parse_errors.is_empty());
    }

    #[test]
    fn edit_that_would_break_parse_is_rejected() {
        let start = span_of(SRC, "Wheel");
        let result = edit_element_source(
            SRC.to_string(),
            start,
            Some("Wheel".into()),
            None,
            None,
            ElementChanges {
                name: Some("Rim {".into()),
                type_ref: None,
                value_expr: None,
                doc: None,
            },
        );
        assert!(result.is_err(), "brace-injecting rename must be refused");
    }

    #[test]
    fn insert_member_lands_inside_parent() {
        let out = insert_element_source(
            SRC.to_string(),
            Some("Vehicle".into()),
            "attribute mass : Real = 100.0;".into(),
        )
        .expect("insert ok");
        let vehicle_idx = out.new_source.find("part def Vehicle").unwrap();
        let attr_idx = out.new_source.find("attribute mass").unwrap();
        assert!(attr_idx > vehicle_idx, "member inside Vehicle");
        assert!(out.parse_errors.is_empty());
    }

    #[test]
    fn value_edit_replaces_only_the_value() {
        let start = span_of(SRC, "wheelMass");
        let out = edit_element_source(
            SRC.to_string(),
            start,
            None,
            None,
            Some("12.5".into()),
            ElementChanges {
                name: None,
                type_ref: None,
                value_expr: Some("13.0".into()),
                doc: None,
            },
        )
        .expect("edit ok");
        assert!(out.new_source.contains("wheelMass : Real = 13.0;"));
    }
}
