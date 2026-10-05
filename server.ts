import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import {
  DEFAULT_EXAM_CONFIG,
  DEFAULT_QUESTIONS,
  ExamConfigRecord,
  QuestionRecord,
  SubmissionRecord,
} from './src/data/defaultQuestions.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_FILE_PATH = path.join(__dirname, '.cloud-eval-store.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ADMIN7890';

interface CloudStoreData {
  examConfig: ExamConfigRecord;
  questions: QuestionRecord[];
  submissions: SubmissionRecord[];
}

function loadCloudStore(): CloudStoreData {
  try {
    if (fs.existsSync(STORE_FILE_PATH)) {
      const raw = fs.readFileSync(STORE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<CloudStoreData>;
      return {
        examConfig: parsed.examConfig || { ...DEFAULT_EXAM_CONFIG },
        questions:
          Array.isArray(parsed.questions) && parsed.questions.length > 0
            ? parsed.questions
            : DEFAULT_QUESTIONS.map((q) => ({ ...q })),
        submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
      };
    }
  } catch (err) {
    console.error('Error loading cloud store:', err);
  }
  return {
    examConfig: { ...DEFAULT_EXAM_CONFIG },
    questions: DEFAULT_QUESTIONS.map((q) => ({ ...q })),
    submissions: [],
  };
}

function saveCloudStore(data: CloudStoreData): void {
  try {
    fs.writeFileSync(STORE_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving cloud store:', err);
  }
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  // 1. Verify Admin Password (ADMIN7890)
  app.post('/api/admin/login', (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (password === ADMIN_PASSWORD) {
      res.json({ ok: true });
    } else {
      res.status(401).json({ ok: false, error: 'Contraseña incorrecta. Intenta nuevamente.' });
    }
  });

  // 2. Get current cloud state (ExamConfig, Questions, Submissions)
  app.get('/api/cloud-data', (_req, res) => {
    const store = loadCloudStore();
    res.json(store);
  });

  // 3. Update ExamConfig & optionally Questions (Admin protected by ADMIN7890)
  app.post('/api/cloud-data/config', (req, res) => {
    const pass = req.headers['x-admin-password'];
    if (pass !== ADMIN_PASSWORD) {
      res.status(403).json({ error: 'No autorizado. Contraseña de administrador inválida.' });
      return;
    }

    const store = loadCloudStore();
    if (req.body?.examConfig) {
      store.examConfig = {
        ...store.examConfig,
        ...req.body.examConfig,
        updatedAt: new Date().toISOString(),
      };
    }
    if (Array.isArray(req.body?.questions)) {
      store.questions = req.body.questions;
      store.examConfig.questionCount = store.questions.length;
    }
    saveCloudStore(store);
    res.json({ ok: true, examConfig: store.examConfig, questions: store.questions });
  });

  // 4. Update Question Bank (Admin protected by ADMIN7890)
  app.post('/api/cloud-data/questions', (req, res) => {
    const pass = req.headers['x-admin-password'];
    if (pass !== ADMIN_PASSWORD) {
      res.status(403).json({ error: 'No autorizado. Contraseña de administrador inválida.' });
      return;
    }

    const store = loadCloudStore();
    if (Array.isArray(req.body?.questions)) {
      store.questions = req.body.questions;
      store.examConfig.questionCount = store.questions.length;
      if (req.body?.examConfig) {
        store.examConfig = {
          ...store.examConfig,
          ...req.body.examConfig,
          questionCount: store.questions.length,
          updatedAt: new Date().toISOString(),
        };
      }
      saveCloudStore(store);
    }
    res.json({ ok: true, examConfig: store.examConfig, questions: store.questions });
  });

  // 5. Submit Student Evaluation (Enforces Single Attempt by idDoc)
  app.post('/api/cloud-data/submissions', (req, res) => {
    const store = loadCloudStore();
    const incoming = req.body?.submission as SubmissionRecord | undefined;
    if (!incoming || !incoming.idDoc) {
      res.status(400).json({ error: 'Datos de evaluación incompletos.' });
      return;
    }

    const cleanDoc = incoming.idDoc.trim().toLowerCase();
    const existing = store.submissions.find(
      (s) => s.idDoc.trim().toLowerCase() === cleanDoc
    );
    if (existing) {
      res.status(409).json({
        error: `El documento de identidad "${incoming.idDoc}" ya registró su única oportunidad.`,
        existingSubmission: existing,
      });
      return;
    }

    const record: SubmissionRecord = {
      ...incoming,
      id: incoming.id || `sub_${incoming.idDoc.replace(/[^a-zA-Z0-9_-]/g, '')}_${Date.now()}`,
      submittedAt: new Date().toISOString(),
    };

    store.submissions.unshift(record);
    saveCloudStore(store);
    res.json({ ok: true, submission: record, submissions: store.submissions });
  });

  // 6. Reset single student attempt or all attempts (Admin protected by ADMIN7890)
  app.delete('/api/cloud-data/submissions/:id', (req, res) => {
    const pass = req.headers['x-admin-password'];
    if (pass !== ADMIN_PASSWORD) {
      res.status(403).json({ error: 'No autorizado.' });
      return;
    }

    const store = loadCloudStore();
    const targetId = req.params.id;
    if (targetId === 'ALL') {
      store.submissions = [];
    } else {
      store.submissions = store.submissions.filter(
        (s) => s.id !== targetId && s.studentUid !== targetId && s.idDoc !== targetId
      );
    }
    saveCloudStore(store);
    res.json({ ok: true, submissions: store.submissions });
  });

  // 7. Dynamically generate technical evaluation questions based on the admin-selected topic
  app.post('/api/generate-questions', async (req, res) => {
    try {
      const rawTopic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      const rawCount = Number(req.body?.count) || 20;
      const questionCount = Math.min(Math.max(rawCount, 5), 40);

      if (!rawTopic) {
        res.status(400).json({ error: 'Debes proporcionar un tema válido para generar las preguntas.' });
        return;
      }

      const prompt = `Genera un banco de exactamente ${questionCount} preguntas de evaluación técnica de opción múltiple en español sobre el tema: "${rawTopic}".
Cada pregunta debe evaluar conocimientos prácticos, diagnóstico, buenas prácticas, seguridad o conceptos fundamentales del tema "${rawTopic}".
Reglas estrictas para cada pregunta:
1. "category": Subcategoría técnica concisa (máximo 120 caracteres).
2. "question": Enunciado claro y riguroso de la pregunta (máximo 800 caracteres).
3. "optionA": Texto de la opción A (sin incluir el prefijo "A)", solo el texto de la respuesta, máximo 400 caracteres).
4. "optionB": Texto de la opción B (sin incluir el prefijo "B)", solo el texto de la respuesta, máximo 400 caracteres).
5. "optionC": Texto de la opción C (sin incluir el prefijo "C)", solo el texto de la respuesta, máximo 400 caracteres).
6. "optionD": Texto de la opción D (sin incluir el prefijo "D)", solo el texto de la respuesta, máximo 400 caracteres).
7. "correctIndex": Número entero entre 0 y 3 indicando cuál opción es la correcta (0 para A, 1 para B, 2 para C, 3 para D). Varía la posición de la respuesta correcta.
8. "topic": Tema específico o competencia puntual para mostrar como recomendación de estudio en caso de fallo (máximo 200 caracteres).`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction:
            'Eres un comité experto en diseño curricular y certificación técnica profesional. Diseñas exámenes rigurosos, claros y precisos en español.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestedTitle: {
                type: Type.STRING,
                description: 'Título formal para la evaluación (ej. Evaluación Técnica de ...)',
              },
              suggestedSubtitle: {
                type: Type.STRING,
                description: 'Subtítulo formal de certificación (ej. Certificación en ...)',
              },
              suggestedDescription: {
                type: Type.STRING,
                description: 'Descripción breve de 1 a 2 oraciones sobre las competencias evaluadas.',
              },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    question: { type: Type.STRING },
                    optionA: { type: Type.STRING },
                    optionB: { type: Type.STRING },
                    optionC: { type: Type.STRING },
                    optionD: { type: Type.STRING },
                    correctIndex: { type: Type.INTEGER },
                    topic: { type: Type.STRING },
                  },
                  required: [
                    'category',
                    'question',
                    'optionA',
                    'optionB',
                    'optionC',
                    'optionD',
                    'correctIndex',
                    'topic',
                  ],
                },
              },
            },
            required: ['suggestedTitle', 'suggestedSubtitle', 'suggestedDescription', 'questions'],
          },
        },
      });

      const textOutput = response.text;
      if (!textOutput) {
        throw new Error('No se recibió respuesta del generador de preguntas.');
      }

      const parsed = JSON.parse(textOutput);
      res.json(parsed);
    } catch (error) {
      console.error('Error generating questions:', error);
      const message = error instanceof Error ? error.message : 'Error interno al generar las preguntas.';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
