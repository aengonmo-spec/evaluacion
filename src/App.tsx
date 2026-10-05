/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  setDoc,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import {
  Clock,
  Shield,
  LogOut,
  LogIn,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Award,
  FileText,
  Lightbulb,
  UserCheck,
  IdCard,
  Mail,
  User,
  Lock,
  X,
} from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  BOOTSTRAPPED_ADMIN_EMAIL,
  sanitizeString,
  sanitizeId,
} from './firebase';
import {
  DEFAULT_EXAM_CONFIG,
  DEFAULT_QUESTIONS,
  ExamConfigRecord,
  QuestionRecord,
  SubmissionRecord,
} from './data/defaultQuestions';
import { AdminDashboard } from './components/AdminDashboard';
import { exportIndividualStudentPDF, formatFirestoreDate } from './utils/exportReports';

interface LocalExamSession {
  studentName: string;
  studentEmail: string;
  idDoc: string;
  startedAtMs: number;
  durationSeconds: number;
  answersMap: Record<string, number>;
  currentIndex: number;
}

const SESSION_STORAGE_KEY = 'certicloud_active_exam_session_v2';

export default function App() {
  // Auth & Admin Password State
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isFirestoreAdmin, setIsFirestoreAdmin] = useState(false);

  // Password-based Admin Access (ADMIN7890)
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [verifiedAdminPassword, setVerifiedAdminPassword] = useState('');
  const [adminLoginError, setAdminLoginError] = useState<string | null>(null);
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);

  // Cloud Data State
  const [examConfig, setExamConfig] = useState<ExamConfigRecord>(DEFAULT_EXAM_CONFIG);
  const [questions, setQuestions] = useState<QuestionRecord[]>(
    DEFAULT_QUESTIONS.map((q) => ({ ...q }))
  );
  const [mySubmission, setMySubmission] = useState<SubmissionRecord | null>(null);
  const [allSubmissions, setAllSubmissions] = useState<SubmissionRecord[]>([]);

  // View Navigation State
  const [currentView, setCurrentView] = useState<'welcome' | 'exam' | 'result' | 'admin'>(
    'welcome'
  );

  // Student Registration Form State
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regIdDoc, setRegIdDoc] = useState('');
  const [regError, setRegError] = useState<string | null>(null);

  // Active Exam Questionnaire State
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, number>>({});
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(DEFAULT_EXAM_CONFIG.timeLimitMinutes * 60);
  const [examStartedAtMs, setExamStartedAtMs] = useState<number | null>(null);
  const [showConfirmSubmitModal, setShowConfirmSubmitModal] = useState(false);
  const [isSubmittingExam, setIsSubmittingExam] = useState(false);

  // 1. Load Cloud State from Server on Boot
  const fetchCloudStore = async () => {
    try {
      const res = await fetch('/api/cloud-data');
      if (res.ok) {
        const data = await res.json();
        if (data.examConfig) setExamConfig(data.examConfig);
        if (Array.isArray(data.questions) && data.questions.length > 0) {
          setQuestions(data.questions);
        }
        if (Array.isArray(data.submissions)) {
          setAllSubmissions(data.submissions);
        }
      }
    } catch (err) {
      console.error('Error loading cloud state:', err);
    }
  };

  useEffect(() => {
    fetchCloudStore();
  }, []);

  // 2. Listen to Firebase Authentication State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        setRegName((prev) => prev || user.displayName || '');
        setRegEmail((prev) => prev || user.email || '');

        const isBootstrapped =
          user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase() &&
          user.emailVerified;

        if (isBootstrapped) {
          setIsFirestoreAdmin(true);
        } else {
          try {
            const adminDoc = await getDoc(doc(db, 'admins', user.uid));
            setIsFirestoreAdmin(adminDoc.exists());
          } catch {
            setIsFirestoreAdmin(false);
          }
        }
      } else {
        setIsFirestoreAdmin(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // 3. Optional Firestore Listeners when Authenticated
  useEffect(() => {
    if (!firebaseUser) return;

    const unsubConfig = onSnapshot(
      doc(db, 'examConfig', 'current'),
      (snap) => {
        if (snap.exists()) {
          setExamConfig(snap.data() as ExamConfigRecord);
        }
      },
      () => {}
    );

    const qQuery = query(collection(db, 'questions'), where('active', '==', true));
    const unsubQuestions = onSnapshot(
      qQuery,
      (snap) => {
        if (!snap.empty) {
          const loaded: QuestionRecord[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<QuestionRecord, 'id'>),
          }));
          loaded.sort((a, b) => (a.order || 0) - (b.order || 0));
          setQuestions(loaded);
        }
      },
      () => {}
    );

    return () => {
      unsubConfig();
      unsubQuestions();
    };
  }, [firebaseUser]);

  // 4. Restore in-progress exam session if student reloads page mid-exam
  useEffect(() => {
    if (mySubmission) return;
    const savedRaw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!savedRaw) return;

    try {
      const saved: LocalExamSession = JSON.parse(savedRaw);
      const elapsedSeconds = Math.floor((Date.now() - saved.startedAtMs) / 1000);
      const remaining = Math.max(saved.durationSeconds - elapsedSeconds, 0);

      setRegName(saved.studentName);
      setRegEmail(saved.studentEmail);
      setRegIdDoc(saved.idDoc);
      setUserAnswers(saved.answersMap || {});
      setCurrentQuestionIndex(saved.currentIndex || 0);
      setExamStartedAtMs(saved.startedAtMs);
      setTimeLeftSeconds(remaining);
      setCurrentView('exam');
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [mySubmission]);

  // 5. Strict Exam Countdown Timer
  useEffect(() => {
    if (currentView !== 'exam' || !examStartedAtMs) return;

    const durationSec = (examConfig.timeLimitMinutes || 30) * 60;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - examStartedAtMs) / 1000);
      const remaining = Math.max(durationSec - elapsed, 0);
      setTimeLeftSeconds(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        handleFinalSubmitExam();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentView, examStartedAtMs, examConfig.timeLimitMinutes]);

  // Handle Admin Password Login (ADMIN7890)
  const handleAdminPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoginError(null);
    const trimmedPassword = adminPasswordInput.trim();

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: trimmedPassword }),
      });

      if (res.ok || trimmedPassword === 'ADMIN7890') {
        setIsAdminUnlocked(true);
        setVerifiedAdminPassword(trimmedPassword);
        setAdminPasswordInput('');
        setShowAdminLoginModal(false);
        await fetchCloudStore();
        setCurrentView('admin');
      } else {
        setAdminLoginError('Contraseña incorrecta. Intenta nuevamente.');
      }
    } catch {
      if (trimmedPassword === 'ADMIN7890') {
        setIsAdminUnlocked(true);
        setVerifiedAdminPassword(trimmedPassword);
        setAdminPasswordInput('');
        setShowAdminLoginModal(false);
        setCurrentView('admin');
      } else {
        setAdminLoginError('Contraseña incorrecta. Intenta nuevamente.');
      }
    }
  };

  const handleOpenAdminPanel = () => {
    if (isAdminUnlocked) {
      setCurrentView(currentView === 'admin' ? (mySubmission ? 'result' : 'welcome') : 'admin');
    } else {
      setAdminPasswordInput('');
      setAdminLoginError(null);
      setShowAdminLoginModal(true);
    }
  };

  const handleGoogleSignIn = async () => {
    setRegError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user) {
        setRegName(cred.user.displayName || '');
        setRegEmail(cred.user.email || '');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'No se pudo completar el inicio de sesión con Google.';
      setRegError(msg);
    }
  };

  const handleSignOut = async () => {
    if (firebaseUser) {
      await signOut(auth);
    }
    setMySubmission(null);
    setRegName('');
    setRegEmail('');
    setRegIdDoc('');
    setRegError(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setCurrentView('welcome');
  };

  const saveLocalProgress = (
    nextAnswers: Record<string, number>,
    nextIdx: number,
    startedMs: number
  ) => {
    const session: LocalExamSession = {
      studentName: regName.trim(),
      studentEmail: regEmail.trim(),
      idDoc: regIdDoc.trim(),
      startedAtMs: startedMs,
      durationSeconds: (examConfig.timeLimitMinutes || 30) * 60,
      answersMap: nextAnswers,
      currentIndex: nextIdx,
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  };

  const handleStartExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);

    const cleanIdDoc = regIdDoc.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanIdDoc || cleanIdDoc.length < 4) {
      setRegError(
        'Ingresa un Documento de Identidad válido (solo letras, números o guiones, mínimo 4 caracteres).'
      );
      return;
    }

    // Refresh cloud submissions to verify single attempt by idDoc
    await fetchCloudStore();
    const existingByDoc = allSubmissions.find(
      (s) => s.idDoc.trim().toLowerCase() === cleanIdDoc.toLowerCase()
    );

    if (existingByDoc) {
      setRegError(
        `El documento de identidad "${cleanIdDoc}" ya registró un intento previo (${formatFirestoreDate(
          existingByDoc.submittedAt
        )}). No se permiten reintentos.`
      );
      return;
    }

    const nowMs = Date.now();
    const totalSec = (examConfig.timeLimitMinutes || 30) * 60;
    setExamStartedAtMs(nowMs);
    setTimeLeftSeconds(totalSec);
    setUserAnswers({});
    setCurrentQuestionIndex(0);
    saveLocalProgress({}, 0, nowMs);
    setCurrentView('exam');
  };

  const handleSelectOption = (questionId: string, optionIdx: number) => {
    const updated = { ...userAnswers, [questionId]: optionIdx };
    setUserAnswers(updated);
    if (examStartedAtMs) {
      saveLocalProgress(updated, currentQuestionIndex, examStartedAtMs);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatDurationHuman = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  };

  const handleFinalSubmitExam = async () => {
    if (isSubmittingExam) return;
    setIsSubmittingExam(true);
    setShowConfirmSubmitModal(false);

    const totalSec = (examConfig.timeLimitMinutes || 30) * 60;
    const spentSec = Math.min(Math.max(totalSec - timeLeftSeconds, 1), 14400);
    const timeFormatted = formatDurationHuman(spentSec);

    let correctCount = 0;
    const sanitizedAnswersMap: Record<string, number> = {};

    questions.forEach((q) => {
      const selected = userAnswers[q.id];
      if (typeof selected === 'number' && selected >= 0 && selected <= 3) {
        sanitizedAnswersMap[q.id] = selected;
        if (selected === q.correctIndex) {
          correctCount++;
        }
      }
    });

    const totalQ = Math.max(questions.length, 1);
    const percentage = Math.round((correctCount / totalQ) * 100);
    const passed = percentage >= (examConfig.passingScore || 70);
    const cleanIdDoc = sanitizeId(regIdDoc, 50);
    const studentUid = firebaseUser?.uid || `stu_${cleanIdDoc}_${Date.now()}`;

    const submissionRecord: SubmissionRecord = {
      id: studentUid,
      studentUid,
      studentName: sanitizeString(regName || firebaseUser?.displayName || 'Estudiante', 150),
      studentEmail: sanitizeString(
        regEmail || firebaseUser?.email || 'estudiante@correo.com',
        150
      ),
      idDoc: cleanIdDoc,
      examTopic: sanitizeString(examConfig.topic, 200),
      score: correctCount,
      totalQuestions: totalQ,
      percentage,
      passed,
      timeSpentSeconds: spentSec,
      timeFormatted: sanitizeString(timeFormatted, 30),
      answersMap: sanitizedAnswersMap,
      status: 'completed',
      submittedAt: new Date().toISOString(),
    };

    try {
      // 1. Save to Cloud Server Store
      const res = await fetch('/api/cloud-data/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission: submissionRecord }),
      });

      if (res.ok) {
        const data = await res.json();
        setMySubmission(data.submission);
        if (Array.isArray(data.submissions)) {
          setAllSubmissions(data.submissions);
        }
      } else {
        setMySubmission(submissionRecord);
        setAllSubmissions((prev) => [submissionRecord, ...prev]);
      }

      // 2. Also sync to Firestore if student is authenticated with Google
      if (firebaseUser) {
        try {
          await setDoc(doc(db, 'submissions', firebaseUser.uid), {
            ...submissionRecord,
            studentUid: firebaseUser.uid,
            submittedAt: serverTimestamp(),
          });
        } catch {
          // Already saved in server cloud store
        }
      }

      localStorage.removeItem(SESSION_STORAGE_KEY);
      setCurrentView('result');
    } catch (err) {
      console.error('Error submitting evaluation:', err);
      setMySubmission(submissionRecord);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setCurrentView('result');
    } finally {
      setIsSubmittingExam(false);
    }
  };

  // Compute Topic Recommendations for Result View
  const getTopicErrors = (sub: SubmissionRecord) => {
    const errors: Record<string, number> = {};
    questions.forEach((q) => {
      const ans = sub.answersMap?.[q.id];
      if (ans !== q.correctIndex) {
        errors[q.topic] = (errors[q.topic] || 0) + 1;
      }
    });
    return errors;
  };

  const activeQuestion = questions[currentQuestionIndex] || questions[0];
  const answeredCount = Object.keys(userAnswers).length;

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-950 text-slate-100">
      {/* 3-ZONE TOP BAR CONTRACT */}
      <header className="bg-slate-900/90 backdrop-blur border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Zone 1: Single Text Wordmark */}
          <button
            type="button"
            onClick={() => {
              if (currentView === 'admin') {
                setCurrentView(mySubmission ? 'result' : 'welcome');
              }
            }}
            className="text-base sm:text-lg font-bold tracking-tight text-white truncate text-left"
          >
            {examConfig.title}
          </button>

          {/* Zone 2: Clean Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <button
              type="button"
              onClick={() => {
                if (currentView !== 'exam') {
                  setCurrentView(mySubmission ? 'result' : 'welcome');
                }
              }}
              className={`hover:text-white transition-colors whitespace-nowrap ${
                currentView !== 'admin'
                  ? 'text-white underline underline-offset-8 decoration-sky-500'
                  : ''
              }`}
            >
              Evaluación
            </button>

            {mySubmission && (
              <button
                type="button"
                onClick={() => setCurrentView('result')}
                className={`hover:text-white transition-colors whitespace-nowrap ${
                  currentView === 'result'
                    ? 'text-white underline underline-offset-8 decoration-sky-500'
                    : ''
                }`}
              >
                Mi Certificado
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenAdminPanel}
              className={`hover:text-white transition-colors whitespace-nowrap ${
                currentView === 'admin'
                  ? 'text-white underline underline-offset-8 decoration-sky-500'
                  : ''
              }`}
            >
              Panel Administrativo
            </button>
          </nav>

          {/* Zone 3: Primary Actions (Timer / Admin Button) */}
          <div className="flex items-center gap-2.5 shrink-0">
            {currentView === 'exam' && (
              <span className="bg-slate-950 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-mono font-semibold text-sky-400 border border-slate-800 flex items-center gap-1.5 tabular-nums whitespace-nowrap">
                <Clock className="w-4 h-4" />
                <span>{formatTimer(timeLeftSeconds)}</span>
              </span>
            )}

            <button
              type="button"
              onClick={handleOpenAdminPanel}
              className="text-xs font-semibold text-slate-300 hover:text-white transition-colors px-3.5 py-2 rounded-lg border border-slate-800 hover:border-sky-500/50 bg-slate-950/60 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5 text-sky-400" />
              <span>{currentView === 'admin' ? 'Vista Alumno' : 'Panel Admin'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT VIEWPORT */}
      <main className="flex-grow w-full">
        {/* ADMIN DASHBOARD VIEW */}
        {currentView === 'admin' && isAdminUnlocked ? (
          <AdminDashboard
            examConfig={examConfig}
            questions={questions}
            submissions={allSubmissions}
            adminPassword={verifiedAdminPassword}
            isFirestoreAdmin={isFirestoreAdmin}
            onSyncCloudState={(next) => {
              if (next.examConfig) setExamConfig(next.examConfig);
              if (next.questions) setQuestions(next.questions);
              if (next.submissions) setAllSubmissions(next.submissions);
            }}
            onClose={() => setCurrentView(mySubmission ? 'result' : 'welcome')}
            onLockAdmin={() => {
              setIsAdminUnlocked(false);
              setVerifiedAdminPassword('');
              setCurrentView(mySubmission ? 'result' : 'welcome');
            }}
          />
        ) : currentView === 'exam' && activeQuestion ? (
          /* VIEW 2: EXAM QUESTIONNAIRE */
          <div className="max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
            {/* Progress & Context Header */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono font-semibold text-sky-400 tabular-nums">
                      Pregunta {currentQuestionIndex + 1} de {questions.length}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{examConfig.topic}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Respondidas: {answeredCount}/{questions.length}
                    </span>
                  </div>
                  <h2 className="text-sm sm:text-base font-semibold text-white mt-1">
                    {activeQuestion.category}
                  </h2>
                </div>

                <div className="text-xs text-slate-300 flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                  <UserCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="truncate max-w-[200px] font-medium">
                    {regName || 'Participante'}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-sky-500 h-full transition-transform duration-200 origin-left"
                  style={{
                    transform: `scaleX(${
                      (currentQuestionIndex + 1) / Math.max(questions.length, 1)
                    })`,
                  }}
                />
              </div>
            </div>

            {/* Question Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
              <h3 className="text-lg sm:text-xl font-semibold text-white leading-relaxed">
                {activeQuestion.question}
              </h3>

              <div className="space-y-3">
                {[
                  activeQuestion.optionA,
                  activeQuestion.optionB,
                  activeQuestion.optionC,
                  activeQuestion.optionD,
                ].map((optText, idx) => {
                  const isSelected = userAnswers[activeQuestion.id] === idx;
                  const letter = String.fromCharCode(65 + idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectOption(activeQuestion.id, idx)}
                      className={`w-full text-left p-4 rounded-xl border transition-colors flex items-start gap-3.5 min-h-[52px] text-sm sm:text-base ${
                        isSelected
                          ? 'bg-sky-950/60 border-sky-500 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-950'
                      }`}
                    >
                      <span
                        className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono font-bold ${
                          isSelected
                            ? 'bg-sky-500 text-white'
                            : 'bg-slate-900 text-slate-400 border border-slate-800'
                        }`}
                      >
                        {letter}
                      </span>
                      <span className="flex-grow pt-0.5 leading-relaxed">{optText}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Responsive Navigation Controls */}
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={currentQuestionIndex === 0}
                  onClick={() => setCurrentQuestionIndex((prev) => Math.max(prev - 1, 0))}
                  className="bg-slate-900 hover:bg-slate-800 text-slate-200 font-semibold px-5 py-3 rounded-xl border border-slate-800 transition-colors flex items-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Anterior</span>
                </button>

                {currentQuestionIndex < questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentQuestionIndex((prev) =>
                        Math.min(prev + 1, questions.length - 1)
                      )
                    }
                    className="bg-sky-600 hover:bg-sky-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors flex items-center gap-2 text-sm whitespace-nowrap"
                  >
                    <span>Siguiente</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowConfirmSubmitModal(true)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors flex items-center gap-2 text-sm whitespace-nowrap"
                  >
                    <span>Finalizar y Enviar</span>
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Question Number Grid Navigator */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-2.5 flex items-center justify-between">
                  <span>Navegador Rápido de Preguntas</span>
                  {answeredCount === questions.length && (
                    <button
                      type="button"
                      onClick={() => setShowConfirmSubmitModal(true)}
                      className="text-emerald-400 hover:underline font-semibold"
                    >
                      Todas respondidas · Enviar ahora
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {questions.map((q, idx) => {
                    const isAnswered = userAnswers[q.id] !== undefined;
                    const isCurrent = idx === currentQuestionIndex;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setCurrentQuestionIndex(idx)}
                        className={`w-9 h-9 rounded-lg text-xs font-mono font-semibold tabular-nums transition-colors flex items-center justify-center ${
                          isCurrent
                            ? 'bg-sky-500 text-white ring-2 ring-sky-400/50'
                            : isAnswered
                            ? 'bg-slate-800 text-sky-400 border border-sky-500/40'
                            : 'bg-slate-950 text-slate-500 border border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : currentView === 'result' && mySubmission ? (
          /* VIEW 3: OFFICIAL CLOUD RESULT REPORT */
          <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 text-center space-y-6">
              <div
                className={`inline-flex p-4 rounded-full ${
                  mySubmission.passed
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-amber-500/10 text-amber-400'
                }`}
              >
                {mySubmission.passed ? (
                  <Award className="w-10 h-10" />
                ) : (
                  <AlertTriangle className="w-10 h-10" />
                )}
              </div>

              <div>
                <div className="text-xs text-slate-400 mb-1">
                  <span>Resultado Oficial Alojado en la Nube</span>
                  <span aria-hidden="true"> · </span>
                  <span>{formatFirestoreDate(mySubmission.submittedAt)}</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white">
                  {mySubmission.passed
                    ? '¡Evaluación Aprobada con Éxito!'
                    : 'Evaluación Finalizada'}
                </h2>
                <p className="text-slate-400 text-sm mt-2 max-w-xl mx-auto">
                  {mySubmission.passed
                    ? `Felicitaciones ${mySubmission.studentName}, has superado satisfactoriamente la evaluación de "${mySubmission.examTopic}".`
                    : `${mySubmission.studentName}, has completado tu única oportunidad para "${mySubmission.examTopic}". Revisa las áreas técnicas recomendadas a continuación.`}
                </p>
              </div>

              {/* Score Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs text-slate-400 block mb-1">Calificación Obtenida</span>
                  <span className="text-2xl sm:text-3xl font-bold text-white font-mono tabular-nums">
                    {mySubmission.score} / {mySubmission.totalQuestions}
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs text-slate-400 block mb-1">Porcentaje Global</span>
                  <span
                    className={`text-2xl sm:text-3xl font-bold font-mono tabular-nums ${
                      mySubmission.passed ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {mySubmission.percentage}%
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs text-slate-400 block mb-1">Tiempo Empleado</span>
                  <span className="text-2xl sm:text-3xl font-bold text-sky-400 font-mono tabular-nums">
                    {mySubmission.timeFormatted}
                  </span>
                </div>
              </div>

              {/* Study Recommendations */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 text-left space-y-3">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Diagnóstico de Competencias y Recomendaciones de Mejora</span>
                </h4>

                {(() => {
                  const topicErrors = getTopicErrors(mySubmission);
                  const errorTopics = Object.keys(topicErrors);
                  if (errorTopics.length === 0) {
                    return (
                      <p className="text-sm text-emerald-400 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>
                          ¡Desempeño impecable! No registraste errores en ninguna categoría del
                          examen.
                        </span>
                      </p>
                    );
                  }
                  return (
                    <ul className="space-y-2 text-xs sm:text-sm text-slate-300">
                      {errorTopics.map((topic) => (
                        <li key={topic} className="flex items-start gap-2.5">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <span>
                            Reforzar conocimientos en: <strong className="text-white">{topic}</strong>{' '}
                            ({topicErrors[topic]} {topicErrors[topic] === 1 ? 'error' : 'errores'}).
                          </span>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => exportIndividualStudentPDF(mySubmission, questions, examConfig)}
                  className="w-full sm:w-auto bg-sky-600 hover:bg-sky-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <FileText className="w-4 h-4" />
                  <span>Descargar Certificado / Reporte en PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3 px-6 rounded-xl border border-slate-700 transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Salir e Iniciar Nuevo Registro</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* VIEW 1: WELCOME & REGISTRATION SCREEN */
          <div className="max-w-xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-sky-400 font-medium">
                  <span>Tema Activo: {examConfig.topic}</span>
                  <span aria-hidden="true">·</span>
                  <span>Aprobación: {examConfig.passingScore}%</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  {examConfig.subtitle}
                </h1>
                <p className="text-slate-400 text-sm leading-relaxed">
                  {examConfig.description}
                </p>
              </div>

              {/* Rules Summary */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs sm:text-sm space-y-2.5 text-slate-300">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">{questions.length} preguntas</strong> de opción
                    múltiple (A, B, C, D) sincronizadas en la nube.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">
                      Única oportunidad por Documento de Identidad:
                    </strong>{' '}
                    Al finalizar y enviar, no podrás volver a realizar la evaluación.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    Tiempo límite estricto:{' '}
                    <strong className="text-white font-mono tabular-nums">
                      {examConfig.timeLimitMinutes} minutos
                    </strong>{' '}
                    (cierre automático si expira).
                  </span>
                </div>
              </div>

              {/* Student Registration Form */}
              <form onSubmit={handleStartExam} className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">
                    Registro de Participante
                  </span>
                  {!firebaseUser ? (
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      className="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1.5"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Autocompletar con Google</span>
                    </button>
                  ) : (
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Cuenta verificada</span>
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Nombre Completo
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Ej. Carlos Mendoza Pérez"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Correo Electrónico
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="Ej. carlos.mendoza@correo.com"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Documento de Identidad
                  </label>
                  <div className="relative">
                    <IdCard className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={regIdDoc}
                      onChange={(e) => setRegIdDoc(e.target.value)}
                      placeholder="Ej. 1098765432"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                {regError && (
                  <div className="bg-red-950/60 border border-red-500/40 text-red-300 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                    <span>{regError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold py-3.5 px-6 rounded-xl shadow-lg shadow-sky-600/20 transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <span>Comenzar Evaluación</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: CONFIRM FINAL EXAM SUBMISSION */}
      {showConfirmSubmitModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 text-center space-y-4 shadow-2xl">
            <div className="inline-flex p-3 bg-amber-500/10 text-amber-400 rounded-full">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h3 className="font-bold text-white text-lg">
              ¿Estás seguro de enviar la evaluación?
            </h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Has respondido <strong className="text-white">{answeredCount}</strong> de{' '}
              <strong className="text-white">{questions.length}</strong> preguntas. Esta acción es
              definitiva: dispones de una única oportunidad y tus resultados quedarán guardados en la
              nube.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmSubmitModal(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl text-xs sm:text-sm transition-colors"
              >
                Revisar Respuestas
              </button>
              <button
                type="button"
                disabled={isSubmittingExam}
                onClick={handleFinalSubmitExam}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-xl text-xs sm:text-sm transition-colors disabled:opacity-50"
              >
                {isSubmittingExam ? 'Enviando...' : 'Sí, Enviar Definitivo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADMIN PASSWORD LOGIN (ADMIN7890) */}
      {showAdminLoginModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
                  <Shield className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white text-base">Panel de Administración</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminLoginModal(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center space-y-1.5 pt-1">
              <div className="inline-flex p-3 bg-sky-500/10 text-sky-400 rounded-full mb-1">
                <Lock className="w-6 h-6" />
              </div>
              <h4 className="text-lg font-bold text-white">Acceso Restringido</h4>
              <p className="text-slate-400 text-xs">
                Introduce la contraseña de administrador para gestionar el tema, el banco de
                preguntas y los reportes de estudiantes.
              </p>
            </div>

            <form onSubmit={handleAdminPasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Contraseña de Administrador
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors font-mono"
                />
              </div>

              {adminLoginError && (
                <div className="text-xs text-red-300 bg-red-950/60 border border-red-500/30 p-3 rounded-xl flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{adminLoginError}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold py-3 rounded-xl shadow-lg shadow-sky-600/20 transition-colors text-sm"
              >
                Acceder al Panel
              </button>
            </form>
          </div>
        </div>
      )}

      {/* QUIET FOOTER */}
      <footer className="border-t border-slate-900 py-5 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>{examConfig.title} · Plataforma de Evaluación en la Nube</span>
          <span>Autenticación Segura y Control de Intento Único</span>
        </div>
      </footer>
    </div>
  );
}
