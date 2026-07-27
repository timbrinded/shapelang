use shape_semantic_kernel::{
    DiagnosticCauseRole, KERNEL_SCHEMA_VERSION, KernelDiagnosticV1, KernelError, KernelFactV1,
    KernelRequestV1, Provenance, check, check_json,
};

const ACTUAL: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXPECTED: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn provenance(label: &str) -> Provenance {
    Provenance {
        file_path: Some("fixture.shape".to_owned()),
        label: label.to_owned(),
    }
}

fn request(actual: Option<&str>, expected: &str) -> KernelRequestV1 {
    let mut facts = vec![
        KernelFactV1::Resource {
            name: "fixture::Anchor".to_owned(),
            provenance: provenance("resource fixture::Anchor"),
        },
        KernelFactV1::CandidateEffect {
            name: "fixture::Candidate".to_owned(),
            anchor: Some("fixture::Anchor".to_owned()),
            fingerprint_provider: Some("ast.semantic_subtree_v1".to_owned()),
            fingerprint_value: Some(expected.to_owned()),
            provenance: provenance("effect candidate fixture::Candidate"),
        },
    ];
    if let Some(value) = actual {
        facts.push(KernelFactV1::ResourceFingerprint {
            resource: "fixture::Anchor".to_owned(),
            provider: "ast.semantic_subtree_v1".to_owned(),
            value: value.to_owned(),
            provenance: provenance("resource fixture::Anchor fingerprint"),
        });
    }
    KernelRequestV1 {
        schema_version: KERNEL_SCHEMA_VERSION,
        facts,
    }
}

#[test]
fn accepts_a_current_candidate_pin() {
    let response = check(request(Some(ACTUAL), ACTUAL)).expect("valid request");
    assert!(response.ok);
    assert!(response.diagnostics.is_empty());
}

#[test]
fn reports_a_stale_candidate_pin_with_ordered_provenance() {
    let response = check(request(Some(ACTUAL), EXPECTED)).expect("valid request");
    assert!(!response.ok);
    let [
        KernelDiagnosticV1::CandidatePinFingerprintMismatch {
            candidate_effect,
            anchor,
            provider,
            expected,
            actual,
            causes,
        },
    ] = response.diagnostics.as_slice()
    else {
        panic!("expected one candidate pin diagnostic");
    };
    assert_eq!(candidate_effect, "fixture::Candidate");
    assert_eq!(anchor, "fixture::Anchor");
    assert_eq!(provider, "ast.semantic_subtree_v1");
    assert_eq!(expected, EXPECTED);
    assert_eq!(actual.as_deref(), Some(ACTUAL));
    assert_eq!(
        causes
            .iter()
            .map(|cause| cause.role)
            .collect::<Vec<DiagnosticCauseRole>>(),
        vec![
            DiagnosticCauseRole::CandidateEffect,
            DiagnosticCauseRole::Anchor,
            DiagnosticCauseRole::ActualFingerprint,
        ]
    );
}

#[test]
fn reports_a_missing_candidate_pin_fingerprint() {
    let response = check(request(None, EXPECTED)).expect("valid request");
    let [KernelDiagnosticV1::CandidatePinFingerprintMismatch { actual, causes, .. }] =
        response.diagnostics.as_slice()
    else {
        panic!("expected one candidate pin diagnostic");
    };
    assert_eq!(actual, &None);
    assert_eq!(causes.len(), 2);
}

#[test]
fn ignores_unpinned_candidates_and_unknown_anchors_like_the_typescript_rule() {
    let mut incomplete = request(Some(ACTUAL), EXPECTED);
    incomplete.facts.push(KernelFactV1::CandidateEffect {
        name: "fixture::Incomplete".to_owned(),
        anchor: None,
        fingerprint_provider: None,
        fingerprint_value: None,
        provenance: provenance("effect candidate fixture::Incomplete"),
    });
    incomplete.facts.push(KernelFactV1::CandidateEffect {
        name: "fixture::UnknownAnchor".to_owned(),
        anchor: Some("fixture::Missing".to_owned()),
        fingerprint_provider: Some("ast.semantic_subtree_v1".to_owned()),
        fingerprint_value: Some(EXPECTED.to_owned()),
        provenance: provenance("effect candidate fixture::UnknownAnchor"),
    });

    let response = check(incomplete).expect("valid request");
    assert_eq!(response.diagnostics.len(), 1);
}

