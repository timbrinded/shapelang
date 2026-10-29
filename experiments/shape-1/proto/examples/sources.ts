// JSON transcriptions (shape.source.v1) of the worked examples' shapes (examples §1–4, syntax §1).
import type { Decl, SourceDoc } from "../src/source.ts";

export interface Identities {
  sqlEffects: string;
  fastCheck: string;
  reviews: string;
}

export const AUDIT_ACTORS: Decl[] = [
  { decl: "actor", name: "Platform", kind: "team", members: ["alice", "carol"] },
  { decl: "actor", name: "AuditTeam", kind: "team", members: ["bob"] },
  { decl: "actor", name: "alice", kind: "person", identities: ['github("alice")'] },
  { decl: "actor", name: "carol", kind: "person", identities: ['github("carol")'] },
  { decl: "actor", name: "bob", kind: "person", identities: ['github("bob")'] },
  {
    decl: "actor",
    name: "codeAgent",
    kind: "agent",
    operator: "alice",
    identities: ['github("acme-code-agent[bot]")']
  }
];

export interface AuditOptions {
  ids: Identities;
  /** Variant A/C: the agent adds `grants HardDelete<AuditEvent>` */
  grantHardDelete?: boolean;
  /** Variant A/C: the agent declares `unit purgeOldEvents { effects complete { HardDelete<AuditEvent> } }` */
  declarePurge?: boolean;
  /** Variant C: the agent drops `: AppendOnly` */
  dropAppendOnly?: boolean;
  /** weakened observer: `sound absence` only */
  dropPresence?: boolean;
  exceptions?: Decl[];
}

export function auditSource(o: AuditOptions): SourceDoc {
  const grants = [
    "Append<AuditEvent>",
    "Read<AuditEvent>",
    ...(o.grantHardDelete ? ["HardDelete<AuditEvent>"] : [])
  ];
  const units = [
    {
      name: "appendEvent",
      effects: { mode: "complete" as const, atoms: [{ atom: "Append<AuditEvent>" }] }
    },
    ...(o.declarePurge
      ? [
          {
            name: "purgeOldEvents",
            effects: { mode: "complete" as const, atoms: [{ atom: "HardDelete<AuditEvent>" }] }
          }
        ]
      : [])
  ];
  return {
    v: "shape.source.v1",
    lock: [{ name: "std", version: "1.0.0" }],
    modules: [
      {
        module: "audit",
        imports: ["std"],
        file: "shape/audit.shape",
        decls: [
          { decl: "shape", name: "AuditService", owner: "Platform" },
          ...AUDIT_ACTORS,
          {
            decl: "resource",
            name: "AuditEvent",
            attach: o.dropAppendOnly ? [] : [{ name: "AppendOnly" }],
            owner: "AuditTeam",
            tier: "final",
            bind: ['pg.table("audit_events")']
          },
          {
            decl: "component",
            name: "AuditStore",
            owner: "AuditTeam",
            tier: "critical",
            paths: ["src/audit/**/*.ts"],
            grants,
            units
          },
          {
            decl: "law",
            name: "EventsArePreserved",
            template: { name: "HistoryPreserved", args: ["AuditEvent"] },
            on: ["component AuditStore"],
            evidence: { level: "tested", by: ["fastCheck"] }
          },
          {
            decl: "provider",
            name: "sqlEffects",
            produces: ["observation"],
            observes: ['effect(pg.table("*"))'],
            sound: o.dropPresence ? ["absence"] : ["presence", "absence"],
            depsComplete: true,
            identity: o.ids.sqlEffects,
            implementation: {
              digest: "sha256:5a1e0f00c0ffee00000000000000000000000000000000000000000000000231"
            }
          },
          {
            decl: "provider",
            name: "fastCheck",
            produces: ["test"],
            decides: ["template HistoryPreserved"],
            sound: ["presence"],
            identity: o.ids.fastCheck,
            implementation: { paths: ["package.json", "bun.lock", "bunfig.toml"] }
          },
          {
            decl: "provider",
            name: "reviews",
            produces: ["judgment"],
            identity: o.ids.reviews,
            implementation: {
              digest: "sha256:4e1a7000c0ffee00000000000000000000000000000000000000000000000100"
            }
          },
          ...(o.exceptions ?? [])
        ]
      }
    ]
  };
}

