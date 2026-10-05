import React, { useState, useRef } from 'react';
import {
  doc,
  writeBatch,
  serverTimestamp,
  deleteDoc,
  setDoc,
} from 'firebase/firestore';
import {
  FileSpreadsheet,
  FileText,
  Download,
  Upload,
  Sparkles,
  Trash2,
  Eye,
  Plus,
  RotateCcw,
  Search,
  CheckCircle2,
  AlertTriangle,
  X,
  Edit3,
  Save,
  BookOpen,
  Settings,
  Lock,
} from 'lucide-react';
import {
  db,
  auth,
  sanitizeString,
  sanitizeId,
} from '../firebase';
import {
  ExamConfigRecord,
  QuestionRecord,
  SubmissionRecord,
  DEFAULT_QUESTIONS,
  DEFAULT_EXAM_CONFIG,
  TOPIC_PRESETS,
} from '../data/defaultQuestions';
import {
  exportSubmissionsToExcel,
  exportSubmissionsToPDF,
  exportSubmissionsToCSV,
  exportIndividualStudentPDF,
  exportQuestionsToCSV,
  downloadCSVTemplate,
  parseQuestionsCSV,
  formatFirestoreDate,
} from '../utils/exportReports';

interface AdminDashboardProps {
  examConfig: ExamConfigRecord;
  questions: QuestionRecord[];
  submissions: SubmissionRecord[];
  adminPassword: string;
  isFirestoreAdmin: boolean;
  onSyncCloudState: (next: {
    examConfig?: ExamConfigRecord;
    questions?: QuestionRecord[];
    submissions?: SubmissionRecord[];
  }) => void;
  onClose: () => void;
  onLockAdmin: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  examConfig,
  questions,
  submissions,
  adminPassword,
  isFirestoreAdmin,
  onSyncCloudState,
  onClose,
  onLockAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<'results' | 'topic' | 'questions'>('results');