#[test]
fn output_is_independent_of_fact_order() {
    let original = request(Some(ACTUAL), EXPECTED);
    let mut reversed = original.clone();
    reversed.facts.reverse();
    assert_eq!(
        check(original).expect("valid request"),
        check(reversed).expect("valid request")
    );
}

#[test]
fn rejects_unknown_schema_versions_and_fields() {
    let unsupported = check(KernelRequestV1 {
        schema_version: 2,
        facts: Vec::new(),
    });
    assert!(matches!(
        unsupported,
        Err(KernelError::UnsupportedSchemaVersion(2))
    ));

    let unknown_request_field = r#"{"schemaVersion":1,"facts":[],"extra":true}"#;
    assert!(matches!(
        check_json(unknown_request_field),
        Err(KernelError::Decode(_))
    ));

    let unknown_fact_field = r#"{
      "schemaVersion": 1,
      "facts": [{
        "kind": "resource",
        "name": "fixture::Anchor",
        "provenance": {"label": "resource fixture::Anchor"},
        "extra": true
      }]
    }"#;
    assert!(matches!(
        check_json(unknown_fact_field),
        Err(KernelError::Decode(_))
    ));
}

#[test]
fn rejects_null_optional_strings_and_omits_absent_values() {
    let invalid_requests = [
        r#"{"schemaVersion":1,"facts":[{"kind":"resource","name":"fixture::Anchor","provenance":{"filePath":null,"label":"anchor"}}]}"#,
        r#"{"schemaVersion":1,"facts":[{"kind":"candidate_effect","name":"fixture::Candidate","anchor":null,"provenance":{"label":"candidate"}}]}"#,
        r#"{"schemaVersion":1,"facts":[{"kind":"candidate_effect","name":"fixture::Candidate","fingerprintProvider":null,"provenance":{"label":"candidate"}}]}"#,
        r#"{"schemaVersion":1,"facts":[{"kind":"candidate_effect","name":"fixture::Candidate","fingerprintValue":null,"provenance":{"label":"candidate"}}]}"#,
    ];
    for invalid in invalid_requests {
        assert!(matches!(check_json(invalid), Err(KernelError::Decode(_))));
    }

    let mut missing = request(None, EXPECTED);
    for fact in &mut missing.facts {
        match fact {
            KernelFactV1::Resource { provenance, .. }
            | KernelFactV1::ResourceFingerprint { provenance, .. }
            | KernelFactV1::CandidateEffect { provenance, .. } => provenance.file_path = None,
        }
    }
    let request_json = serde_json::to_string(&missing).expect("request serializes");
    assert!(!request_json.contains("filePath"));
    let response_json = check_json(&request_json).expect("request is valid");
    assert!(!response_json.contains("filePath"));
    assert!(!response_json.contains("\"actual\""));
}

#[test]
fn rejects_duplicate_fact_identities() {
    let mut duplicate = request(Some(ACTUAL), EXPECTED);
    duplicate.facts.push(KernelFactV1::Resource {
        name: "fixture::Anchor".to_owned(),
        provenance: provenance("duplicate resource fixture::Anchor"),
    });
    let mut reordered = duplicate.clone();
    reordered.facts.reverse();

    assert!(matches!(
        check(duplicate.clone()),
        Err(KernelError::DuplicateFactIdentity {
            kind: "resource",
            ..
        })
    ));
    assert_eq!(
        check(duplicate)
            .expect_err("duplicate must fail")
            .to_string(),
        check(reordered)
            .expect_err("reordered duplicate must fail")
            .to_string()
    );
}
