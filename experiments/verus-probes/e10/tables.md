### Mutation score per operator (primary universe, full enumeration)

| Operator | Generated | Run | Killed | Survived | Anomalies | Score | Killing diagnostics |
|---|---:|---:|---:|---:|---:|---:|---|
| M1 | 79415 | 79415 | 78388 | 1027 | 0 | 98.7% | missing grant 78388 |
| M2 | 181 | 181 | 179 | 2 | 0 | 98.9% | missing grant 179 |
| M3 | 502 | 502 | 172 | 330 | 0 | 34.3% | forbidden hypercycle 148, forbidden path 68 |
| M4 | 1876 | 1876 | 322 | 1554 | 0 | 17.2% | forbidden provides 322 |

### Secondary strata (seeded samples, seed 7)

| Stratum | Sampled | Killed | Survived | Anomalies | Score | Killing diagnostics |
|---|---:|---:|---:|---:|---:|---|
| M1gen | 1000 | 1000 | 0 | 0 | 100.0% | missing grant 1000 |
| M3gen | 60 | 0 | 60 | 0 | 0.0% |  |
| M4gen | 60 | 0 | 60 | 0 | 0.0% |  |

### Probes (not scored)

| Probe | Run | Killed | Survived | Anomalies |
|---|---:|---:|---:|---:|
| M5probe | 37 | 1 | 36 | 0 |
| HOprobe | 237 | 0 | 237 | 0 |
| HOcontrol | 79 | 79 | 0 | 0 |

### M1 by effect name

| Effect | Killed | Survived |
|---|---:|---:|
| Append | 7748 | 139 |
| DropStorage | 7979 | 0 |
| Export | 7979 | 0 |
| HardDelete | 7979 | 0 |
| Import | 7979 | 0 |
| LogicalDelete | 7979 | 0 |
| Read | 7045 | 687 |
| Redact | 7979 | 0 |
| Truncate | 7979 | 0 |
| Update | 7742 | 201 |

### Kills per claim

