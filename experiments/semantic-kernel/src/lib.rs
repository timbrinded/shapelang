use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;
use std::error::Error;
use std::fmt::{Display, Formatter};

pub const KERNEL_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KernelRequestV1 {
    pub schema_version: u32,
    pub facts: Vec<KernelFactV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum KernelFactV1 {
    #[serde(rename = "resource")]
    Resource {
        name: String,
        provenance: Provenance,
    },
    #[serde(rename = "resource_fingerprint", rename_all = "camelCase")]
    ResourceFingerprint {
        resource: String,
        provider: String,
        value: String,
        provenance: Provenance,
    },
    #[serde(rename = "candidate_effect", rename_all = "camelCase")]
    CandidateEffect {
        name: String,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_string",
            skip_serializing_if = "Option::is_none"
        )]
        anchor: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_string",
            skip_serializing_if = "Option::is_none"
        )]
        fingerprint_provider: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_string",
            skip_serializing_if = "Option::is_none"
        )]
        fingerprint_value: Option<String>,
        provenance: Provenance,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provenance {
    #[serde(
        default,
        deserialize_with = "deserialize_optional_string",
        skip_serializing_if = "Option::is_none"
    )]
    pub file_path: Option<String>,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KernelResponseV1 {
    pub schema_version: u32,
    pub ok: bool,
    pub diagnostics: Vec<KernelDiagnosticV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum KernelDiagnosticV1 {
    #[serde(
        rename = "candidate_pin_fingerprint_mismatch",
        rename_all = "camelCase"
    )]
    CandidatePinFingerprintMismatch {
        candidate_effect: String,
        anchor: String,
        provider: String,
        expected: String,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_string",
            skip_serializing_if = "Option::is_none"
        )]
        actual: Option<String>,
        causes: Vec<DiagnosticCause>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticCause {
    pub role: DiagnosticCauseRole,
    pub provenance: Provenance,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticCauseRole {
    CandidateEffect,
    Anchor,
    ActualFingerprint,
}

fn deserialize_optional_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    String::deserialize(deserializer).map(Some)
}

#[derive(Debug)]
pub enum KernelError {
    Decode(serde_json::Error),
    DuplicateFactIdentity {
        kind: &'static str,
        identity: String,
    },
    Encode(serde_json::Error),
    UnsupportedSchemaVersion(u32),
}

impl Display for KernelError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Decode(error) => write!(formatter, "invalid kernel request: {error}"),
            Self::DuplicateFactIdentity { kind, identity } => {
                write!(
                    formatter,
                    "duplicate kernel fact identity for {kind}: {identity}"
                )
            }
            Self::Encode(error) => write!(formatter, "failed to encode kernel response: {error}"),
            Self::UnsupportedSchemaVersion(version) => {
                write!(
                    formatter,
                    "unsupported kernel schema version {version}; expected {KERNEL_SCHEMA_VERSION}"
                )
            }
        }
    }
}

impl Error for KernelError {}

pub fn check_json(input: &str) -> Result<String, KernelError> {
    let request: KernelRequestV1 = serde_json::from_str(input).map_err(KernelError::Decode)?;
    let response = check(request)?;
    serde_json::to_string(&response).map_err(KernelError::Encode)
}

pub fn check(request: KernelRequestV1) -> Result<KernelResponseV1, KernelError> {
    if request.schema_version != KERNEL_SCHEMA_VERSION {
        return Err(KernelError::UnsupportedSchemaVersion(
            request.schema_version,
        ));
    }

    validate_fact_identities(&request.facts)?;
    let diagnostics = evaluate_candidate_fingerprint_facts(&request.facts);
    Ok(KernelResponseV1 {
        schema_version: KERNEL_SCHEMA_VERSION,
        ok: diagnostics.is_empty(),
        diagnostics,
    })
}

