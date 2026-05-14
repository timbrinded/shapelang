grammar Shape

entry ShapeModule:
    ('module' name=QualifiedName)?
    declarations+=Declaration*;

Declaration:
    ResourceDecl | ComponentDecl;

ResourceDecl:
    'resource' name=ID (':' traits+=TypeRef (',' traits+=TypeRef)*)? body=ResourceBody?;

ResourceBody:
    '{' members+=ResourceMember* '}';

ResourceMember:
    StorageDecl;

StorageDecl:
    'storage' provider=QualifiedName '(' value=STRING ')';

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

FunctionSummary:
    'fn' name=ID
        source=SourceDecl?
        effects=EffectsDecl;

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

TypeRef:
    name=ID;

QualifiedName returns string:
    ID ('.' ID)*;

terminal ID: /[_a-zA-Z][\w_]*/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
