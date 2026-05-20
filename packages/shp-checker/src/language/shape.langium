grammar Shape

entry ShapeModule:
    ('module' name=QualifiedName)?
    imports+=ImportDecl*
    declarations+=Declaration*;

Declaration:
    ResourceDecl | TraitDecl | ComponentDecl | RelationDecl | ImplementationDecl | BindingDecl | ChangeDecl | AttestationDecl | RuleDecl | RationaleDecl | MemoryDecl | ReevaluationDecl;

ImportDecl:
    'import' path=QualifiedName;

ResourceDecl:
    'resource' name=ID (':' traits+=TypeRef (',' traits+=TypeRef)*)? body=ResourceBody?;

ResourceBody:
    '{' members+=ResourceMember* '}';

ResourceMember:
    StorageDecl;

StorageDecl:
    'storage' provider=QualifiedName '(' value=STRING ')';

TraitDecl:
    'trait' name=ID typeParams=TypeParamList?
    '{'
        members+=TraitMember*
    '}';

TypeParamList:
    '<' params+=TypeParam (',' params+=TypeParam)* '>';

TypeParam:
    name=ID (':' bound=ID)?;

TraitMember:
    TraitAllowDecl | TraitForbidDecl | TraitRequireDecl;

TraitAllowDecl:
    'allow' pattern=EffectPattern;

TraitForbidDecl:
    'forbid' final?='final'? pattern=EffectPattern;

TraitRequireDecl:
    'require' pattern=EffectPattern;

ComponentDecl:
    'component' name=ID (':' classifiers+=TypeRef (',' classifiers+=TypeRef)*)?
    '{'
        members+=ComponentMember*
    '}';

ComponentMember:
    OwnsDecl | GrantsDecl | FunctionSummary;

OwnsDecl:
    'owns' resource=TypeRef;

GrantsDecl:
    'grants' term=EffectTerm;

RelationDecl:
    'relation' name=ID
    '{'
        members+=RelationMember*
    '}';

RelationMember:
    RelationKindDecl | RelationConnectsDecl | RelationRolesDecl | RelationSummaryDecl;

RelationKindDecl:
    'kind' value=RelationKindName;

RelationKindName returns string:
    'provides' | 'calls' | 'callbacks' | 'coordinated_call' | ID;

RelationConnectsDecl:
    'connects' (
        endpoints+=RelationEndpoint (ordered?='->' endpoints+=RelationEndpoint)+
        | '{' endpoints+=RelationEndpoint (',' endpoints+=RelationEndpoint)+ '}'
    );

RelationEndpoint:
    name=QualifiedTargetName;

RelationRolesDecl:
    'roles' '{' roles+=RelationRoleEntry (',' roles+=RelationRoleEntry)* '}';

RelationRoleEntry:
    name=QualifiedTargetName 'as' role=ID;

RelationSummaryDecl:
    'summary' value=STRING;

FunctionSummary:
    'fn' name=ID
        shapeTraits=ShapeTraitList?
        source=SourceDecl?
        description=DescriptionDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;

ShapeTraitList:
    ':' traits+=TypeRef (',' traits+=TypeRef)*;

DescriptionDecl:
    'description' required?='required'? summary=STRING;

FunctionMember:
    FunctionRequiresDecl | ReasonDecl | ExpiresDecl;

FunctionRequiresDecl:
    'requires' term=EffectTerm;

ReasonDecl:
    'reason' value=STRING;

ExpiresDecl:
    'expires' value=STRING;

EffectsDecl:
    CompleteEffects | UnknownEffects;

CompleteEffects:
    'effects' 'complete' '{'
        effects+=EffectEntry*
    '}';

UnknownEffects:
    {infer UnknownEffects} 'effects' 'unknown';

EffectEntry:
    term=EffectTerm evidence=EvidenceDecl?;

SourceDecl:
    'source' ref=SourceRef;

EvidenceDecl:
    'evidence' ref=SourceRef;

SourceRef:
    language=ID '(' path=STRING ')';

EffectTerm:
    name=ID ('<' target=TypeRef '>')?;

EffectPattern:
    name=ID ('<' target=TypeRef '>')?;

TypeRef:
    name=ID;

ImplementationDecl:
    'implementation' name=ID
    '{'
        members+=ImplementationMember*
    '}';

ImplementationMember:
    PathsBlock | ConformsToDecl | OnChangeDecl;

PathsBlock:
    'paths' '{' paths+=STRING* '}';

ConformsToDecl:
    'conforms_to' component=TypeRef;

OnChangeDecl:
    'on_change' 'require' requirement=ID;

BindingDecl:
    'binding' name=ID
    '{'
        members+=BindingMember*
    '}';

BindingMember:
    BindingWhenChangedDecl | BindingRequireChangedDecl | BindingAllowAttestDecl;

BindingWhenChangedDecl:
    'when_changed' body=PathsBlock;

BindingRequireChangedDecl:
    'require_changed' body=PathsBlock;

