import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { ExamConfigRecord, QuestionRecord, SubmissionRecord } from '../data/defaultQuestions';

export function formatFirestoreDate(ts: unknown): string {
  if (!ts) return 'Reciente';
  if (typeof ts === 'string') return ts;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    const d = (ts as { toDate: () => Date }).toDate();
    return `${d.toLocaleDateString('es-CO')} ${d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    const d = new Date(((ts as { seconds: number }).seconds || 0) * 1000);
    return `${d.toLocaleDateString('es-CO')} ${d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return 'Reciente';
}

export function exportSubmissionsToExcel(
  submissions: SubmissionRecord[],
  questions: QuestionRecord[],
  examConfig: ExamConfigRecord
): void {
  const summaryRows = submissions.map((s, idx) => ({
    '#': idx + 1,
    'Nombre Completo': s.studentName,
    'Documento de Identidad': s.idDoc,
    'Correo Electrónico': s.studentEmail,
    'Tema Evaluado': s.examTopic,
    'Respuestas Correctas': s.score,
    'Total Preguntas': s.totalQuestions,
    'Porcentaje (%)': s.percentage,
    'Estado': s.passed ? 'APROBADO' : 'REPROBADO',
    'Tiempo Empleado': s.timeFormatted,
    'Fecha y Hora de Entrega': formatFirestoreDate(s.submittedAt),
  }));

  const detailRows: Record<string, string | number>[] = [];
  submissions.forEach((s) => {
    questions.forEach((q, qIdx) => {
      const selectedIdx = s.answersMap?.[q.id];
      const options = [q.optionA, q.optionB, q.optionC, q.optionD];
      const letters = ['A', 'B', 'C', 'D'];
      const isCorrect = selectedIdx === q.correctIndex;
      detailRows.push({
        'Estudiante': s.studentName,
        'Documento': s.idDoc,
        'Pregunta #': qIdx + 1,
        'Categoría': q.category,
        'Enunciado': q.question,
        'Opción Seleccionada':
          selectedIdx !== undefined && options[selectedIdx]
            ? `${letters[selectedIdx]}) ${options[selectedIdx]}`
            : 'Sin responder',
        'Respuesta Correcta': `${letters[q.correctIndex]}) ${options[q.correctIndex]}`,
        'Resultado': isCorrect ? 'Correcta' : 'Incorrecta',
      });
    });
  });

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(
    summaryRows.length > 0
      ? summaryRows
      : [{ Mensaje: 'Sin participantes evaluados todavía' }]
  );
  wsSummary['!cols'] = [
    { wch: 5 },
    { wch: 28 },
    { wch: 18 },
    { wch: 28 },
    { wch: 30 },
    { wch: 18 },
    { wch: 15 },
    { wch: 15 },
    { wch: 14 },
    { wch: 16 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen de Resultados');

  if (detailRows.length > 0) {
    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    wsDetail['!cols'] = [
      { wch: 25 },
      { wch: 16 },
      { wch: 12 },
      { wch: 26 },
      { wch: 50 },
      { wch: 40 },
      { wch: 40 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Desglose de Respuestas');
  }

  const safeTopic = examConfig.topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  XLSX.writeFile(wb, `reporte_evaluacion_${safeTopic}_${Date.now()}.xlsx`);
}

export function exportSubmissionsToCSV(
  submissions: SubmissionRecord[],
  examConfig: ExamConfigRecord
): void {
  const rows = submissions.map((s) => ({
    UID: s.studentUid,
    Nombre: s.studentName,
    Documento: s.idDoc,
    Correo: s.studentEmail,
    Tema: s.examTopic,
    Puntaje: s.score,
    Total: s.totalQuestions,
    Porcentaje: `${s.percentage}%`,
    Estado: s.passed ? 'APROBADO' : 'REPROBADO',
    Tiempo: s.timeFormatted,
    Fecha: formatFirestoreDate(s.submittedAt),
  }));

  const csv = Papa.unparse(rows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeTopic = examConfig.topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  a.href = url;
  a.download = `resultados_${safeTopic}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportSubmissionsToPDF(
  submissions: SubmissionRecord[],
  examConfig: ExamConfigRecord
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const total = submissions.length;
  const approved = submissions.filter((s) => s.passed).length;
  const failed = total - approved;
  const avg =
    total > 0
      ? Math.round(submissions.reduce((acc, cur) => acc + cur.percentage, 0) / total)
      : 0;

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 82, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(examConfig.title, 40, 34);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(`Tema Activo: ${examConfig.topic}`, 40, 52);
  doc.text(
    `Generado: ${new Date().toLocaleDateString('es-CO')} ${new Date().toLocaleTimeString('es-CO')}  |  Aprobación mínima: ${examConfig.passingScore}%`,
    40,
    68
  );

  // KPI Summary Strip
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Total Evaluados: ${total}    |    Promedio Global: ${avg}%    |    Aprobados: ${approved}    |    Reprobados: ${failed}`,
    40,
    108
  );

  const tableBody = submissions.map((s, idx) => [
    String(idx + 1),
    s.studentName,
    s.idDoc,
    s.studentEmail,
    s.examTopic,
    `${s.score} / ${s.totalQuestions}`,
    `${s.percentage}%`,
    s.passed ? 'APROBADO' : 'REPROBADO',
    s.timeFormatted,
    formatFirestoreDate(s.submittedAt),
  ]);

  autoTable(doc, {
    startY: 122,
    head: [
      [
        '#',
        'Participante',
        'Documento',
        'Correo',
        'Tema',
        'Puntaje',
        '%',
        'Estado',
        'Tiempo',
        'Fecha',
      ],
    ],
    body:
      tableBody.length > 0
        ? tableBody
        : [['-', 'Sin registros', '-', '-', '-', '-', '-', '-', '-', '-']],
    styles: {
      fontSize: 8.5,
      cellPadding: 6,
    },
    headStyles: {
      fillColor: [14, 116, 144],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  const safeTopic = examConfig.topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  doc.save(`reporte_ejecutivo_${safeTopic}_${Date.now()}.pdf`);
}

export function exportIndividualStudentPDF(
  submission: SubmissionRecord,
  questions: QuestionRecord[],
  examConfig: ExamConfigRecord
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 95, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(examConfig.title, 40, 34);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(56, 189, 248);
  doc.text(`Informe Individual de Evaluación — ${submission.examTopic}`, 40, 52);

  doc.setTextColor(203, 213, 225);
  doc.text(
    `Participante: ${submission.studentName}   |   Documento: ${submission.idDoc}   |   Correo: ${submission.studentEmail}`,
    40,
    72
  );

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Calificación: ${submission.score} / ${submission.totalQuestions} (${submission.percentage}%)   —   Estado: ${
      submission.passed ? 'APROBADO' : 'REPROBADO'
    }   —   Tiempo: ${submission.timeFormatted}`,
    40,
    120
  );

  const letters = ['A', 'B', 'C', 'D'];
  const rows = questions.map((q, idx) => {
    const opts = [q.optionA, q.optionB, q.optionC, q.optionD];
    const userIdx = submission.answersMap?.[q.id];
    const isCorrect = userIdx === q.correctIndex;
    const userAnswer =
      userIdx !== undefined && opts[userIdx]
        ? `${letters[userIdx]}) ${opts[userIdx]}`
        : 'Sin responder';
    const correctAnswer = `${letters[q.correctIndex]}) ${opts[q.correctIndex]}`;
    return [
      `P${idx + 1}`,
      q.category,
      q.question,
      userAnswer,
      correctAnswer,
      isCorrect ? 'Correcta' : 'Incorrecta',
    ];
  });

  autoTable(doc, {
    startY: 138,
    head: [['#', 'Categoría', 'Pregunta', 'Respuesta Alumno', 'Respuesta Correcta', 'Resultado']],
    body: rows,
    styles: {
      fontSize: 7.5,
      cellPadding: 5,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
    },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 75 },
      2: { cellWidth: 155 },
      3: { cellWidth: 105 },
      4: { cellWidth: 105 },
      5: { cellWidth: 50 },
    },
  });

  const safeDoc = submission.idDoc.replace(/[^a-zA-Z0-9_-]/g, '');
  doc.save(`certificado_evaluacion_${safeDoc}_${Date.now()}.pdf`);
}

export function exportQuestionsToCSV(questions: QuestionRecord[], topicName: string): void {
  const letters = ['A', 'B', 'C', 'D'];
  const rows = questions.map((q, idx) => ({
    orden: idx + 1,
    categoria: q.category,
    pregunta: q.question,
    opcion_a: q.optionA,
    opcion_b: q.optionB,
    opcion_c: q.optionC,
    opcion_d: q.optionD,
    respuesta_correcta: letters[q.correctIndex] || 'B',
    tema_recomendacion: q.topic,
  }));

  const csv = Papa.unparse(rows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeTopic = topicName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  a.href = url;
  a.download = `banco_preguntas_${safeTopic}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCSVTemplate(): void {
  const sampleRows = [
    {
      orden: 1,
      categoria: 'Seguridad de Redes',
      pregunta: '¿Qué protocolo se utiliza para administrar dispositivos de red de forma cifrada y segura en el puerto 22?',
      opcion_a: 'Telnet',
      opcion_b: 'SSH (Secure Shell)',
      opcion_c: 'FTP',
      opcion_d: 'SNMPv1',
      respuesta_correcta: 'B',
      tema_recomendacion: 'Protocolos de administración remota segura y cifrado SSH',
    },
    {
      orden: 2,
      categoria: 'Direccionamiento IP',
      pregunta: '¿Cuál es la máscara de subred en notación decimal punteada correspondiente al prefijo /24 en IPv4?',
      opcion_a: '255.255.0.0',
      opcion_b: '255.255.255.0',
      opcion_c: '255.255.255.128',
      opcion_d: '255.0.0.0',
      respuesta_correcta: 'B',
      tema_recomendacion: 'Cálculo de subredes y máscaras CIDR en IPv4',
    },
  ];

  const csv = Papa.unparse(sampleRows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla_banco_preguntas.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function parseQuestionsCSV(
  csvText: string
): Promise<Omit<QuestionRecord, 'id' | 'authorId' | 'updatedAt'>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsedQuestions: Omit<QuestionRecord, 'id' | 'authorId' | 'updatedAt'>[] = [];

          results.data.forEach((row, index) => {
            // Normalize keys to lowercase without accents
            const norm: Record<string, string> = {};
            Object.keys(row).forEach((k) => {
              const cleanKey = k
                .trim()
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
              norm[cleanKey] = String(row[k] ?? '').trim();
            });

            const questionText =
              norm['pregunta'] || norm['question'] || norm['enunciado'] || '';
            const optionA =
              norm['opcion_a'] || norm['optiona'] || norm['opcion a'] || norm['a'] || '';
            const optionB =
              norm['opcion_b'] || norm['optionb'] || norm['opcion b'] || norm['b'] || '';
            const optionC =
              norm['opcion_c'] || norm['optionc'] || norm['opcion c'] || norm['c'] || '';
            const optionD =
              norm['opcion_d'] || norm['optiond'] || norm['opcion d'] || norm['d'] || '';

            if (!questionText || !optionA || !optionB) {
              return;
            }

            const category =
              norm['categoria'] || norm['category'] || 'Evaluación General';
            const topic =
              norm['tema_recomendacion'] ||
              norm['topic'] ||
              norm['tema'] ||
              category;

            const rawCorrect = (
              norm['respuesta_correcta'] ||
              norm['correct'] ||
              norm['correctindex'] ||
              norm['respuesta'] ||
              '0'
            ).toUpperCase();

            let correctIndex = 0;
            if (rawCorrect === 'A' || rawCorrect === '0') correctIndex = 0;
            else if (rawCorrect === 'B' || rawCorrect === '1') correctIndex = 1;
            else if (rawCorrect === 'C' || rawCorrect === '2') correctIndex = 2;
            else if (rawCorrect === 'D' || rawCorrect === '3') correctIndex = 3;

            const cleanOpt = (txt: string) =>
              txt.replace(/^[A-Da-d][\)\.\-]\s*/, '').trim() || 'Opción disponible';

            parsedQuestions.push({
              order: parsedQuestions.length + 1,
              category: category.slice(0, 150),
              question: questionText.slice(0, 1000),
              optionA: cleanOpt(optionA).slice(0, 500),
              optionB: cleanOpt(optionB).slice(0, 500),
              optionC: cleanOpt(optionC || 'Ninguna de las anteriores').slice(0, 500),
              optionD: cleanOpt(optionD || 'Todas las anteriores').slice(0, 500),
              correctIndex,
              topic: topic.slice(0, 250),
              active: true,
            });
          });

          if (parsedQuestions.length === 0) {
            reject(
              new Error(
                'No se encontraron preguntas válidas en el archivo CSV. Asegúrate de usar las columnas: categoria, pregunta, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, tema_recomendacion.'
              )
            );
            return;
          }

          resolve(parsedQuestions);
        } catch (err) {
          reject(err);
        }
      },
      error: (err: Error) => {
        reject(err);
      },
    });
  });
}
