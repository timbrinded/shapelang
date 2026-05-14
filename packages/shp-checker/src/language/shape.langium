grammar Shape

entry ShapeModule:
    ('module' name=QualifiedName)?
    imports+=ImportDecl*
    declarations+=Declaration*;

Declaration:
    ResourceDecl | TraitDecl | ComponentDecl | ImplementationDecl | ChangeDecl | AttestationDecl | RuleDecl;

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
    OwnsDecl | GrantsDecl | RequiresDecl | ProvidesDecl | FunctionSummary;

OwnsDecl:
    'owns' resource=TypeRef;

GrantsDecl:
    'grants' term=EffectTerm;

RequiresDecl:
    'requires' target=TypeRef ('via' relation=ID)?;

ProvidesDecl:
    'provides' target=TypeRef;

FunctionSummary:
    'fn' name=ID
        source=SourceDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;

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
        source=SourceDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;

ModifyFunctionChange:
    'modify' 'fn' component=ID '.' name=ID
        source=SourceDecl?
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
    ResourceDecl | TraitDecl | ComponentDecl | ImplementationDecl | AttestationDecl | RuleDecl;

RemovableDeclarationKind returns string:
    'resource' | 'trait' | 'component' | 'implementation' | 'rule';

RuleDecl:
    'rule' name=ID typeParams=TypeParamList?
    '{'
        members+=RuleMember*
    '}';

RuleMember:
    RuleWhenHasDecl | RuleForbidEffectDecl | RuleForbidProvidesDecl | RuleForbidCycleDecl;

RuleWhenHasDecl:
    'when' subject=ID 'has' trait=ID;

RuleForbidEffectDecl:
    'forbid' final?='final'? pattern=EffectPattern;

RuleForbidProvidesDecl:
    'forbid' 'provides' target=TypeRef ('except' except=ID)?;

RuleForbidCycleDecl:
    'forbid' 'cycle' 'over' relation=RelationName ('where' 'includes' relationKinds+=ID ('or' relationKinds+=ID)*)?;

RelationName returns string:
    'requires' | ID;

QualifiedName returns string:
    ID ('.' ID)*;

terminal ID: /[_a-zA-Z][\w_]*/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
