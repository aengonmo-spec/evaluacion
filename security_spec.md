# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Global Default Deny**: Any path not explicitly matched (`/admins/{adminId}`, `/examConfig/{configId}`, `/questions/{questionId}`, `/submissions/{userId}`) must be rejected unconditionally.
2. **Verified Authentication Requirement**: Every read and write operation requires a signed-in user with `request.auth.token.email_verified == true`.
3. **Admin Privilege Invariant**: Only bootstrapped admin (`aengonmo@gmail.com` with `email_verified == true`) or users with an existing document at `/databases/$(database)/documents/admins/$(request.auth.uid)` are recognized as `isAdmin()`. No user can self-assign admin status.
4. **Single-Attempt Submission Invariant**: A student can only create a submission at `/submissions/$(request.auth.uid)` where `studentUid == request.auth.uid` and `status == 'completed'`. Once created, a non-admin student can NEVER update or delete their submission (`Terminal State Locking`).
5. **PII Isolation Invariant**: `/submissions/{userId}` contains student PII (`studentName`, `studentEmail`, `idDoc`). Reading (`get` or `list`) `/submissions/{userId}` is strictly restricted to the document owner (`request.auth.uid == userId` / `resource.data.studentUid == request.auth.uid`) or `isAdmin()`.
6. **Question Bank & Config Integrity**: Only `isAdmin()` can create, update, or delete `/examConfig/{configId}` and `/questions/{questionId}`. All string fields and document IDs are strictly size-bounded and regex-guarded (`isValidId`).
7. **Temporal Integrity**: All timestamp fields (`createdAt`, `updatedAt`, `submittedAt`) must strictly equal `request.time`.

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Identity Spoofing on Submission)**: Student `user_A` attempts to create `/submissions/user_B` with `studentUid: "user_B"`. -> `PERMISSION_DENIED`
2. **Payload 2 (Self-Privilege Escalation)**: Student `user_A` attempts to create `/admins/user_A` to grant themselves admin privileges. -> `PERMISSION_DENIED`
3. **Payload 3 (Unverified Email Spoofing)**: Attacker with unverified email `aengonmo@gmail.com` (`email_verified: false`) attempts to update `/examConfig/current`. -> `PERMISSION_DENIED`
4. **Payload 4 (Shadow Field Injection on Submission)**: Student sends valid submission payload plus ghost field `"isAdminOverride": true`. -> `PERMISSION_DENIED`
5. **Payload 5 (Single-Attempt Bypass / Re-submission Update)**: Student `user_A` attempts to `update` their existing `/submissions/user_A` document to change `score` from `5` to `20`. -> `PERMISSION_DENIED`
6. **Payload 6 (Single-Attempt Bypass / Deletion)**: Student `user_A` attempts to `delete` `/submissions/user_A` to retake the exam. -> `PERMISSION_DENIED`
7. **Payload 7 (PII Horizontal Scraping via Get)**: Student `user_A` attempts `get` on `/submissions/user_B`. -> `PERMISSION_DENIED`
8. **Payload 8 (PII Blanket List Scraping)**: Student `user_A` attempts an unfiltered `list` query on `/submissions` without `where('studentUid', '==', 'user_A')`. -> `PERMISSION_DENIED`
9. **Payload 9 (Resource Exhaustion / ID Poisoning)**: User attempts to create a document with a 500-character ID or special characters `../admin`. -> `PERMISSION_DENIED`
10. **Payload 10 (Temporal Forgery)**: Student submits `/submissions/user_A` with a past or future client timestamp (`submittedAt != request.time`). -> `PERMISSION_DENIED`
11. **Payload 11 (Unauthorized Question Bank Tampering)**: Student attempts to update `correctIndex` in `/questions/q1`. -> `PERMISSION_DENIED`
12. **Payload 12 (Value Poisoning on ExamConfig)**: Admin attempts to update `passingScore` in `/examConfig/current` with a string `"100%"` or integer `999`. -> `PERMISSION_DENIED`
