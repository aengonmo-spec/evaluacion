export interface QuestionRecord {
  id: string;
  order: number;
  category: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctIndex: number; // 0 = A, 1 = B, 2 = C, 3 = D
  topic: string;
  active: boolean;
  authorId?: string;
  updatedAt?: unknown;
}

export interface ExamConfigRecord {
  title: string;
  subtitle: string;
  topic: string;
  description: string;
  timeLimitMinutes: number;
  passingScore: number;
  questionCount: number;
  updatedBy?: string;
  updatedAt?: unknown;
}

export interface SubmissionRecord {
  id: string;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  idDoc: string;
  examTopic: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  passed: boolean;
  timeSpentSeconds: number;
  timeFormatted: string;
  answersMap: Record<string, number>;
  status: 'completed';
  submittedAt: unknown;
}

export const DEFAULT_EXAM_CONFIG: ExamConfigRecord = {
  title: 'Evaluación Técnica de Mantenimiento de PC',
  subtitle: 'Certificación en Mantenimiento de Hardware',
  topic: 'Mantenimiento y Diagnóstico de Hardware de PC',
  description:
    'Pon a prueba tus conocimientos en diagnóstico, prevención, descarga electrostática (ESD), compatibilidad y soporte técnico de computadoras.',
  timeLimitMinutes: 30,
  passingScore: 70,
  questionCount: 20,
};

export const TOPIC_PRESETS: {
  topic: string;
  title: string;
  subtitle: string;
  description: string;
}[] = [
  {
    topic: 'Mantenimiento y Diagnóstico de Hardware de PC',
    title: 'Evaluación Técnica de Mantenimiento de PC',
    subtitle: 'Certificación en Mantenimiento de Hardware',
    description:
      'Pon a prueba tus conocimientos en diagnóstico, prevención, descarga electrostática (ESD), compatibilidad y soporte técnico de computadoras.',
  },
  {
    topic: 'Redes y Telecomunicaciones (TCP/IP, Routing y Switching)',
    title: 'Evaluación Técnica de Redes y Conectividad',
    subtitle: 'Certificación en Infraestructura de Redes y Protocolos',
    description:
      'Evalúa tus competencias en modelo OSI, direccionamiento IPv4/IPv6, subredes, VLANs, enrutamiento y diagnóstico de conectividad.',
  },
  {
    topic: 'Seguridad Informática y Ciberseguridad Defensiva',
    title: 'Evaluación Técnica de Ciberseguridad',
    subtitle: 'Certificación en Seguridad de la Información y Hardening',
    description:
      'Prueba tus habilidades en criptografía, control de accesos, análisis de vulnerabilidades, respuesta a incidentes y protección de redes.',
  },
  {
    topic: 'Bases de Datos Relacionales y Optimización SQL',
    title: 'Evaluación Técnica de Bases de Datos SQL',
    subtitle: 'Certificación en Modelado de Datos y Consultas SQL',
    description:
      'Mide tu dominio en normalización, transacciones ACID, índices, consultas complejas JOIN y administración de motores relacionales.',
  },
  {
    topic: 'Sistemas Operativos Linux y Administración de Servidores',
    title: 'Evaluación Técnica de Administración Linux',
    subtitle: 'Certificación en Gestión de Sistemas y Línea de Comandos',
    description:
      'Evalúa tus conocimientos en permisos POSIX, gestión de procesos, systemd, almacenamiento LVM, redes y seguridad en entornos Linux.',
  },
  {
    topic: 'Desarrollo Web Full-Stack y Arquitectura de Software',
    title: 'Evaluación Técnica de Desarrollo Web Full-Stack',
    subtitle: 'Certificación en Ingeniería de Software Web Moderno',
    description:
      'Pon a prueba tu dominio en HTTP/REST, arquitectura frontend/backend, manejo de estado, seguridad web (OWASP) y despliegue en la nube.',
  },
];

