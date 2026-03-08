use serde::{Serialize, Deserialize};

/// Unique ID for each element in the model
pub type ElementId = u32;

/// The category grouping for filtering
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Structure,
    Behavior,
    Requirement,
    Interface,
    Property,
    Relationship,
    Constraint,
    Analysis,
    View,
    Auxiliary,
}

/// Core element types from tree-sitter-sysml grammar
/// Verified against actual grammar.js node kinds
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ElementKind {
    // --- SysML Definition Types ---
    Package,
    PartDef,
    PartUsage,
    AttributeDef,
    AttributeUsage,
    PortDef,
    PortUsage,
    ConnectionDef,
    ConnectionUsage,
    InterfaceDef,
    InterfaceUsage,
    ItemDef,
    ItemUsage,
    ActionDef,
    ActionUsage,
    StateDef,
    StateUsage,
    TransitionStatement,
    ConstraintDef,
    ConstraintUsage,
    RequirementDef,
    RequirementUsage,
    ConcernDef,
    ConcernUsage,
    ViewDef,
    ViewUsage,
    ViewpointDef,
    ViewpointUsage,
    RenderingDef,
    RenderingUsage,
    AllocationDef,
    AllocationUsage,
    AnalysisCaseDef,
    AnalysisUsage,
    UseCaseDef,
    UseCaseUsage,
    VerificationCaseDef,
    VerificationUsage,
    EnumerationDef,
    FlowDef,
    FlowUsage,
    OccurrenceDef,
    OccurrenceUsage,
    MetadataDef,
    MetadataUsage,
    CalcDef,
    CalcUsage,
    IndividualDef,
    // --- KerML Definition Types ---
    ClassDef,
    StructDef,
    AssocDef,
    DataTypeDef,
    BehaviorDef,
    FunctionDef,
    PredicateDef,
    InteractionDef,
    // --- Usage/Feature Types ---
    FeatureUsage,
    EndFeature,
    EnumMember,
    RefUsage,
    EventUsage,
    SnapshotUsage,
    TimesliceUsage,
    // --- Behavioral Nodes ---
    PerformStatement,
    ExhibitStatement,
    IncludeStatement,
    SatisfyStatement,
    VerifyStatement,
    // --- Control Flow ---
    ForkNode,
    JoinNode,
    MergeNode,
    DecideNode,
    IfAction,
    WhileAction,
    ForAction,
    SendAction,
    AssignAction,
    // --- Relationships ---
    Specialization,
    Redefinition,
    TypedBy,
    Binding,
    // --- Declarations ---
    Import,
    Alias,
    // --- Comments ---
    Comment,
    DocComment,
    // --- Statements ---
    DependencyStatement,
    ConnectStatement,
    AllocateStatement,
    FlowStatement,
    MessageStatement,
    // --- Declarations for MBSE ---
    SubjectDeclaration,
    ActorDeclaration,
    ObjectiveDeclaration,
    StakeholderDeclaration,
    // Catch-all
    Other(String),
}

/// A single SysML element extracted from the parse tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SysmlElement {
    pub id: ElementId,
    pub kind: ElementKind,
    pub name: Option<String>,
    pub qualified_name: String,
    pub category: Category,
    pub parent_id: Option<ElementId>,
    pub children_ids: Vec<ElementId>,
    /// Source location for editor navigation
    pub span: SourceSpan,
    /// Type reference (e.g., `engine : Engine` → "Engine")
    pub type_ref: Option<String>,
    /// Specialization targets (e.g., `:> Vehicle`)
    pub specializations: Vec<String>,
    /// Modifiers: abstract, readonly, derived, etc.
    pub modifiers: Vec<String>,
    /// Multiplicity if present (e.g., "[2]", "[0..*]")
    pub multiplicity: Option<String>,
    /// Doc comment text
    pub doc: Option<String>,
    /// Short name (e.g., `<V>`)
    pub short_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceSpan {
    pub start_line: u32,
    pub start_col: u32,
    pub end_line: u32,
    pub end_col: u32,
    pub start_byte: u32,
    pub end_byte: u32,
}