BindingAllowAttestDecl:
    'allow' 'attest' kind=ID;

AttestationDecl:
    'attest' kind=ID
    '{'
        source=SourceDecl
        reason=ReasonDecl
    '}';

ChangeDecl:
    'change' name=ID
    '{'
        entries+=ChangeEntry*
    '}';

ChangeEntry:
    AddFunctionChange | ModifyFunctionChange | RemoveFunctionChange | AddDeclarationChange | ModifyDeclarationChange | RemoveDeclarationChange;

AddFunctionChange:
    'add' 'fn' component=ID '.' name=ID
        shapeTraits=ShapeTraitList?
        source=SourceDecl?
        description=DescriptionDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;

ModifyFunctionChange:
    'modify' 'fn' component=ID '.' name=ID
        shapeTraits=ShapeTraitList?
        source=SourceDecl?
        description=DescriptionDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;

RemoveFunctionChange:
    'remove' 'fn' component=ID '.' name=ID;

AddDeclarationChange:
    'add' declaration=AddableDeclaration;

ModifyDeclarationChange:
    'modify' declaration=AddableDeclaration;

RemoveDeclarationChange:
    'remove' kind=RemovableDeclarationKind name=ID;

AddableDeclaration:
    ResourceDecl | TraitDecl | ComponentDecl | RelationDecl | ImplementationDecl | BindingDecl | AttestationDecl | RuleDecl;

RemovableDeclarationKind returns string:
    'resource' | 'trait' | 'component' | 'relation' | 'implementation' | 'binding' | 'rule';

RuleDecl:
    'rule' name=ID typeParams=TypeParamList?
    '{'
        members+=RuleMember*
    '}';

RuleMember:
    RuleWhenHasDecl | RuleForbidEffectDecl | RuleForbidProvidesDecl | RuleForbidHypercycleDecl;

RuleWhenHasDecl:
    'when' subject=ID 'has' trait=ID;

RuleForbidEffectDecl:
    'forbid' final?='final'? pattern=EffectPattern;

RuleForbidProvidesDecl:
    'forbid' 'provides' target=TypeRef ('except' except=ID)?;

RuleForbidHypercycleDecl:
    'forbid' 'hypercycle' ('over' kinds+=RelationKindName ('or' kinds+=RelationKindName)*)?;

RationaleDecl:
    'rationale' name=ID ':' contextType=ContextTypeRef
    '{'
        members+=RationaleMember*
    '}';

RationaleMember:
    AppliesToDecl | WhyDecl | SummaryDecl | OwnerDecl | ReviewByDecl | ProtectsDecl | GuardDecl | EvidenceLineDecl;

MemoryDecl:
    'memory' name=ID ':' contextType=ContextTypeRef
    '{'
        members+=MemoryMember*
    '}';

MemoryMember:
    AppliesToDecl | StatusDecl | ConfidenceDecl | ProtectsDecl | GuardDecl | ObservedDecl | SummaryDecl | OwnerDecl | ReviewByDecl | EvidenceLineDecl;

ReevaluationDecl:
    'reevaluation' name=ID
    '{'
        members+=ReevaluationMember*
    '}';

ReevaluationMember:
    SatisfiesDecl | OutcomeDecl | SummaryDecl | EvidenceLineDecl | ReviewerDecl | ApproverDecl | DecidedOnDecl;

TargetRef:
    kind=TargetKind name=QualifiedTargetName;

TargetKind returns string:
    'fn' | 'component' | 'resource' | 'implementation' | 'rule' | 'relation';

QualifiedTargetName returns string:
    ID ('.' ID)*;

ContextTypeRef:
    name=ID '<' target=TargetRef '>';

AppliesToDecl:
    'applies_to' target=TargetRef;

WhyDecl:
    'why' reason=ID;

SummaryDecl:
    'summary' value=STRING;

OwnerDecl:
    'owner' value=ID;

ReviewByDecl:
    'review_by' value=STRING;

StatusDecl:
    'status' value=ID;

ConfidenceDecl:
    'confidence' value=ID;

ProtectsDecl:
    'protects' kind=ID value=ID;

GuardDecl:
    'guards' 'on_change' 'require' requirement=ContextTypeName;

ContextTypeName returns string:
    ID ('<' ID '>')?;

ObservedDecl:
    'observed' ref=SourceRef;

EvidenceLineDecl:
    'evidence' ref=SourceRef;

SatisfiesDecl:
    'satisfies' kind=ContextObjectKind name=ID;

ContextObjectKind returns string:
    'memory' | 'rationale';

OutcomeDecl:
    'outcome' value=ID;

ReviewerDecl:
    'reviewer' value=ID;

ApproverDecl:
    'approver' value=ID;

DecidedOnDecl:
    'decided_on' value=STRING;

QualifiedName returns string:
    ID ('.' ID)*;

terminal ID: /[_a-zA-Z][\w_]*/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
