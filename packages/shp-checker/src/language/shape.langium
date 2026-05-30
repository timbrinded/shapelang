grammar Shape

entry ShapeModule:
    ('module' name=QualifiedName)?
    imports+=ImportDecl*
    declarations+=Declaration*;

Declaration:
    ResourceDecl | TraitDecl | ComponentDecl | RelationDecl | CandidateEffectDecl | ImplementationDecl | BindingDecl | ChangeDecl | AttestationDecl | RuleDecl | RationaleDecl | MemoryDecl | ReevaluationDecl | RoleDecl | PolicyDecl;

RoleDecl:
    'role' name=ID;

PolicyDecl:
    'policy' name=ID
    '{'
        members+=PolicyMember*
    '}';

PolicyMember:
    RequireApproverDecl;

RequireApproverDecl:
    {infer RequireApproverDecl} 'require' 'approver';

ImportDecl:
    'import' path=QualifiedName;

ResourceDecl:
    'resource' name=ID (':' traits+=TypeRef (',' traits+=TypeRef)*)? body=ResourceBody?;

ResourceBody:
    '{' members+=ResourceMember* '}';

ResourceMember:
    StorageDecl | FingerprintDecl;

StorageDecl:
    'storage' provider=QualifiedName '(' value=STRING ')';

FingerprintDecl:
    'fingerprint' provider=QualifiedName '(' value=STRING ')';

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
    TraitAllowDecl | TraitForbidDecl | TraitRequireDecl | RequireContextDecl;

RequireContextDecl:
    'require_context' contextType=ID '<' target=ID '>'
        ('satisfied_by' satisfiedBy+=ContextObjectKind ('or' satisfiedBy+=ContextObjectKind)*)?;

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
    RelationKindDecl | RelationConnectsDecl | RelationRolesDecl | RelationFingerprintExpectationDecl | RelationSummaryDecl;

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

RelationFingerprintExpectationDecl:
    'expects' endpoint=RelationEndpoint 'fingerprint' provider=QualifiedName '(' value=STRING ')';

RelationSummaryDecl:
    'summary' value=STRING;

CandidateEffectDecl:
    'effect' 'candidate' name=ID
    '{'
        members+=CandidateEffectMember*
    '}';

CandidateEffectMember:
    CandidateEffectFunctionDecl | CandidateEffectTermDecl | SourceDecl | CandidateEffectConfidenceDecl | CandidateEffectAnchorDecl;

CandidateEffectFunctionDecl:
    'fn' function=QualifiedTargetName;

CandidateEffectTermDecl:
    'effect' term=EffectTerm;

CandidateEffectConfidenceDecl:
    'confidence' value=ID;

CandidateEffectAnchorDecl:
    'pin' target=TypeRef 'fingerprint' provider=QualifiedName '(' value=STRING ')';

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
    name=QualifiedTargetName;

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
    'add' 'fn' target=FunctionTargetName
        shapeTraits=ShapeTraitList?
        source=SourceDecl?
        description=DescriptionDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;

ModifyFunctionChange:
    'modify' 'fn' target=FunctionTargetName
        shapeTraits=ShapeTraitList?
        transforms=TransformDecl?
        source=SourceDecl?
        description=DescriptionDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;

TransformDecl:
    'transform' labels+=ID (',' labels+=ID)*;

RemoveFunctionChange:
    'remove' 'fn' target=FunctionTargetName;

AddDeclarationChange:
    'add' declaration=AddableDeclaration;

ModifyDeclarationChange:
    'modify' declaration=AddableDeclaration;

RemoveDeclarationChange:
    'remove' kind=RemovableDeclarationKind name=QualifiedTargetName;

AddableDeclaration:
    ResourceDecl | TraitDecl | ComponentDecl | RelationDecl | ImplementationDecl | BindingDecl | AttestationDecl | RuleDecl;

RemovableDeclarationKind returns string:
    'resource' | 'trait' | 'component' | 'relation' | 'implementation' | 'binding' | 'rule';

RuleDecl:
    'rule' name=ID
    '{'
        members+=RuleMember*
    '}';

RuleMember:
    RuleWhenHasDecl | RuleForbidEffectDecl | RuleForbidProvidesDecl | RuleForbidHypercycleDecl;

RuleWhenHasDecl:
    'when' subject=ID 'has' trait=QualifiedTargetName;

RuleForbidEffectDecl:
    'forbid' final?='final'? pattern=EffectPattern;

RuleForbidProvidesDecl:
    'forbid' 'provides' target=TypeRef ('except' except=QualifiedTargetName)?;

RuleForbidHypercycleDecl:
    'forbid' 'hypercycle' ('over' kinds+=RelationKindName ('or' kinds+=RelationKindName)*)?;

RationaleDecl:
    'rationale' name=ID ':' contextType=ContextTypeRef
    '{'
        members+=RationaleMember*
    '}';

RationaleMember:
    AppliesToDecl | WhyDecl | SummaryDecl | OwnerDecl | ReviewByDecl | ProtectsDecl | GuardDecl | EvidenceLineDecl | ProtectsBlock | GuardsBlock | WhoBlock | WhenBlock;

MemoryDecl:
    'memory' name=ID ':' contextType=ContextTypeRef
    '{'
        members+=MemoryMember*
    '}';

MemoryMember:
    AppliesToDecl | StatusDecl | ConfidenceDecl | ProtectsDecl | GuardDecl | ObservedDecl | SummaryDecl | OwnerDecl | ReviewByDecl | EvidenceLineDecl | SensitiveDecl | ProtectsBlock | GuardsBlock | WhoBlock | WhenBlock;

SensitiveDecl:
    {infer SensitiveDecl} 'sensitive';

ProtectsBlock:
    'protects' '{' (entries+=ProtectsEntry (',' entries+=ProtectsEntry)*)? '}';

ProtectsEntry:
    kind=ProtectsPropertyKind (value=ID)?;

GuardsBlock:
    'guards' '{' entries+=GuardEntry* '}';

GuardEntry:
    'on_change' 'require' requirement=ContextTypeName
  | 'forbid' 'transform' forbiddenTransform=ID;

WhoBlock:
    'who' '{' owner=OwnerDecl? '}';

WhenBlock:
    'when' '{' date=ReviewByDecl? '}';

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
    ID ('.' ID)* ('::' ID ('.' ID)*)?;

FunctionTargetName returns string:
    ID ('.' ID)* '::' ID '.' ID | ID '.' ID;

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
    'protects' kind=ProtectsPropertyKind (value=ID)?;

ProtectsPropertyKind returns string:
    'description' | ID;

GuardDecl:
    'guards' (
        'on_change' 'require' requirement=ContextTypeName
      | 'forbid' 'transform' forbiddenTransform=ID
    );

ContextTypeName returns string:
    ID ('<' ID '>')?;

ObservedDecl:
    'observed' ref=SourceRef;

EvidenceLineDecl:
    'evidence' ref=SourceRef;

SatisfiesDecl:
    'satisfies' kind=ContextObjectKind name=QualifiedTargetName;

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