/// The complete parsed model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SysmlModel {
    pub file_path: Option<String>,
    pub elements: Vec<SysmlElement>,
    pub errors: Vec<ParseError>,
    pub stats: ModelStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseError {
    pub message: String,
    pub span: SourceSpan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStats {
    pub total_elements: u32,
    pub definitions: u32,
    pub usages: u32,
    pub relationships: u32,
    pub errors: u32,
    pub parse_time_ms: f64,
}

impl ElementKind {
    pub fn is_definition(&self) -> bool {
        matches!(self,
            ElementKind::Package | ElementKind::PartDef | ElementKind::AttributeDef |
            ElementKind::PortDef | ElementKind::ConnectionDef | ElementKind::InterfaceDef |
            ElementKind::ItemDef | ElementKind::ActionDef | ElementKind::StateDef |
            ElementKind::ConstraintDef | ElementKind::RequirementDef | ElementKind::ConcernDef |
            ElementKind::ViewDef | ElementKind::ViewpointDef | ElementKind::RenderingDef |
            ElementKind::AllocationDef | ElementKind::AnalysisCaseDef | ElementKind::UseCaseDef |
            ElementKind::VerificationCaseDef | ElementKind::EnumerationDef | ElementKind::OccurrenceDef |
            ElementKind::FlowDef | ElementKind::MetadataDef | ElementKind::CalcDef |
            ElementKind::IndividualDef | ElementKind::ClassDef | ElementKind::StructDef |
            ElementKind::AssocDef | ElementKind::DataTypeDef | ElementKind::BehaviorDef |
            ElementKind::FunctionDef | ElementKind::PredicateDef | ElementKind::InteractionDef
        )
    }

    pub fn is_usage(&self) -> bool {
        matches!(self,
            ElementKind::PartUsage | ElementKind::AttributeUsage | ElementKind::PortUsage |
            ElementKind::ConnectionUsage | ElementKind::InterfaceUsage | ElementKind::ItemUsage |
            ElementKind::ActionUsage | ElementKind::StateUsage | ElementKind::ConstraintUsage |
            ElementKind::RequirementUsage | ElementKind::ConcernUsage | ElementKind::ViewUsage |
            ElementKind::ViewpointUsage | ElementKind::RenderingUsage | ElementKind::AllocationUsage |
            ElementKind::AnalysisUsage | ElementKind::UseCaseUsage | ElementKind::VerificationUsage |
            ElementKind::OccurrenceUsage | ElementKind::FlowUsage | ElementKind::MetadataUsage |
            ElementKind::CalcUsage | ElementKind::FeatureUsage | ElementKind::EndFeature |
            ElementKind::EnumMember | ElementKind::RefUsage | ElementKind::EventUsage |
            ElementKind::SnapshotUsage | ElementKind::TimesliceUsage | ElementKind::TransitionStatement
        )
    }

    pub fn is_relationship(&self) -> bool {
        matches!(self,
            ElementKind::Specialization | ElementKind::Redefinition |
            ElementKind::TypedBy | ElementKind::Binding |
            ElementKind::ConnectStatement | ElementKind::AllocateStatement |
            ElementKind::FlowStatement | ElementKind::DependencyStatement
        )
    }

    /// Returns display label for UI
    pub fn display_label(&self) -> &str {
        match self {
            ElementKind::Package => "Package",
            ElementKind::PartDef => "Part Def",
            ElementKind::PartUsage => "Part",
            ElementKind::AttributeDef => "Attribute Def",
            ElementKind::AttributeUsage => "Attribute",
            ElementKind::PortDef => "Port Def",
            ElementKind::PortUsage => "Port",
            ElementKind::ConnectionDef => "Connection Def",
            ElementKind::ConnectionUsage => "Connection",
            ElementKind::InterfaceDef => "Interface Def",
            ElementKind::InterfaceUsage => "Interface",
            ElementKind::ItemDef => "Item Def",
            ElementKind::ItemUsage => "Item",
            ElementKind::ActionDef => "Action Def",
            ElementKind::ActionUsage => "Action",
            ElementKind::StateDef => "State Def",
            ElementKind::StateUsage => "State",
            ElementKind::TransitionStatement => "Transition",
            ElementKind::ConstraintDef => "Constraint Def",
            ElementKind::ConstraintUsage => "Constraint",
            ElementKind::RequirementDef => "Requirement Def",
            ElementKind::RequirementUsage => "Requirement",
            ElementKind::ConcernDef => "Concern Def",
            ElementKind::ConcernUsage => "Concern",
            ElementKind::ViewDef => "View Def",
            ElementKind::ViewUsage => "View",
            ElementKind::ViewpointDef => "Viewpoint Def",
            ElementKind::ViewpointUsage => "Viewpoint",
            ElementKind::RenderingDef => "Rendering Def",
            ElementKind::RenderingUsage => "Rendering",
            ElementKind::AllocationDef => "Allocation Def",
            ElementKind::AllocationUsage => "Allocation",
            ElementKind::AnalysisCaseDef => "Analysis Case Def",
            ElementKind::AnalysisUsage => "Analysis",
            ElementKind::UseCaseDef => "Use Case Def",
            ElementKind::UseCaseUsage => "Use Case",
            ElementKind::VerificationCaseDef => "Verification Case Def",
            ElementKind::VerificationUsage => "Verification",
            ElementKind::EnumerationDef => "Enum Def",
            ElementKind::FlowDef => "Flow Def",
            ElementKind::FlowUsage => "Flow",
            ElementKind::OccurrenceDef => "Occurrence Def",
            ElementKind::OccurrenceUsage => "Occurrence",
            ElementKind::MetadataDef => "Metadata Def",
            ElementKind::MetadataUsage => "Metadata",
            ElementKind::CalcDef => "Calc Def",
            ElementKind::CalcUsage => "Calc",
            ElementKind::IndividualDef => "Individual Def",
            ElementKind::ClassDef => "Class Def",
            ElementKind::StructDef => "Struct Def",
            ElementKind::AssocDef => "Assoc Def",
            ElementKind::DataTypeDef => "Datatype Def",
            ElementKind::BehaviorDef => "Behavior Def",
            ElementKind::FunctionDef => "Function Def",
            ElementKind::PredicateDef => "Predicate Def",
            ElementKind::InteractionDef => "Interaction Def",
            ElementKind::FeatureUsage => "Feature",
            ElementKind::EndFeature => "End Feature",
            ElementKind::EnumMember => "Enum Value",
            ElementKind::RefUsage => "Ref",
            ElementKind::EventUsage => "Event",
            ElementKind::SnapshotUsage => "Snapshot",
            ElementKind::TimesliceUsage => "Timeslice",
            ElementKind::PerformStatement => "Perform",
            ElementKind::ExhibitStatement => "Exhibit",
            ElementKind::IncludeStatement => "Include",
            ElementKind::SatisfyStatement => "Satisfy",
            ElementKind::VerifyStatement => "Verify",
            ElementKind::ForkNode => "Fork",
            ElementKind::JoinNode => "Join",
            ElementKind::MergeNode => "Merge",
            ElementKind::DecideNode => "Decide",
            ElementKind::IfAction => "If",
            ElementKind::WhileAction => "While",
            ElementKind::ForAction => "For",
            ElementKind::SendAction => "Send",
            ElementKind::AssignAction => "Assign",
            ElementKind::Specialization => "Specialization",
            ElementKind::Redefinition => "Redefinition",
            ElementKind::TypedBy => "Typed By",
            ElementKind::Binding => "Binding",
            ElementKind::Import => "Import",
            ElementKind::Alias => "Alias",
            ElementKind::Comment => "Comment",
            ElementKind::DocComment => "Doc Comment",
            ElementKind::DependencyStatement => "Dependency",
            ElementKind::ConnectStatement => "Connect",
            ElementKind::AllocateStatement => "Allocate",
            ElementKind::FlowStatement => "Flow",
            ElementKind::MessageStatement => "Message",
            ElementKind::SubjectDeclaration => "Subject",
            ElementKind::ActorDeclaration => "Actor",
            ElementKind::ObjectiveDeclaration => "Objective",
            ElementKind::StakeholderDeclaration => "Stakeholder",
            ElementKind::Other(_) => "Other",
        }
    }
}