| Claim | Type | Kills (total) | By operator | Unique kills |
|---|---|---:|---|---:|
| `component CiPipeline` | component grant boundary | 12870 | M1 12835, M2 35 | 12870 |
| `component DocsShapeBlockVerifier` | component grant boundary | 790 | M1 787, M2 3 | 790 |
| `component DocsSite` | component grant boundary | 789 | M1 788, M2 1 | 789 |
| `component ExperimentalSemanticKernel` | component grant boundary | 2358 | M1 2352, M2 6 | 2358 |
| `component ExperimentalSemanticKernelHarness` | component grant boundary | 2358 | M1 2352, M2 6 | 2358 |
| `component ReleasePipeline` | component grant boundary | 2362 | M1 2358, M2 4 | 2362 |
| `component ShapeAnalyzer` | component grant boundary | 1575 | M1 1570, M2 5 | 1575 |
| `component ShapeAstGenerator` | component grant boundary | 5470 | M1 5460, M2 10 | 5470 |
| `component ShapeAuthoring` | component grant boundary | 4680 | M1 4668, M2 12 | 4680 |
| `component ShapeBindings` | component grant boundary | 790 | M1 784, M2 6 | 790 |
| `component ShapeChecker` | component grant boundary | 5476 | M1 5467, M2 9 | 5476 |
| `component ShapeDiagnostics` | component grant boundary | 1578 | M1 1576, M2 2 | 1578 |
| `component ShapeEditorServices` | component grant boundary | 4710 | M1 4704, M2 6 | 4710 |
| `component ShapeFormatter` | component grant boundary | 790 | M1 787, M2 3 | 790 |
| `component ShapeGrammar` | component grant boundary | 1576 | M1 1572, M2 4 | 1576 |
| `component ShapeIncrementalChecker` | component grant boundary | 790 | M1 779, M2 11 | 790 |
| `component ShapeLanguageServer` | component grant boundary | 790 | M1 788, M2 2 | 790 |
| `component ShapeModelLowerer` | component grant boundary | 5476 | M1 5467, M2 9 | 5476 |
| `component ShapeModuleResolver` | component grant boundary | 790 | M1 788, M2 2 | 790 |
| `component ShapeParser` | component grant boundary | 790 | M1 787, M2 3 | 790 |
| `component ShapePreludeRegistry` | component grant boundary | 1578 | M1 1576, M2 2 | 1578 |
| `component ShapeRuleEngine` | component grant boundary | 11709 | M1 11700, M2 9 | 11709 |
| `component ShapeStringHelpers` | component grant boundary | 1578 | M1 1576, M2 2 | 1578 |
| `component ShpCli` | component grant boundary | 6894 | M1 6867, M2 27 | 6894 |
| `rule no_runtime_dependency_cycles forbids hypercycle over calls` | rule:forbid hypercycle | 148 | M3 148 | 104 |
| `rule ExperimentalSemanticKernelIsolation forbids path ShapeChecker -> ExperimentalSemanticKernel over calls` | rule:forbid path | 40 | M3 40 | 0 |
| `rule ExperimentalSemanticKernelIsolation forbids path ShapeEditorServices -> ExperimentalSemanticKernel over calls` | rule:forbid path | 48 | M3 48 | 0 |
| `rule ExperimentalSemanticKernelIsolation forbids path ShpCli -> ExperimentalSemanticKernel over calls` | rule:forbid path | 68 | M3 68 | 10 |
| `rule checker_contract_providers forbids provides EffectiveShapeModel` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule checker_contract_providers forbids provides HumanReadableDiagnostics` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule checker_contract_providers forbids provides MachineReadableShapeModel` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule checker_contract_providers forbids provides NormalizedShapeReference` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule checker_contract_providers forbids provides PreludeMetadata` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule checker_contract_providers forbids provides SemanticDiagnosticSet` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule checker_contract_providers forbids provides ShapeConformance` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule checker_contract_providers forbids provides ShapeFacts` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule grammar_contract_providers forbids provides GeneratedAstContract` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule grammar_contract_providers forbids provides ParsedShapeModule` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule grammar_contract_providers forbids provides ShapeLanguageDefinition` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule tooling_contract_providers forbids provides CanonicalShapeFormat` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule tooling_contract_providers forbids provides CommandLineInterface` | rule:forbid provides | 23 | M4 23 | 23 |
| `rule tooling_contract_providers forbids provides LanguageServerProtocol` | rule:forbid provides | 23 | M4 23 | 23 |

### M3 survivors by structural class

| Class | Killed | Survived |
|---|---:|---:|
| shortcut (source already reaches target transitively) | 0 | 98 |
| new coupling (neither reaches the other) | 24 | 232 |
| back-edge (target already reaches source) | 148 | 0 |

### M4 by target class

| Class | Killed | Survived |
|---|---:|---:|
| owner provides its own resource | 0 | 39 |
| unowned, unprovided resource | 0 | 480 |
| second provider for a resource that already has a declared provider (no exclusivity rule) | 0 | 138 |
| non-owner provides an owned resource with no declared provider | 0 | 897 |
| target under forbid provides | 322 | 0 |

### M3 by module pair (source module -> target module)

