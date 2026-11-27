# Invitation Draft: Independent Security Specialist

**Recipient:** [Nominate only after written authority verification]

Subject: PARMAR independent Security review request

Please review the attached baseline for independent Security approval. Your
scope is limited to identity proof, threat and abuse controls, trust boundaries,
audit integrity, SQL/schema trust, workflow and Environment bypass paths,
session revocation and protected-operation fencing.

Required expertise: independent application security and identity/security
architecture review, including threat modeling and SQLite/authorization failure
modes. Independence: you must not have implemented or materially directed this
work, may not approve your own change and must disclose employment, financial,
reporting or implementation conflicts.

Artifacts: Security package
`.github/approval/review-packages/security.md`; exact worktree SHA-256 values
under `roles.Security` in
`.github/approval/specialist-handoff-artifacts.json`.

These are review-candidate digests, not approval evidence. Verify them against
the current worktree and rebind to the exact reviewed commit before submitting
an approval record.

Required decision format: submit `APPROVED`, `REJECTED` or `NEEDS_CHANGES`,
rationale, evidence, UTC timestamp, conflicts, conditions, limitations,
expiry/supersession intent and a GitHub submitted review tied to the exact
commit. Do not rely on an issue comment or ordinary code comment.

Submission: use the procedure in
`.github/approval/SPECIALIST-ONBOARDING.md`. No approval is granted until GitHub
identity, immutable user ID, affiliation and authority are independently
verified.