export const DEFAULT_QUESTIONS: Omit<QuestionRecord, 'authorId' | 'updatedAt'>[] = [
  {
    id: 'q_01',
    order: 1,
    category: 'Limpieza y Mantenimiento Interno',
    question:
      '¿Cuál es el método y material recomendado para limpiar la pasta térmica seca entre el disipador y el procesador (CPU)?',
    optionA: 'Remover con un estropajo metálico y agua con jabón.',
    optionB: 'Utilizar alcohol isopropílico (al 99%) y un paño de microfibra o toallita libre de pelusa.',
    optionC: 'Raspar con una cuchilla y limpiar con aceite mineral común.',
    optionD: 'Dejar la pasta vieja y aplicar la nueva encima sin remover la anterior.',
    correctIndex: 1,
    topic: 'Limpieza y mantenimiento de componentes internos (CPU, GPU, fuente)',
    active: true,
  },
  {
    id: 'q_02',
    order: 2,
    category: 'Manejo Antiestático',
    question:
      'Antes de manipular componentes internos sensibles en una PC, ¿cuál es la medida fundamental para evitar daños por descargas electrostáticas (ESD)?',
    optionA: 'Frotar las manos con un paño sintético para generar carga.',
    optionB: 'Trabajar sobre una alfombra de lana gruesa con zapatos de goma.',
    optionC: 'Conectar una pulsera antiestática conectada a tierra y tocar una superficie metálica descargada.',
    optionD: 'Encender la fuente de poder mientras se manipula la placa madre.',
    correctIndex: 2,
    topic: 'Manejo correcto de componentes sensibles a electricidad estática',
    active: true,
  },
  {
    id: 'q_03',
    order: 3,
    category: 'Diagnóstico de Fallas de Hardware',
    question:
      'Al encender una PC, la pantalla no muestra señal de video y la placa madre emite una secuencia de 3 pitidos cortos continuos. ¿Qué componente suele indicar esta alerta de BIOS/UEFI?',
    optionA: 'Falla o mal contacto en los módulos de memoria RAM.',
    optionB: 'Cortocircuito en el puerto USB frontal.',
    optionC: 'Falta de espacio en el disco duro principal.',
    optionD: 'Temperatura elevada en el disco SSD NVMe.',
    correctIndex: 0,
    topic: 'Diagnóstico de fallas hardware mediante síntomas y herramientas',
    active: true,
  },
  {
    id: 'q_04',
    order: 4,
    category: 'Actualización y Compatibilidad',
    question:
      'Un usuario desea actualizar la memoria RAM de su equipo agregando un módulo nuevo. ¿Qué factor técnico es indispensable verificar primero?',
    optionA: 'El color exterior del gabinete y la iluminación RGB.',
    optionB:
      'La compatibilidad de tipo (DDR3, DDR4, DDR5), frecuencia máxima soportada y voltaje con la placa madre y procesador.',
    optionC: 'La marca del fabricante del monitor y la resolución de pantalla.',
    optionD: 'El sistema operativo instalado en el disco duro.',
    correctIndex: 1,
    topic: 'Actualización y compatibilidad de hardware (RAM, almacenamiento)',
    active: true,
  },
  {
    id: 'q_05',
    order: 5,
    category: 'Monitoreo y Rendimiento',
    question:
      '¿Qué herramienta o parámetro es el más adecuado para verificar si un disipador de CPU está acoplado correctamente tras el mantenimiento?',
    optionA: 'Contar los parpadeos del LED del disco duro.',
    optionB:
      'Monitorear las temperaturas en reposo (idle) y bajo carga (stress test) usando software como HWMonitor o Core Temp.',
    optionC: 'Medir el peso total del disipador con una balanza digital.',
    optionD: 'Escuchar el ruido de los ventiladores del gabinete a máxima velocidad.',
    correctIndex: 1,
    topic: 'Monitoreo de temperaturas, voltajes y rendimiento del sistema',
    active: true,
  },
  {
    id: 'q_06',
    order: 6,
    category: 'Procedimientos de Respaldo',
    question:
      'Antes de realizar una intervención física mayor o actualizar el firmware (BIOS) de una placa madre, ¿cuál es la mejor práctica recomendada?',
    optionA: 'Desinstalar todos los programas de diseño y ofimática.',
    optionB:
      'Realizar un respaldo (backup) completo de los archivos importantes y datos del usuario en un medio externo.',
    optionC: 'Desconectar la pila CMOS de forma permanente.',
    optionD: 'Cambiar la contraseña de acceso al sistema operativo.',
    correctIndex: 1,
    topic: 'Procedimientos de respaldo antes de intervenciones físicas',
    active: true,
  },
  {
    id: 'q_07',
    order: 7,
    category: 'Limpieza y Mantenimiento Interno',
    question:
      'Al limpiar los ventiladores de un gabinete o disipador con aire comprimido en lata, ¿qué precaución técnica importante se debe tomar?',
    optionA: 'Agitar la lata fuertemente en posición horizontal hacia abajo.',
    optionB:
      'Inmovilizar las aspas del ventilador con un objeto delgado para evitar que giren descontroladamente generando corriente inversa en la placa.',
    optionC: 'Aplicar calor con una pistola de aire caliente al mismo tiempo.',
    optionD: 'Sumergir el ventilador en alcohol isopropílico encendido.',
    correctIndex: 1,
    topic: 'Limpieza y mantenimiento de componentes internos (CPU, GPU, fuente)',
    active: true,
  },
  {
    id: 'q_08',
    order: 8,
    category: 'Diagnóstico de Fallas de Hardware',
    question:
      'Una PC se apaga repentinamente a los pocos minutos de iniciar un videojuego exigente o software de renderizado 3D. ¿Cuál es la causa más probable?',
    optionA: 'Falta de actualización del navegador web.',
    optionB:
      'Sobrecalentamiento del CPU/GPU por disipador obstruido o falla en la fuente de poder al entregar el voltaje requerido bajo carga.',
    optionC: 'Infección por virus troyano en el sector de arranque.',
    optionD: 'Configuración incorrecta del idioma del teclado.',
    correctIndex: 1,
    topic: 'Diagnóstico de fallas hardware mediante síntomas y herramientas',
    active: true,
  },
  {
    id: 'q_09',
    order: 9,
    category: 'Manejo Antiestático',
    question:
      '¿Por qué se desaconseja el uso de brochas o pinceles de cerdas sintéticas comunes al limpiar componentes electrónicos delicados?',
    optionA:
      'Porque acumulan y descargan fácilmente electricidad estática capaz de dañar circuitos integrados MOS.',
    optionB: 'Porque desprenden un olor desagradable al contacto con el aire.',
    optionC: 'Porque doblan los pines del zócalo del procesador.',
    optionD: 'Porque rayan la superficie de los disipadores de aluminio.',
    correctIndex: 0,
    topic: 'Manejo correcto de componentes sensibles a electricidad estática',
    active: true,
  },
  {
    id: 'q_10',
    order: 10,
    category: 'Actualización y Compatibilidad',
    question:
      'Al instalar una tarjeta gráfica (GPU) dedicada de gama alta, ¿qué componente de hardware existente se debe revisar obligatoriamente?',
    optionA:
      'La capacidad y potencia (Watts) de la fuente de poder (PSU), así como sus conectores PCI-e disponibles.',
    optionB: 'La cantidad de puertos USB 2.0 traseros.',
    optionC: 'El tipo de teclado y ratón conectados al equipo.',
    optionD: 'La velocidad de lectura del disco duro mecánico secundario.',
    correctIndex: 0,
    topic: 'Actualización y compatibilidad de hardware (RAM, almacenamiento)',
    active: true,
  },
  {
    id: 'q_11',
    order: 11,
    category: 'Monitoreo y Rendimiento',
    question:
      'Durante el monitoreo de voltajes de una fuente de poder con software o multímetro, ¿qué tolerancia máxima aceptable suelen tener los rieles principales (+12V, +5V, +3.3V) según las especificaciones ATX?',
    optionA: 'Hasta un 50% de desviación.',
    optionB: 'Un máximo de ±5% respecto al valor nominal.',
    optionC: 'Exactamente 0% de variación permitida.',
    optionD: 'Hasta un ±25% sin riesgo.',
    correctIndex: 1,
    topic: 'Monitoreo de temperaturas, voltajes y rendimiento del sistema',
    active: true,
  },
  {
    id: 'q_12',
    order: 12,
    category: 'Procedimientos de Respaldo',
    question:
      '¿Cuál es la ventaja principal de utilizar una imagen de disco (clonación) frente a una copia manual de archivos antes de mantenimiento mayor?',
    optionA: 'Ocupa menos espacio en el almacenamiento externo.',
    optionB:
      'Permite restaurar el sistema operativo completo, aplicaciones, configuraciones y datos exactamente como estaban en minutos.',
    optionC: 'Elimina automáticamente todos los virus del sistema.',
    optionD: 'Comprime los archivos un 90% obligatoriamente.',
    correctIndex: 1,
    topic: 'Procedimientos de respaldo antes de intervenciones físicas',
    active: true,
  },
  {
    id: 'q_13',
    order: 13,
    category: 'Limpieza y Mantenimiento Interno',
    question:
      '¿Qué sección de la fuente de poder (PSU) acumula voltajes peligrosos incluso cuando la PC está apagada y desconectada de la red eléctrica, requiriendo extrema precaución?',
    optionA: 'El interruptor principal de encendido de la parte trasera.',
    optionB: 'Los condensadores electrolíticos de filtrado de alta tensión en la etapa primaria.',
    optionC: 'El ventilador de extracción de aire.',
    optionD: 'Los cables de salida SATA de 5V.',
    correctIndex: 1,
    topic: 'Limpieza y mantenimiento de componentes internos (CPU, GPU, fuente)',
    active: true,
  },
  {
    id: 'q_14',
    order: 14,
    category: 'Diagnóstico de Fallas de Hardware',
    question:
      'Un disco duro mecánico (HDD tradicional) emite ruidos metálicos repetitivos (clics o zumbidos extraños) y el sistema operativo se congela al intentar acceder a los archivos. ¿Qué indica este síntoma?',
    optionA: 'Necesidad de una desfragmentación de archivos urgente.',
    optionB: 'Fallo mecánico inminente en los cabezales de lectura/escritura o en el motor del disco.',
    optionC: 'Falta de actualización del controlador gráfico.',
    optionD: 'Exceso de pasta térmica en el procesador.',
    correctIndex: 1,
    topic: 'Diagnóstico de fallas hardware mediante síntomas y herramientas',
    active: true,
  },
  {
    id: 'q_15',
    order: 15,
    category: 'Manejo Antiestático',
    question:
      'Al almacenar tarjetas de expansión o placas madre fuera del equipo durante una reparación, ¿en qué tipo de bolsa o superficie protectora deben colocarse?',
    optionA: 'Bolsas plásticas comunes de polietileno transparente.',
    optionB: 'Bolsas antiestáticas blindadas (shielding) o sobre espuma conductora antiestática.',
    optionC: 'Sobre hojas de papel periódico arrugado.',
    optionD: 'Sobre superficies de madera barnizada.',
    correctIndex: 1,
    topic: 'Manejo correcto de componentes sensibles a electricidad estática',
    active: true,
  },
  {
    id: 'q_16',
    order: 16,
    category: 'Actualización y Compatibilidad',
    question:
      'Al agregar un disco de estado sólido formato M.2 NVMe a una placa madre moderna, ¿qué se debe verificar respecto a las líneas PCIe o puertos SATA?',
    optionA: 'Que el monitor sea compatible con resolución 4K.',
    optionB:
      'Si el puerto M.2 comparte canales (bandwidth lanes) con puertos SATA o ranuras PCIe, lo cual podría deshabilitar algunos puertos SATA al instalarlo.',
    optionC: 'Que la fuente de poder tenga un conector especial de 24 pines para el SSD.',
    optionD: 'Que el teclado sea mecánico.',
    correctIndex: 1,
    topic: 'Actualización y compatibilidad de hardware (RAM, almacenamiento)',
    active: true,
  },
  {
    id: 'q_17',
    order: 17,
    category: 'Monitoreo y Rendimiento',
    question:
      '¿Qué fenómeno térmico ocurre cuando un procesador supera su temperatura límite de seguridad (Thermal Throttling)?',
    optionA: 'La computadora se quema instantáneamente sin previo aviso.',
    optionB:
      'El sistema reduce automáticamente la velocidad de reloj (frecuencia) y voltaje del CPU para disminuir la temperatura, afectando drásticamente el rendimiento.',
    optionC: 'Los ventiladores se apagan por completo para ahorrar energía.',
    optionD: 'El sistema cambia automáticamente a modo de video integrado.',
    correctIndex: 1,
    topic: 'Monitoreo de temperaturas, voltajes y rendimiento del sistema',
    active: true,
  },
  {
    id: 'q_18',
    order: 18,
    category: 'Procedimientos de Respaldo',
    question:
      '¿Cuál es la regla de oro "3-2-1" recomendada para la gestión y respaldo seguro de datos importantes antes de intervenciones?',
    optionA: '3 cables, 2 discos y 1 respaldo.',
    optionB:
      '3 copias de los datos, en 2 soportes de distinto tipo, y al menos 1 copia guardada en una ubicación externa (offsite o nube).',
    optionC: '3 horas de respaldo, 2 técnicos y 1 reinicio.',
    optionD: '3 particiones, 2 sistemas operativos y 1 antivirus.',
    correctIndex: 1,
    topic: 'Procedimientos de respaldo antes de intervenciones físicas',
    active: true,
  },
  {
    id: 'q_19',
    order: 19,
    category: 'Limpieza y Mantenimiento Interno',
    question:
      '¿Por qué es importante verificar y limpiar periódicamente los filtros anti-polvo del gabinete de la PC?',
    optionA: 'Para evitar que cambie el color exterior del chasis.',
    optionB:
      'Para mantener un flujo de aire óptimo hacia el interior, previniendo la acumulación de calor y el sobrecalentamiento de los componentes.',
    optionC: 'Para acelerar la velocidad de conexión a internet.',
    optionD: 'Para evitar interferencias en las señales de audio.',
    correctIndex: 1,
    topic: 'Limpieza y mantenimiento de componentes internos (CPU, GPU, fuente)',
    active: true,
  },
  {
    id: 'q_20',
    order: 20,
    category: 'Diagnóstico de Fallas de Hardware',
    question:
      'Una PC enciende sus ventiladores y luces, pero no da video en el monitor y emite un pitido largo continuo o pitidos intermitentes sin parar. ¿A qué tipo de fallo suele asociarse?',
    optionA:
      'Fallo general de suministro eléctrico de la fuente de poder o error crítico de memoria RAM / tarjeta gráfica mal insertada.',
    optionB: 'Falta de actualización del sistema operativo Windows.',
    optionC: 'Configuración incorrecta del protector de pantalla.',
    optionD: 'Espacio insuficiente en la Papelera de Reciclaje.',
    correctIndex: 0,
    topic: 'Diagnóstico de fallas hardware mediante síntomas y herramientas',
    active: true,
  },
];