| Module pair | Killed | Survived |
|---|---:|---:|
| shape.checker -> shape.checker | 23 | 19 |
| shape.checker -> shape.checker.incremental | 8 | 0 |
| shape.checker -> shape.delivery | 16 | 8 |
| shape.checker -> shape.language | 0 | 23 |
| shape.checker -> shape.runtime | 16 | 0 |
| shape.checker -> shape.tooling | 29 | 27 |
| shape.checker.incremental -> shape.checker | 0 | 5 |
| shape.checker.incremental -> shape.delivery | 0 | 3 |
| shape.checker.incremental -> shape.language | 0 | 2 |
| shape.checker.incremental -> shape.runtime | 0 | 2 |
| shape.checker.incremental -> shape.tooling | 0 | 7 |
| shape.delivery -> shape.checker | 0 | 24 |
| shape.delivery -> shape.checker.incremental | 0 | 3 |
| shape.delivery -> shape.delivery | 1 | 4 |
| shape.delivery -> shape.language | 0 | 7 |
| shape.delivery -> shape.runtime | 0 | 4 |
| shape.delivery -> shape.tooling | 0 | 19 |
| shape.language -> shape.checker | 10 | 14 |
| shape.language -> shape.checker.incremental | 2 | 1 |
| shape.language -> shape.delivery | 7 | 2 |
| shape.language -> shape.language | 3 | 1 |
| shape.language -> shape.runtime | 4 | 2 |
| shape.language -> shape.tooling | 10 | 11 |
| shape.runtime -> shape.checker | 0 | 15 |
| shape.runtime -> shape.checker.incremental | 0 | 2 |
| shape.runtime -> shape.delivery | 4 | 2 |
| shape.runtime -> shape.language | 0 | 6 |
| shape.runtime -> shape.runtime | 1 | 0 |
| shape.runtime -> shape.tooling | 0 | 14 |
| shape.tooling -> shape.checker | 0 | 47 |
| shape.tooling -> shape.checker.incremental | 0 | 7 |
| shape.tooling -> shape.delivery | 14 | 7 |
| shape.tooling -> shape.language | 0 | 18 |
| shape.tooling -> shape.runtime | 14 | 0 |
| shape.tooling -> shape.tooling | 10 | 24 |

### Grants: vacuous (M2 survivor) and most-masking

| Grant | M2 | Dependent effect entries | M1 mutants it masks |
|---|---|---:|---:|
| `ShapeRuleEngine grants Update<ShapeHypergraph>` | survived | 0 | 15 |
| `DocsSite grants Update<DocsContent>` | survived | 0 | 1 |
| `CiPipeline grants Read<CommandLineInterface>` | killed | 1 | 16 |
| `CiPipeline grants Read<DocsContent>` | killed | 6 | 16 |
| `CiPipeline grants Read<ExperimentalKernelDiagnosticSet>` | killed | 1 | 16 |
| `CiPipeline grants Read<ExperimentalKernelEnvelope>` | killed | 1 | 16 |
| `CiPipeline grants Read<GeneratedAstManifest>` | killed | 1 | 16 |
| `CiPipeline grants Read<NativeParserAsset>` | killed | 2 | 16 |
| `CiPipeline grants Read<PluginPackageManifest>` | killed | 2 | 16 |
| `CiPipeline grants Read<PullRequestStatusComment>` | killed | 1 | 16 |
| `CiPipeline grants Read<ShapeModelDraft>` | killed | 2 | 16 |
| `CiPipeline grants Update<ChangeBaseRevision>` | killed | 1 | 16 |
| `CiPipeline grants Update<ChangedFileList>` | killed | 1 | 16 |
| `CiPipeline grants Update<ExperimentalKernelWasmArtifact>` | killed | 1 | 16 |
| `CiPipeline grants Update<GeneratedAstManifest>` | killed | 1 | 16 |

M1 survivors by component: {'CiPipeline': 514, 'ShpCli': 206, 'ShapeRuleEngine': 108, 'ShapeAuthoring': 40, 'ShapeChecker': 37, 'ShapeAstGenerator': 34, 'ShapeModelLowerer': 32, 'ShapeEditorServices': 21, 'ExperimentalSemanticKernel': 9, 'ExperimentalSemanticKernelHarness': 8, 'ReleasePipeline': 5, 'ShapeAnalyzer': 5, 'ShapeGrammar': 4, 'ShapePreludeRegistry': 2, 'DocsSite': 1, 'ShapeDiagnostics': 1}
