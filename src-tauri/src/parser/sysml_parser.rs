use tree_sitter::{Parser, Tree, InputEdit};

/// Holds parser state for incremental reparsing
pub struct SysmlParser {
    parser: Parser,
    current_tree: Option<Tree>,
    current_source: String,
}

impl SysmlParser {
    pub fn new() -> Self {
        let mut parser = Parser::new();
        let language = tree_sitter_sysml::language();
        parser.set_language(&language)
            .expect("Failed to set SysML language");
        Self {
            parser,
            current_tree: None,
            current_source: String::new(),
        }
    }

    /// Full parse of source text
    pub fn parse(&mut self, source: &str) -> Option<&Tree> {
        self.current_source = source.to_string();
        self.current_tree = self.parser.parse(source, None);
        self.current_tree.as_ref()
    }

    /// Incremental reparse after an edit
    pub fn reparse(&mut self, new_source: &str, edit: &InputEdit) -> Option<&Tree> {
        if let Some(ref mut old_tree) = self.current_tree {
            old_tree.edit(edit);
            self.current_tree = self.parser.parse(new_source, Some(old_tree));
        } else {
            self.current_tree = self.parser.parse(new_source, None);
        }
        self.current_source = new_source.to_string();
        self.current_tree.as_ref()
    }

    pub fn tree(&self) -> Option<&Tree> {
        self.current_tree.as_ref()
    }

    pub fn source(&self) -> &str {
        &self.current_source
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_package() {
        let mut parser = SysmlParser::new();
        let source = "package TestPkg { }";
        let tree = parser.parse(source);
        assert!(tree.is_some());
        let tree = tree.unwrap();
        let root = tree.root_node();
        assert_eq!(root.kind(), "source_file");
        assert!(root.child_count() > 0);
    }

    #[test]
    fn test_parse_part_definition() {
        let mut parser = SysmlParser::new();
        let source = "part def Vehicle { }";
        let tree = parser.parse(source);
        assert!(tree.is_some());
        let root = tree.unwrap().root_node();
        // Should have a child node for the part definition
        assert!(root.child_count() > 0);
    }

    #[test]
    fn test_parse_empty_source() {
        let mut parser = SysmlParser::new();
        let tree = parser.parse("");
        assert!(tree.is_some());
    }

    #[test]
    fn test_parse_complex_model() {
        let mut parser = SysmlParser::new();
        let source = r#"
package VehicleSystem {
    part def Vehicle {
        part engine : Engine;
        part transmission : Transmission;

        port fuelIn : FuelPort;
    }

    part def Engine {
        attribute displacement : Real;
        attribute maxRPM : Integer;

        port torqueOut : TorquePort;
    }

    enum def FuelKind {
        enum gasoline;
        enum diesel;
    }
}
"#;
        let tree = parser.parse(source);
        assert!(tree.is_some());
        let root = tree.unwrap().root_node();
        // Should parse without errors
        assert!(!root.has_error(), "Parse tree should not contain errors");
    }

    #[test]
    fn test_source_retained() {
        let mut parser = SysmlParser::new();
        let source = "part def X { }";
        parser.parse(source);
        assert_eq!(parser.source(), source);
    }

    #[test]
    fn test_incremental_reparse() {
        let mut parser = SysmlParser::new();
        let source = "part def Vehicle { }";
        parser.parse(source);

        // Simulate editing: change "Vehicle" to "Car"
        let new_source = "part def Car { }";
        let edit = InputEdit {
            start_byte: 9,
            old_end_byte: 16,
            new_end_byte: 12,
            start_position: tree_sitter::Point { row: 0, column: 9 },
            old_end_position: tree_sitter::Point { row: 0, column: 16 },
            new_end_position: tree_sitter::Point { row: 0, column: 12 },
        };

        let tree = parser.reparse(new_source, &edit);
        assert!(tree.is_some());
        assert_eq!(parser.source(), new_source);
    }
}
