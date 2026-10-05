/**
 * Firestore Security Rules Verification Suite ("Dirty Dozen" Payloads)
 * Verifies that all 12 adversarial payloads described in security_spec.md
 * are rejected with PERMISSION_DENIED by firestore.rules.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  docId?: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Submission',
    collection: 'submissions',
    docId: 'user_B',
    operation: 'create',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    payload: { studentUid: 'user_B', score: 20 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self-Privilege Escalation',
    collection: 'admins',
    docId: 'user_A',
    operation: 'create',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    payload: { uid: 'user_A', email: 'studentA@example.com', addedBy: 'user_A' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Spoofing',
    collection: 'examConfig',
    docId: 'current',
    operation: 'update',
    auth: { uid: 'spoof_admin', email: 'aengonmo@gmail.com', email_verified: false },
    payload: { topic: 'Hacked Topic' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Submission',
    collection: 'submissions',
    docId: 'user_A',
    operation: 'create',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    payload: {
      studentUid: 'user_A',
      studentName: 'Student A',
      studentEmail: 'studentA@example.com',
      idDoc: '1098765432',
      examTopic: 'Mantenimiento de PC',
      score: 20,
      totalQuestions: 20,
      percentage: 100,
      passed: true,
      timeSpentSeconds: 300,
      timeFormatted: '05m 00s',
      answersMap: {},
      status: 'completed',
      isAdminOverride: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Single-Attempt Bypass via Update',
    collection: 'submissions',
    docId: 'user_A',
    operation: 'update',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    payload: { score: 20, percentage: 100, passed: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Single-Attempt Bypass via Delete',
    collection: 'submissions',
    docId: 'user_A',
    operation: 'delete',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'PII Horizontal Scraping via Get',
    collection: 'submissions',
    docId: 'user_B',
    operation: 'get',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'PII Blanket List Scraping',
    collection: 'submissions',
    operation: 'list',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Resource Exhaustion / ID Poisoning',
    collection: 'submissions',
    docId: 'invalid$id!with*special*chars',
    operation: 'get',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Temporal Forgery',
    collection: 'submissions',
    docId: 'user_A',
    operation: 'create',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    payload: {
      studentUid: 'user_A',
      submittedAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unauthorized Question Bank Tampering',
    collection: 'questions',
    docId: 'q_1',
    operation: 'update',
    auth: { uid: 'user_A', email: 'studentA@example.com', email_verified: true },
    payload: { correctIndex: 0 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Value Poisoning on ExamConfig',
    collection: 'examConfig',
    docId: 'current',
    operation: 'update',
    auth: { uid: 'admin_1', email: 'aengonmo@gmail.com', email_verified: true },
    payload: { passingScore: 999 },
    expectedResult: 'PERMISSION_DENIED',
  },
];