  // Search & Filter in Results tab
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionRecord | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);

  // Topic & Auto-Generation state
  const [topicForm, setTopicForm] = useState({
    topic: examConfig.topic,
    title: examConfig.title,
    subtitle: examConfig.subtitle,
    description: examConfig.description,
    timeLimitMinutes: examConfig.timeLimitMinutes,
    passingScore: examConfig.passingScore,
    generateCount: questions.length || 20,
  });
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Question Bank & CSV state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [csvMode, setCsvMode] = useState<'replace' | 'append'>('replace');
  const [isUploadingCSV, setIsUploadingCSV] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionRecord | null>(null);
  const [isCreatingQuestion, setIsCreatingQuestion] = useState(false);

  const showMessage = (type: 'success' | 'error', message: string) => {
    setFeedbackBanner({ type, message });
    setTimeout(() => {
      setFeedbackBanner((prev) => (prev?.message === message ? null : prev));
    }, 6000);
  };

  // Filtered submissions
  const filteredSubmissions = submissions.filter((s) => {
    const matchesSearch =
      s.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.studentEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.idDoc.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.examTopic.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;
    if (statusFilter === 'passed') return s.passed;
    if (statusFilter === 'failed') return !s.passed;
    return true;
  });

  // KPI Metrics
  const totalCount = submissions.length;
  const approvedCount = submissions.filter((s) => s.passed).length;
  const failedCount = totalCount - approvedCount;
  const avgPercentage =
    totalCount > 0
      ? Math.round(submissions.reduce((acc, s) => acc + s.percentage, 0) / totalCount)
      : 0;

  // Save only metadata/config to Cloud & Firestore
  const handleSaveTopicMetadataOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    try {
      const nextConfig: ExamConfigRecord = {
        title: sanitizeString(topicForm.title, 200, DEFAULT_EXAM_CONFIG.title),
        subtitle: sanitizeString(topicForm.subtitle, 300, DEFAULT_EXAM_CONFIG.subtitle),
        topic: sanitizeString(topicForm.topic, 200, DEFAULT_EXAM_CONFIG.topic),
        description: sanitizeString(topicForm.description, 1000, DEFAULT_EXAM_CONFIG.description),
        timeLimitMinutes: Math.min(Math.max(Number(topicForm.timeLimitMinutes) || 30, 1), 240),
        passingScore: Math.min(Math.max(Number(topicForm.passingScore) || 70, 1), 100),
        questionCount: Math.min(Math.max(questions.length || 20, 1), 200),
      };

      const res = await fetch('/api/cloud-data/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword,
        },
        body: JSON.stringify({ examConfig: nextConfig }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al guardar la configuración.');
      }

      onSyncCloudState({ examConfig: nextConfig });

      if (auth.currentUser && isFirestoreAdmin) {
        try {
          await setDoc(doc(db, 'examConfig', 'current'), {
            ...nextConfig,
            updatedBy: auth.currentUser.uid,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Already persisted in server cloud store
        }
      }

      showMessage('success', 'Configuración de evaluación guardada correctamente en la nube.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar configuración.';
      showMessage('error', msg);
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Generate questions dynamically based on the selected topic & save to Cloud + Firestore
  const handleGenerateQuestionsByTopic = async () => {
    const targetTopic = topicForm.topic.trim();
    if (!targetTopic) {
      showMessage('error', 'Por favor ingresa un tema válido antes de generar las preguntas.');
      return;
    }

    setIsGeneratingAI(true);
    setFeedbackBanner(null);

    try {
      const response = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: targetTopic,
          count: Math.min(Math.max(Number(topicForm.generateCount) || 20, 5), 40),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.questions || !Array.isArray(data.questions)) {
        throw new Error(data.error || 'No se pudieron generar las preguntas para este tema.');
      }

      const generatedList = data.questions as {
        category: string;
        question: string;
        optionA: string;
        optionB: string;
        optionC: string;
        optionD: string;
        correctIndex: number;
        topic: string;
      }[];

      const newTitle = sanitizeString(
        data.suggestedTitle || `Evaluación Técnica: ${targetTopic}`,
        200
      );
      const newSubtitle = sanitizeString(
        data.suggestedSubtitle || `Certificación en ${targetTopic}`,
        300
      );
      const newDescription = sanitizeString(
        data.suggestedDescription || topicForm.description,
        1000
      );

      const newQuestions: QuestionRecord[] = generatedList.map((q, idx) => ({
        id: `q_${String(idx + 1).padStart(2, '0')}_${Date.now().toString(36)}`,
        order: idx + 1,
        category: sanitizeString(q.category, 150, targetTopic),
        question: sanitizeString(q.question, 1000, 'Pregunta técnica'),
        optionA: sanitizeString(q.optionA, 500, 'Opción A'),
        optionB: sanitizeString(q.optionB, 500, 'Opción B'),
        optionC: sanitizeString(q.optionC, 500, 'Opción C'),
        optionD: sanitizeString(q.optionD, 500, 'Opción D'),
        correctIndex: Math.min(Math.max(Number(q.correctIndex) || 0, 0), 3),
        topic: sanitizeString(q.topic, 250, targetTopic),
        active: true,
      }));

      const nextConfig: ExamConfigRecord = {
        title: newTitle,
        subtitle: newSubtitle,
        topic: sanitizeString(targetTopic, 200),
        description: newDescription,
        timeLimitMinutes: Math.min(Math.max(Number(topicForm.timeLimitMinutes) || 30, 1), 240),
        passingScore: Math.min(Math.max(Number(topicForm.passingScore) || 70, 1), 100),
        questionCount: newQuestions.length,
      };

      // Save to Cloud Server Store
      const saveRes = await fetch('/api/cloud-data/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword,
        },
        body: JSON.stringify({ examConfig: nextConfig, questions: newQuestions }),
      });

      if (!saveRes.ok) {
        throw new Error('Error al sincronizar el nuevo banco de preguntas en la nube.');
      }

      onSyncCloudState({ examConfig: nextConfig, questions: newQuestions });

      // Sync to Firestore if signed in as Firestore Admin
      if (auth.currentUser && isFirestoreAdmin) {
        try {
          const batch = writeBatch(db);
          questions.forEach((q) => {
            batch.delete(doc(db, 'questions', q.id));
          });
          const uid = auth.currentUser.uid;
          newQuestions.forEach((q) => {
            batch.set(doc(db, 'questions', q.id), {
              ...q,
              authorId: uid,
              updatedAt: serverTimestamp(),
            });
          });
          batch.set(doc(db, 'examConfig', 'current'), {
            ...nextConfig,
            updatedBy: uid,
            updatedAt: serverTimestamp(),
          });
          await batch.commit();
        } catch {
          // Server cloud store already updated
        }
      }

      setTopicForm((prev) => ({
        ...prev,
        title: newTitle,
        subtitle: newSubtitle,
        description: newDescription,
      }));

      showMessage(
        'success',
        `Se actualizaron automáticamente ${newQuestions.length} preguntas en la nube para el tema "${targetTopic}".`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al generar preguntas.';
      showMessage('error', msg);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // CSV Upload Handler
  const handleCSVFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingCSV(true);
    try {
      const text = await file.text();
      const parsedItems = await parseQuestionsCSV(text);

      const startOrder = csvMode === 'replace' ? 1 : questions.length + 1;
      const limitedItems = parsedItems.slice(0, 150);

      const importedQuestions: QuestionRecord[] = limitedItems.map((item, idx) => ({
        id: `csv_${String(startOrder + idx).padStart(3, '0')}_${Date.now().toString(36)}`,
        order: startOrder + idx,
        category: sanitizeString(item.category, 150, 'General'),
        question: sanitizeString(item.question, 1000, 'Pregunta'),
        optionA: sanitizeString(item.optionA, 500, 'Opción A'),
        optionB: sanitizeString(item.optionB, 500, 'Opción B'),
        optionC: sanitizeString(item.optionC, 500, 'Opción C'),
        optionD: sanitizeString(item.optionD, 500, 'Opción D'),
        correctIndex: Math.min(Math.max(Number(item.correctIndex) || 0, 0), 3),
        topic: sanitizeString(item.topic, 250, item.category),
        active: true,
      }));

      const finalQuestions =
        csvMode === 'replace' ? importedQuestions : [...questions, ...importedQuestions];

      const nextConfig: ExamConfigRecord = {
        ...examConfig,
        questionCount: finalQuestions.length,
      };

      const res = await fetch('/api/cloud-data/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword,
        },
        body: JSON.stringify({ questions: finalQuestions, examConfig: nextConfig }),
      });

      if (!res.ok) {
        throw new Error('Error al guardar el archivo CSV en la nube.');
      }

      onSyncCloudState({ questions: finalQuestions, examConfig: nextConfig });

      if (auth.currentUser && isFirestoreAdmin) {
        try {
          const batch = writeBatch(db);
          const uid = auth.currentUser.uid;
          if (csvMode === 'replace') {
            questions.forEach((q) => batch.delete(doc(db, 'questions', q.id)));
          }
          importedQuestions.forEach((q) => {
            batch.set(doc(db, 'questions', q.id), {
              ...q,
              authorId: uid,
              updatedAt: serverTimestamp(),
            });
          });
          batch.set(doc(db, 'examConfig', 'current'), {
            ...nextConfig,
            updatedBy: uid,
            updatedAt: serverTimestamp(),
          });
          await batch.commit();
        } catch {
          // Already synced in server cloud store
        }
      }

      showMessage(
        'success',
        `Archivo CSV procesado con éxito: ${importedQuestions.length} preguntas sincronizadas en la base de datos.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al procesar el archivo CSV.';
      showMessage('error', msg);
    } finally {
      setIsUploadingCSV(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Restore Default 20 Hardware Questions
  const handleRestoreDefaults = async () => {
    setIsUploadingCSV(true);
    try {
      const restoredQuestions = DEFAULT_QUESTIONS.map((q) => ({ ...q }));
      const restoredConfig = { ...DEFAULT_EXAM_CONFIG };

      const res = await fetch('/api/cloud-data/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword,
        },
        body: JSON.stringify({ examConfig: restoredConfig, questions: restoredQuestions }),
      });

      if (!res.ok) {
        throw new Error('No se pudo restaurar el banco predeterminado.');
      }

      onSyncCloudState({ examConfig: restoredConfig, questions: restoredQuestions });

      if (auth.currentUser && isFirestoreAdmin) {
        try {
          const batch = writeBatch(db);
          const uid = auth.currentUser.uid;
          questions.forEach((q) => batch.delete(doc(db, 'questions', q.id)));
          restoredQuestions.forEach((q) => {
            batch.set(doc(db, 'questions', q.id), {
              ...q,
              authorId: uid,
              updatedAt: serverTimestamp(),
            });
          });
          batch.set(doc(db, 'examConfig', 'current'), {
            ...restoredConfig,
            updatedBy: uid,
            updatedAt: serverTimestamp(),
          });
          await batch.commit();
        } catch {
          // Already synced in server cloud store
        }
      }

      setTopicForm({
        topic: DEFAULT_EXAM_CONFIG.topic,
        title: DEFAULT_EXAM_CONFIG.title,
        subtitle: DEFAULT_EXAM_CONFIG.subtitle,
        description: DEFAULT_EXAM_CONFIG.description,
        timeLimitMinutes: DEFAULT_EXAM_CONFIG.timeLimitMinutes,
        passingScore: DEFAULT_EXAM_CONFIG.passingScore,
        generateCount: 20,
      });

      showMessage(
        'success',
        'Banco de 20 preguntas originales de Mantenimiento de PC restaurado en la nube.'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al restaurar preguntas.';
      showMessage('error', msg);
    } finally {
      setIsUploadingCSV(false);
    }
  };

  // Save single created/edited question
  const handleSaveSingleQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion) return;

    const qId = isCreatingQuestion
      ? `q_manual_${Date.now().toString(36)}`
      : sanitizeId(editingQuestion.id);

    const savedItem: QuestionRecord = {
      id: qId,
      order: Math.min(Math.max(Number(editingQuestion.order) || questions.length + 1, 1), 500),
      category: sanitizeString(editingQuestion.category, 150, 'General'),
      question: sanitizeString(editingQuestion.question, 1000, 'Pregunta'),
      optionA: sanitizeString(editingQuestion.optionA, 500, 'Opción A'),
      optionB: sanitizeString(editingQuestion.optionB, 500, 'Opción B'),
      optionC: sanitizeString(editingQuestion.optionC, 500, 'Opción C'),
      optionD: sanitizeString(editingQuestion.optionD, 500, 'Opción D'),
      correctIndex: Math.min(Math.max(Number(editingQuestion.correctIndex) || 0, 0), 3),
      topic: sanitizeString(editingQuestion.topic, 250, editingQuestion.category),
      active: true,
    };

    const nextQuestions = isCreatingQuestion
      ? [...questions, savedItem]
      : questions.map((q) => (q.id === qId ? savedItem : q));
    nextQuestions.sort((a, b) => (a.order || 0) - (b.order || 0));

    try {
      await fetch('/api/cloud-data/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword,
        },
        body: JSON.stringify({ questions: nextQuestions }),
      });

      onSyncCloudState({ questions: nextQuestions });

      if (auth.currentUser && isFirestoreAdmin) {
        try {
          await setDoc(doc(db, 'questions', qId), {
            ...savedItem,
            authorId: auth.currentUser.uid,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Already synced in server cloud store
        }
      }

      setEditingQuestion(null);
      setIsCreatingQuestion(false);
      showMessage('success', 'Pregunta guardada correctamente en la base de datos.');
    } catch {
      showMessage('error', 'No se pudo guardar la pregunta.');
    }
  };

  // Delete single question
  const handleDeleteQuestion = async (qId: string) => {
    const nextQuestions = questions.filter((q) => q.id !== qId);
    try {
      await fetch('/api/cloud-data/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword,
        },
        body: JSON.stringify({ questions: nextQuestions }),
      });

      onSyncCloudState({ questions: nextQuestions });

      if (auth.currentUser && isFirestoreAdmin) {
        try {
          await deleteDoc(doc(db, 'questions', qId));
        } catch {
          // Already synced in server cloud store
        }
      }
      showMessage('success', 'Pregunta eliminada del banco en la nube.');
    } catch {
      showMessage('error', 'No se pudo eliminar la pregunta.');
    }
  };

  // Reset single student attempt
  const handleResetStudentAttempt = async (submissionId: string) => {
    try {
      const res = await fetch(`/api/cloud-data/submissions/${encodeURIComponent(submissionId)}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': adminPassword },
      });
      if (res.ok) {
        const data = await res.json();
        onSyncCloudState({ submissions: data.submissions });
      } else {
        onSyncCloudState({
          submissions: submissions.filter((s) => s.id !== submissionId),
        });
      }

      if (auth.currentUser && isFirestoreAdmin) {
        try {
          await deleteDoc(doc(db, 'submissions', submissionId));
        } catch {
          // Already removed from server store
        }
      }

      setConfirmDeleteUserId(null);
      showMessage(
        'success',
        'Intento restablecido. El estudiante puede presentar nuevamente la evaluación.'
      );
    } catch {
      showMessage('error', 'Error al restablecer el intento.');
    }
  };

  // Reset all student attempts
  const handleClearAllSubmissions = async () => {
    try {
      await fetch('/api/cloud-data/submissions/ALL', {
        method: 'DELETE',
        headers: { 'x-admin-password': adminPassword },
      });

      onSyncCloudState({ submissions: [] });

      if (auth.currentUser && isFirestoreAdmin) {
        try {
          const batch = writeBatch(db);
          submissions.forEach((s) => {
            batch.delete(doc(db, 'submissions', s.id));
          });
          await batch.commit();
        } catch {
          // Already cleared in server store
        }
      }

      setConfirmClearAll(false);
      showMessage('success', 'Todos los registros e intentos han sido restablecidos.');
    } catch {
      showMessage('error', 'Error al restablecer todos los registros.');
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Workspace Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>Panel de Control Administrativo</span>
            <span aria-hidden="true">·</span>
            <span className="text-sky-400 font-medium">Sesión Autorizada (ADMIN7890)</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Gestión de Evaluación, Banco de Preguntas y Reportes
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            Volver a Vista de Estudiante
          </button>

          <button
            type="button"
            onClick={onLockAdmin}
            className="px-4 py-2 text-xs font-semibold text-amber-300 bg-amber-950/50 hover:bg-amber-900/50 border border-amber-500/30 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Bloquear Panel Admin</span>
          </button>
        </div>
      </div>

      {/* Feedback Notification Banner */}
      {feedbackBanner && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center justify-between gap-3 ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : 'bg-red-950/60 border-red-500/40 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            <span>{feedbackBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('results')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'results'
              ? 'bg-sky-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Resultados y Exportación ({submissions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('topic')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'topic'
              ? 'bg-sky-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Configurar Tema y Generación Automática</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('questions')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'questions'
              ? 'bg-sky-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Banco de Preguntas / CSV ({questions.length})</span>
        </button>
      </div>

      {/* TAB 1: RESULTS & EXPORT DASHBOARD */}
      {activeTab === 'results' && (
        <div className="space-y-6">
          {/* KPI Summary Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <span className="text-xs text-slate-400 block mb-1">Total Estudiantes Evaluados</span>
              <span className="text-3xl font-bold text-white font-mono tabular-nums">
                {totalCount}
              </span>
              <p className="text-xs text-slate-500 mt-1">
                Intento único bloqueado por Documento de Identidad
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <span className="text-xs text-slate-400 block mb-1">
                Promedio Global de Calificación
              </span>
              <span className="text-3xl font-bold text-sky-400 font-mono tabular-nums">
                {avgPercentage}%
              </span>
              <p className="text-xs text-slate-500 mt-1">
                Mínimo de aprobación: {examConfig.passingScore}%
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <span className="text-xs text-slate-400 block mb-1">
                Aprobados (&ge;{examConfig.passingScore}%)
              </span>
              <span className="text-3xl font-bold text-emerald-400 font-mono tabular-nums">
                {approvedCount}
              </span>
              <p className="text-xs text-slate-500 mt-1">
                {totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0}% del total
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <span className="text-xs text-slate-400 block mb-1">
                Reprobados (&lt;{examConfig.passingScore}%)
              </span>
              <span className="text-3xl font-bold text-amber-400 font-mono tabular-nums">
                {failedCount}
              </span>
              <p className="text-xs text-slate-500 mt-1">
                {totalCount > 0 ? Math.round((failedCount / totalCount) * 100) : 0}% del total
              </p>
            </div>
          </div>

          {/* Search, Filter & Export Toolbar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-grow">
              <div className="relative flex-grow max-w-md">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por alumno, documento, correo o tema..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === 'all'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Todos ({totalCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('passed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === 'passed'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Aprobados ({approvedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('failed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === 'failed'
                      ? 'bg-amber-950 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Reprobados ({failedCount})
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => exportSubmissionsToExcel(filteredSubmissions, questions, examConfig)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Exportar Excel (.xlsx)</span>
              </button>

              <button
                type="button"
                onClick={() => exportSubmissionsToPDF(filteredSubmissions, examConfig)}
                className="bg-sky-600 hover:bg-sky-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <FileText className="w-4 h-4" />
                <span>Exportar PDF (.pdf)</span>
              </button>

              <button
                type="button"
                onClick={() => exportSubmissionsToCSV(filteredSubmissions, examConfig)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>CSV</span>
              </button>

              {submissions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-500/30 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Restablecer Intentos</span>
                </button>
              )}
            </div>
          </div>

          {/* Inline Confirm Reset All */}
          {confirmClearAll && (
            <div className="bg-red-950/40 border border-red-500/40 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="text-sm text-red-200">
                <strong className="font-semibold block text-white">
                  ¿Confirmas eliminar todos los resultados almacenados en la nube?
                </strong>
                Esto desbloqueará la restricción de única oportunidad para todos los alumnos.
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(false)}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleClearAllSubmissions}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500"
                >
                  Sí, Eliminar Todo
                </button>
              </div>
            </div>
          )}

          {/* Participants Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-400 bg-slate-950/60">
                    <th className="py-3.5 px-4 font-semibold">Estudiante</th>
                    <th className="py-3.5 px-4 font-semibold">Documento</th>
                    <th className="py-3.5 px-4 font-semibold">Tema Evaluado</th>
                    <th className="py-3.5 px-4 font-semibold">Fecha</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Puntaje</th>
                    <th className="py-3.5 px-4 font-semibold">Resultado</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Tiempo</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-sm">
                  {filteredSubmissions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        No hay participantes evaluados registrados todavía.
                      </td>
                    </tr>
                  ) : (
                    filteredSubmissions.map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-white">{sub.studentName}</div>
                          <div className="text-xs text-slate-400">{sub.studentEmail}</div>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-300 tabular-nums">
                          {sub.idDoc}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-300 max-w-[200px] truncate">
                          {sub.examTopic}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-400 font-mono tabular-nums whitespace-nowrap">
                          {formatFirestoreDate(sub.submittedAt)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-semibold text-white tabular-nums whitespace-nowrap">
                          {sub.score} / {sub.totalQuestions}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs font-semibold ${
                              sub.passed ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {sub.percentage}% · {sub.passed ? 'APROBADO' : 'REPROBADO'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                          {sub.timeFormatted}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedSubmission(sub)}
                              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg text-xs font-medium border border-slate-700 transition-colors inline-flex items-center gap-1"
                              title="Ver respuestas detalladas"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Detalle</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                exportIndividualStudentPDF(sub, questions, examConfig)
                              }
                              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors inline-flex items-center gap-1"
                              title="Descargar informe individual en PDF"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>PDF</span>
                            </button>

                            {confirmDeleteUserId === sub.id ? (
                              <button
                                type="button"
                                onClick={() => handleResetStudentAttempt(sub.id)}
                                className="px-2.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition-colors"
                              >
                                Confirmar Reset
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUserId(sub.id)}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-300 rounded-lg text-xs font-medium border border-slate-700 transition-colors"
                                title="Restablecer oportunidad de este estudiante"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TOPIC CONFIGURATION & AUTOMATIC QUESTION GENERATOR */}
      {activeTab === 'topic' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Columns: Topic Form & AI Generator */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">
                Configuración Dinámica del Tema de Evaluación
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Edita el tema central y pulsa el botón azul para que el sistema cambie
                automáticamente todas las preguntas según el nuevo tema elegido.
              </p>
            </div>

            <form onSubmit={handleSaveTopicMetadataOnly} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Tema Central de la Evaluación (Genera preguntas según este tema)
                </label>
                <input
                  type="text"
                  required
                  value={topicForm.topic}
                  onChange={(e) => setTopicForm({ ...topicForm, topic: e.target.value })}
                  placeholder="Ej. Seguridad Informática y Redes, Mantenimiento de PC, SQL..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Título Principal del Examen
                  </label>
                  <input
                    type="text"
                    required
                    value={topicForm.title}
                    onChange={(e) => setTopicForm({ ...topicForm, title: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Subtítulo / Nombre de Certificación
                  </label>
                  <input
                    type="text"
                    required
                    value={topicForm.subtitle}
                    onChange={(e) => setTopicForm({ ...topicForm, subtitle: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Descripción / Instrucciones Iniciales para el Alumno
                </label>
                <textarea
                  rows={3}
                  required
                  value={topicForm.description}
                  onChange={(e) => setTopicForm({ ...topicForm, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Tiempo Límite (Minutos)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    required
                    value={topicForm.timeLimitMinutes}
                    onChange={(e) =>
                      setTopicForm({ ...topicForm, timeLimitMinutes: Number(e.target.value) })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm font-mono tabular-nums focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Puntaje Mínimo Aprobación (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={topicForm.passingScore}
                    onChange={(e) =>
                      setTopicForm({ ...topicForm, passingScore: Number(e.target.value) })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm font-mono tabular-nums focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Cantidad de Preguntas a Generar
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={40}
                    required
                    value={topicForm.generateCount}
                    onChange={(e) =>
                      setTopicForm({ ...topicForm, generateCount: Number(e.target.value) })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm font-mono tabular-nums focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={isSavingConfig || isGeneratingAI}
                  className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm border border-slate-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {isSavingConfig ? 'Guardando...' : 'Guardar Solo Parámetros del Tema'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isGeneratingAI || isSavingConfig}
                  onClick={handleGenerateQuestionsByTopic}
                  className="px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-sky-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {isGeneratingAI
                      ? 'Generando Preguntas del Tema...'
                      : 'Cambiar Tema y Generar Preguntas Automáticamente'}
                  </span>
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Quick Topic Presets */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <h4 className="text-base font-bold text-white">Temas Sugeridos (Selección Rápida)</h4>
              <p className="text-xs text-slate-400 mt-1">
                Haz clic en una plantilla temática para autocompletar los campos y luego pulsa
                &ldquo;Cambiar Tema y Generar Preguntas Automáticamente&rdquo;.
              </p>
            </div>

            <div className="space-y-2.5">
              {TOPIC_PRESETS.map((preset) => {
                const isSelected = topicForm.topic === preset.topic;
                return (
                  <button
                    key={preset.topic}
                    type="button"
                    onClick={() =>
                      setTopicForm((prev) => ({
                        ...prev,
                        topic: preset.topic,
                        title: preset.title,
                        subtitle: preset.subtitle,
                        description: preset.description,
                      }))
                    }
                    className={`w-full text-left p-3.5 rounded-xl border transition-colors ${
                      isSelected
                        ? 'bg-sky-950/50 border-sky-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold text-white">{preset.topic}</div>
                    <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                      {preset.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: QUESTION BANK (CSV & DATABASE) */}
      {activeTab === 'questions' && (
        <div className="space-y-6">
          {/* CSV Import / Export Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Configuración del Banco de Preguntas (CSV y Base de Datos en la Nube)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Importa tus preguntas desde un archivo CSV, descarga la plantilla de ejemplo o
                  edita cada pregunta directamente en la base de datos.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadCSVTemplate}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar Plantilla CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => exportQuestionsToCSV(questions, examConfig.topic)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Exportar Banco Actual (CSV)</span>
                </button>

                <button
                  type="button"
                  onClick={handleRestoreDefaults}
                  disabled={isUploadingCSV}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar 20 Preguntas Mantenimiento PC</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingQuestion(true);
                    setEditingQuestion({
                      id: '',
                      order: questions.length + 1,
                      category: examConfig.topic,
                      question: '',
                      optionA: '',
                      optionB: '',
                      optionC: '',
                      optionD: '',
                      correctIndex: 0,
                      topic: examConfig.topic,
                      active: true,
                    });
                  }}
                  className="px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nueva Pregunta</span>
                </button>
              </div>
            </div>

            {/* CSV Upload Box */}
            <div className="bg-slate-950 border border-dashed border-slate-700 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <Upload className="w-4 h-4 text-sky-400" />
                  <span>Cargar Banco de Preguntas desde Archivo CSV</span>
                </div>
                <p className="text-xs text-slate-400">
                  Columnas soportadas:{' '}
                  <code className="text-sky-300">
                    categoria, pregunta, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta
                    (A/B/C/D), tema_recomendacion
                  </code>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setCsvMode('replace')}
                    className={`px-2.5 py-1 rounded font-medium ${
                      csvMode === 'replace'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Reemplazar banco
                  </button>
                  <button
                    type="button"
                    onClick={() => setCsvMode('append')}
                    className={`px-2.5 py-1 rounded font-medium ${
                      csvMode === 'append'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Añadir al final
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCSVFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isUploadingCSV}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isUploadingCSV ? 'Importando...' : 'Seleccionar Archivo CSV'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Question Create/Edit Modal Form */}
          {editingQuestion && (
            <div className="bg-slate-900 border border-sky-500/50 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-bold text-white">
                  {isCreatingQuestion ? 'Crear Nueva Pregunta' : 'Editar Pregunta'}
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setEditingQuestion(null);
                    setIsCreatingQuestion(false);
                  }}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveSingleQuestion} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Orden (#)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      required
                      value={editingQuestion.order}
                      onChange={(e) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          order: Number(e.target.value),
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Categoría Técnica
                    </label>
                    <input
                      type="text"
                      required
                      value={editingQuestion.category}
                      onChange={(e) =>
                        setEditingQuestion({ ...editingQuestion, category: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Enunciado de la Pregunta
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={editingQuestion.question}
                    onChange={(e) =>
                      setEditingQuestion({ ...editingQuestion, question: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Opción A
                    </label>
                    <input
                      type="text"
                      required
                      value={editingQuestion.optionA}
                      onChange={(e) =>
                        setEditingQuestion({ ...editingQuestion, optionA: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Opción B
                    </label>
                    <input
                      type="text"
                      required
                      value={editingQuestion.optionB}
                      onChange={(e) =>
                        setEditingQuestion({ ...editingQuestion, optionB: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Opción C
                    </label>
                    <input
                      type="text"
                      required
                      value={editingQuestion.optionC}
                      onChange={(e) =>
                        setEditingQuestion({ ...editingQuestion, optionC: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Opción D
                    </label>
                    <input
                      type="text"
                      required
                      value={editingQuestion.optionD}
                      onChange={(e) =>
                        setEditingQuestion({ ...editingQuestion, optionD: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Respuesta Correcta
                    </label>
                    <select
                      value={editingQuestion.correctIndex}
                      onChange={(e) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          correctIndex: Number(e.target.value),
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      <option value={0}>Opción A</option>
                      <option value={1}>Opción B</option>
                      <option value={2}>Opción C</option>
                      <option value={3}>Opción D</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Competencia / Tema de Recomendación si Falla
                    </label>
                    <input
                      type="text"
                      required
                      value={editingQuestion.topic}
                      onChange={(e) =>
                        setEditingQuestion({ ...editingQuestion, topic: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingQuestion(null);
                      setIsCreatingQuestion(false);
                    }}
                    className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Guardar en Base de Datos</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Questions List */}
          <div className="space-y-3">
            {questions.map((q, idx) => {
              const options = [q.optionA, q.optionB, q.optionC, q.optionD];
              const letters = ['A', 'B', 'C', 'D'];
              return (
                <div
                  key={q.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row items-start justify-between gap-4"
                >
                  <div className="space-y-2 flex-grow">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono font-semibold text-sky-400">
                        Pregunta {idx + 1}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{q.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-500">Recomendación: {q.topic}</span>
                    </div>

                    <h4 className="text-sm sm:text-base font-semibold text-white">
                      {q.question}
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {options.map((opt, oIdx) => {
                        const isCorrect = oIdx === q.correctIndex;
                        return (
                          <div
                            key={oIdx}
                            className={`text-xs p-2.5 rounded-lg border ${
                              isCorrect
                                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 font-medium'
                                : 'bg-slate-950/60 border-slate-800 text-slate-400'
                            }`}
                          >
                            <span className="font-mono font-bold mr-1.5">{letters[oIdx]})</span>
                            {opt}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingQuestion(false);
                        setEditingQuestion(q);
                      }}
                      className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors"
                      title="Editar pregunta"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteQuestion(q.id)}
                      className="p-2 bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-300 rounded-lg border border-slate-700 transition-colors"
                      title="Eliminar pregunta"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL: STUDENT SUBMISSION DETAIL */}
      {selectedSubmission && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">
                  Detalle de Evaluación — {selectedSubmission.studentName}
                </h3>
                <p className="text-xs text-slate-400">
                  Documento: {selectedSubmission.idDoc} · Correo: {selectedSubmission.studentEmail}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    exportIndividualStudentPDF(selectedSubmission, questions, examConfig)
                  }
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Descargar PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSubmission(null)}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs">
                <div>
                  <span className="text-slate-400 block">Calificación</span>
                  <span className="text-base font-bold text-white font-mono tabular-nums">
                    {selectedSubmission.score} / {selectedSubmission.totalQuestions}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Porcentaje</span>
                  <span className="text-base font-bold text-sky-400 font-mono tabular-nums">
                    {selectedSubmission.percentage}%
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Estado</span>
                  <span
                    className={`text-base font-bold ${
                      selectedSubmission.passed ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {selectedSubmission.passed ? 'APROBADO' : 'REPROBADO'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Tiempo Empleado</span>
                  <span className="text-base font-bold text-slate-200 font-mono tabular-nums">
                    {selectedSubmission.timeFormatted}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {questions.map((q, idx) => {
                  const opts = [q.optionA, q.optionB, q.optionC, q.optionD];
                  const letters = ['A', 'B', 'C', 'D'];
                  const userOpt = selectedSubmission.answersMap?.[q.id];
                  const isCorrect = userOpt === q.correctIndex;

                  return (
                    <div
                      key={q.id}
                      className={`p-4 rounded-xl border text-xs space-y-2 ${
                        isCorrect
                          ? 'bg-slate-950/60 border-emerald-500/30'
                          : 'bg-slate-950/60 border-red-500/30'
                      }`}
                    >
                      <div className="font-semibold text-white text-sm">
                        P{idx + 1}. {q.question}
                      </div>
                      <div className="space-y-1">
                        <div className={isCorrect ? 'text-emerald-400 font-medium' : 'text-red-400'}>
                          Respuesta seleccionada:{' '}
                          {userOpt !== undefined && opts[userOpt]
                            ? `${letters[userOpt]}) ${opts[userOpt]}`
                            : 'Sin responder'}
                        </div>
                        {!isCorrect && (
                          <div className="text-emerald-400 font-medium">
                            Respuesta correcta: {letters[q.correctIndex]}) {opts[q.correctIndex]}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