export interface IronKvOptions {
  verus: string;
  verusRefines: string;
  danaKey: string;
  exception?: boolean;
}

export function ironkvSource(o: IronKvOptions): SourceDoc {
  return {
    v: "shape.source.v1",
    modules: [
      {
        module: "ironkv",
        imports: ["std"],
        file: "shape/ironkv.shape",
        decls: [
          { decl: "shape", name: "IronKv", owner: "Maintainers" },
          { decl: "actor", name: "Maintainers", kind: "team", members: ["erin", "dana"] },
          { decl: "actor", name: "IronKvTeam", kind: "team", members: ["dana", "frank"] },
          {
            decl: "actor",
            name: "dana",
            kind: "person",
            identities: ['github("dana")', o.danaKey]
          },
          { decl: "actor", name: "erin", kind: "person", identities: ['github("erin")'] },
          { decl: "actor", name: "frank", kind: "person", identities: ['github("frank")'] },
          {
            decl: "actor",
            name: "kvAgent",
            kind: "agent",
            operator: "frank",
            identities: ['github("kv-agent[bot]")']
          },
          {
            decl: "component",
            name: "HostTrusted",
            boundary: true,
            attach: [{ name: "ReviewedSurface" }],
            owner: "IronKvTeam",
            tier: "critical",
            paths: ["ironkv/src/**/*_t.rs"],
            allows: ["external_body", "external", "uninterp"]
          },
          {
            decl: "component",
            name: "DelegationMap",
            owner: "IronKvTeam",
            tier: "critical",
            paths: ["ironkv/src/delegation_map_v.rs"],
            units: [
              { name: "set", bind: 'verus("ironkv/src/delegation_map_v.rs#DelegationMap::set")' }
            ]
          },
          {
            decl: "rule",
            name: "NoHatchesOutsideBoundaries",
            template: { name: "HatchesStayAtBoundaries", args: [] },
            owner: "IronKvTeam",
            tier: "critical"
          },
          {
            decl: "law",
            name: "SetRefinesSpec",
            on: ["unit DelegationMap.set"],
            statement: 'verus("ironkv/src/delegation_map_v.rs#DelegationMap::set")',
            evidence: { level: "proven", by: ["verus"] }
          },
          {
            decl: "law",
            name: "SetContractFaithful",
            on: ["unit DelegationMap.set"],
            informal:
              "The ensures clause of set states the map update the protocol layer relies on.",
            evidence: { judged: true, at: "contract" }
          },
          {
            decl: "provider",
            name: "verus",
            produces: ["proof"],
            decides: ["statements verus"],
            sound: ["presence"],
            depsComplete: true,
            identity: o.verus,
            trusts: [
              ["z3", "4.12.5"],
              ["verus", "dccae1d"]
            ],
            implementation: { paths: ["ironkv/Cargo.toml", "ironkv/Cargo.lock"] }
          },
          {
            decl: "provider",
            name: "verusRefines",
            produces: ["equivalence"],
            decides: ["equivalence"],
            sound: ["presence"],
            identity: o.verusRefines,
            implementation: { paths: ["tools/refines.toml"] }
          },
          ...(o.exception
            ? [
                {
                  decl: "exception" as const,
                  name: "SetAssumeAccepted",
                  waives: ["contradiction" as const, "unestablished" as const],
                  target: "component DelegationMap",
                  for: ['code verus("ironkv/src/delegation_map_v.rs#DelegationMap::set")'],
                  owner: "IronKvTeam",
                  expires: "2026-12-15"
                }
              ]
            : [])
        ]
      }
    ]
  };
}