fn validate_fact_identities(facts: &[KernelFactV1]) -> Result<(), KernelError> {
    let mut resources = BTreeMap::<&str, usize>::new();
    let mut fingerprints = BTreeMap::<(&str, &str), usize>::new();
    let mut candidates = BTreeMap::<&str, usize>::new();

    for fact in facts {
        match fact {
            KernelFactV1::Resource { name, .. } => {
                *resources.entry(name).or_default() += 1;
            }
            KernelFactV1::ResourceFingerprint {
                resource, provider, ..
            } => {
                *fingerprints.entry((resource, provider)).or_default() += 1;
            }
            KernelFactV1::CandidateEffect { name, .. } => {
                *candidates.entry(name).or_default() += 1;
            }
        }
    }

    if let Some((identity, _)) = resources.iter().find(|(_, count)| **count > 1) {
        return Err(KernelError::DuplicateFactIdentity {
            kind: "resource",
            identity: (*identity).to_owned(),
        });
    }
    if let Some(((resource, provider), _)) = fingerprints.iter().find(|(_, count)| **count > 1) {
        return Err(KernelError::DuplicateFactIdentity {
            kind: "resource_fingerprint",
            identity: format!("{resource}:{provider}"),
        });
    }
    if let Some((identity, _)) = candidates.iter().find(|(_, count)| **count > 1) {
        return Err(KernelError::DuplicateFactIdentity {
            kind: "candidate_effect",
            identity: (*identity).to_owned(),
        });
    }

    Ok(())
}

fn evaluate_candidate_fingerprint_facts(facts: &[KernelFactV1]) -> Vec<KernelDiagnosticV1> {
    let mut resources = BTreeMap::<&str, &Provenance>::new();
    let mut fingerprints = BTreeMap::<(&str, &str), (&str, &Provenance)>::new();
    let mut candidates = Vec::new();

    for fact in facts {
        match fact {
            KernelFactV1::Resource { name, provenance } => {
                resources.entry(name).or_insert(provenance);
            }
            KernelFactV1::ResourceFingerprint {
                resource,
                provider,
                value,
                provenance,
            } => {
                fingerprints
                    .entry((resource, provider))
                    .or_insert((value, provenance));
            }
            KernelFactV1::CandidateEffect {
                name,
                anchor: Some(anchor),
                fingerprint_provider: Some(provider),
                fingerprint_value: Some(expected),
                provenance,
            } => {
                candidates.push((name, anchor, provider, expected, provenance));
            }
            KernelFactV1::CandidateEffect { .. } => {}
        }
    }

    let mut diagnostics = Vec::new();
    for (candidate, anchor, provider, expected, candidate_provenance) in candidates {
        let Some(anchor_provenance) = resources.get(anchor.as_str()) else {
            continue;
        };
        let actual = fingerprints.get(&(anchor.as_str(), provider.as_str()));
        if actual.is_some_and(|(value, _)| *value == expected) {
            continue;
        }

        let mut causes = vec![
            DiagnosticCause {
                role: DiagnosticCauseRole::CandidateEffect,
                provenance: candidate_provenance.clone(),
            },
            DiagnosticCause {
                role: DiagnosticCauseRole::Anchor,
                provenance: (*anchor_provenance).clone(),
            },
        ];
        if let Some((_, provenance)) = actual {
            causes.push(DiagnosticCause {
                role: DiagnosticCauseRole::ActualFingerprint,
                provenance: (*provenance).clone(),
            });
        }

        diagnostics.push(KernelDiagnosticV1::CandidatePinFingerprintMismatch {
            candidate_effect: candidate.clone(),
            anchor: anchor.clone(),
            provider: provider.clone(),
            expected: expected.clone(),
            actual: actual.map(|(value, _)| (*value).to_owned()),
            causes,
        });
    }

    diagnostics.sort_by(|left, right| diagnostic_sort_key(left).cmp(&diagnostic_sort_key(right)));
    diagnostics
}

fn diagnostic_sort_key(diagnostic: &KernelDiagnosticV1) -> (&str, &str, &str, &str, Option<&str>) {
    match diagnostic {
        KernelDiagnosticV1::CandidatePinFingerprintMismatch {
            candidate_effect,
            anchor,
            provider,
            expected,
            actual,
            ..
        } => (
            candidate_effect,
            anchor,
            provider,
            expected,
            actual.as_deref(),
        ),
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::check_json;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn check_facts_json(input: &str) -> Result<String, JsValue> {
        check_json(input).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}
