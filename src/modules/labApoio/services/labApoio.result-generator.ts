import { createHash } from 'node:crypto';

import { type PendingExam, type PendingExamDetail } from './labApoio.schemas.js';

type GeneratedParametro = {
  descricao: string;
  valor: string;
  unidade1?: string;
  liberado: boolean;
  prejudicado: boolean;
  resultadoPadrao?: string;
  valorPadrao1?: string;
  valorPadrao2?: string;
  tipo1?: string;
  obs?: string;
};

type GeneratedResultPayload = {
  status: 'CONCLUIDO';
  observacao: string;
  liberado: true;
  prejudicado: false;
  parametros: GeneratedParametro[];
};

export type GeneratedExamArtifacts = {
  scenarioKey: string;
  result: GeneratedResultPayload;
  resultPreview: string;
  pdfBuffer: Buffer;
  pdfBase64: string;
  pdfFileName: string;
};

class SeededRandom {
  private state: number;

  constructor(seed: string) {
    const hash = createHash('sha256').update(seed).digest();
    this.state = hash.readUInt32BE(0) || 1;
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  number(min: number, max: number, decimals = 1) {
    const value = min + (max - min) * this.next();
    return value.toFixed(decimals);
  }

  integer(min: number, max: number) {
    return Math.floor(min + (max - min + 1) * this.next());
  }

  pick<T>(values: T[]) {
    return values[Math.min(values.length - 1, this.integer(0, values.length - 1))];
  }

  chance(probability: number) {
    return this.next() <= probability;
  }
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function toAscii(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function buildPreview(parametros: GeneratedParametro[]) {
  return parametros
    .slice(0, 3)
    .map(parametro => `${parametro.descricao}: ${parametro.valor}${parametro.unidade1 ? ` ${parametro.unidade1}` : ''}`)
    .join(' | ');
}

function pdfEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdfBuffer(lines: string[]) {
  const escapedLines = lines.map(line => pdfEscape(toAscii(line)).slice(0, 120));
  let y = 790;
  const commands = escapedLines.map((line, index) => {
    const fontSize = index === 0 ? 16 : 11;
    const currentY = y;
    y -= index === 0 ? 28 : 16;
    return `BT /F1 ${fontSize} Tf 48 ${currentY} Td (${line}) Tj ET`;
  }).join('\n');

  const stream = `${commands}\n`;
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream\n${stream}endstream endobj`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

function buildResultadoComum(observacao: string, parametros: GeneratedParametro[]): GeneratedResultPayload {
  return {
    status: 'CONCLUIDO',
    observacao,
    liberado: true,
    prejudicado: false,
    parametros,
  };
}

function buildGenericScenario(description: string, random: SeededRandom) {
  return {
    key: 'generic',
    observacao: 'Resultado sintetico gerado automaticamente para QA.',
    parametros: [
      {
        descricao: description || 'Painel laboratorial',
        valor: random.number(12, 98, 1),
        unidade1: random.pick(['mg/dL', 'U/L', 'ng/mL', 'mUI/mL']),
        liberado: true,
        prejudicado: false,
        resultadoPadrao: random.number(12, 98, 1),
      },
    ],
  };
}

function buildScenario(description: string, random: SeededRandom) {
  const normalized = normalizeText(description);

  if (/(hemograma|eritrograma|leucograma|plaqueta|hemoglob)/.test(normalized)) {
    return {
      key: 'hemograma',
      observacao: 'Hemograma automatizado em faixa compativel com rotina ambulatorial.',
      parametros: [
        { descricao: 'Hemoglobina', valor: random.number(11.8, 16.3, 1), unidade1: 'g/dL', liberado: true, prejudicado: false, resultadoPadrao: random.number(11.8, 16.3, 1) },
        { descricao: 'Hematocrito', valor: random.number(35, 48, 1), unidade1: '%', liberado: true, prejudicado: false, resultadoPadrao: random.number(35, 48, 1) },
        { descricao: 'Leucocitos', valor: random.integer(4200, 11200).toString(), unidade1: '/mm3', liberado: true, prejudicado: false, resultadoPadrao: random.integer(4200, 11200).toString() },
        { descricao: 'Plaquetas', valor: random.integer(170000, 390000).toString(), unidade1: '/mm3', liberado: true, prejudicado: false, resultadoPadrao: random.integer(170000, 390000).toString() },
      ],
    };
  }

  if (/(glic|glucose|hba1c|hemoglobina glicada)/.test(normalized)) {
    return {
      key: 'glicemia',
      observacao: 'Curva glicemica sintetica para homologacao.',
      parametros: normalized.includes('glicada')
        ? [
          { descricao: 'Hemoglobina glicada', valor: random.number(4.8, 6.4, 1), unidade1: '%', liberado: true, prejudicado: false, resultadoPadrao: random.number(4.8, 6.4, 1) },
          { descricao: 'Glicemia estimada', valor: random.integer(88, 137).toString(), unidade1: 'mg/dL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(88, 137).toString() },
        ]
        : [
          { descricao: 'Glicose', valor: random.integer(78, 118).toString(), unidade1: 'mg/dL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(78, 118).toString() },
        ],
    };
  }

  if (/(colesterol|hdl|ldl|lipid)/.test(normalized)) {
    return {
      key: 'lipidico',
      observacao: 'Perfil lipidico gerado para cenario de QA.',
      parametros: [
        { descricao: 'Colesterol total', valor: random.integer(145, 228).toString(), unidade1: 'mg/dL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(145, 228).toString() },
        { descricao: 'HDL', valor: random.integer(42, 78).toString(), unidade1: 'mg/dL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(42, 78).toString() },
        { descricao: 'LDL', valor: random.integer(68, 142).toString(), unidade1: 'mg/dL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(68, 142).toString() },
        { descricao: 'Triglicerideos', valor: random.integer(70, 188).toString(), unidade1: 'mg/dL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(70, 188).toString() },
      ],
    };
  }

  if (/(triglicer)/.test(normalized)) {
    return {
      key: 'triglicerideos',
      observacao: 'Triglicerideos em padrao de rotina automatizada.',
      parametros: [
        { descricao: 'Triglicerideos', valor: random.integer(75, 210).toString(), unidade1: 'mg/dL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(75, 210).toString() },
      ],
    };
  }

  if (/(creat|ureia|urea|renal)/.test(normalized)) {
    return {
      key: 'renal',
      observacao: 'Marcadores renais sinteticos para homologacao.',
      parametros: [
        { descricao: 'Creatinina', valor: random.number(0.6, 1.3, 2), unidade1: 'mg/dL', liberado: true, prejudicado: false, resultadoPadrao: random.number(0.6, 1.3, 2) },
        { descricao: 'Ureia', valor: random.integer(18, 51).toString(), unidade1: 'mg/dL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(18, 51).toString() },
      ],
    };
  }

  if (/(tsh|t4|t3|tireo)/.test(normalized)) {
    return {
      key: 'tireoide',
      observacao: 'Painel hormonal tireoidiano gerado automaticamente.',
      parametros: [
        { descricao: 'TSH', valor: random.number(0.7, 4.8, 2), unidade1: 'uUI/mL', liberado: true, prejudicado: false, resultadoPadrao: random.number(0.7, 4.8, 2) },
        { descricao: 'T4 Livre', valor: random.number(0.9, 1.7, 2), unidade1: 'ng/dL', liberado: true, prejudicado: false, resultadoPadrao: random.number(0.9, 1.7, 2) },
      ],
    };
  }

  if (/(ferrit)/.test(normalized)) {
    return {
      key: 'ferritina',
      observacao: 'Ferritina simulada em faixa clinica plausivel.',
      parametros: [
        { descricao: 'Ferritina', valor: random.integer(22, 286).toString(), unidade1: 'ng/mL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(22, 286).toString() },
      ],
    };
  }

  if (/(vitamina d|25-oh)/.test(normalized)) {
    return {
      key: 'vitamina-d',
      observacao: 'Vitamina D sintetica para ambiente de QA.',
      parametros: [
        { descricao: 'Vitamina D 25-OH', valor: random.integer(24, 54).toString(), unidade1: 'ng/mL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(24, 54).toString() },
      ],
    };
  }

  if (/(psa)/.test(normalized)) {
    return {
      key: 'psa',
      observacao: 'PSA total e livre calculados automaticamente.',
      parametros: [
        { descricao: 'PSA total', valor: random.number(0.6, 3.8, 2), unidade1: 'ng/mL', liberado: true, prejudicado: false, resultadoPadrao: random.number(0.6, 3.8, 2) },
        { descricao: 'PSA livre', valor: random.number(0.18, 1.1, 2), unidade1: 'ng/mL', liberado: true, prejudicado: false, resultadoPadrao: random.number(0.18, 1.1, 2) },
      ],
    };
  }

  if (/(beta hcg|hcg)/.test(normalized)) {
    return {
      key: 'beta-hcg',
      observacao: 'Beta-HCG quantitativo sintetico para validacao do fluxo.',
      parametros: [
        { descricao: 'Beta-HCG', valor: random.integer(5, 280).toString(), unidade1: 'mUI/mL', liberado: true, prejudicado: false, resultadoPadrao: random.integer(5, 280).toString() },
      ],
    };
  }

  if (/(urina|eas|urinalise|sedimento)/.test(normalized)) {
    return {
      key: 'urina',
      observacao: 'Urina rotina simulada com parametros qualitativos.',
      parametros: [
        { descricao: 'Cor', valor: random.pick(['Amarelo citrino', 'Amarelo claro']), liberado: true, prejudicado: false, resultadoPadrao: random.pick(['Amarelo citrino', 'Amarelo claro']) },
        { descricao: 'Aspecto', valor: random.pick(['Limpido', 'Levemente turvo']), liberado: true, prejudicado: false, resultadoPadrao: random.pick(['Limpido', 'Levemente turvo']) },
        { descricao: 'Densidade', valor: random.number(1.010, 1.028, 3), liberado: true, prejudicado: false, resultadoPadrao: random.number(1.010, 1.028, 3) },
        { descricao: 'pH', valor: random.number(5.0, 7.0, 1), liberado: true, prejudicado: false, resultadoPadrao: random.number(5.0, 7.0, 1) },
      ],
    };
  }

  if (/(pcr|proteina c reativa|c reativa)/.test(normalized)) {
    return {
      key: 'pcr',
      observacao: 'Proteina C reativa automatizada para QA.',
      parametros: [
        { descricao: 'PCR', valor: random.number(0.2, 5.4, 2), unidade1: 'mg/L', liberado: true, prejudicado: false, resultadoPadrao: random.number(0.2, 5.4, 2) },
      ],
    };
  }

  if (/(tgo|tgp|ast|alt|ggt|fosfatase)/.test(normalized)) {
    return {
      key: 'hepatico',
      observacao: 'Enzimas hepaticas sinteticas com variacao moderada.',
      parametros: [
        { descricao: 'AST/TGO', valor: random.integer(16, 42).toString(), unidade1: 'U/L', liberado: true, prejudicado: false, resultadoPadrao: random.integer(16, 42).toString() },
        { descricao: 'ALT/TGP', valor: random.integer(14, 51).toString(), unidade1: 'U/L', liberado: true, prejudicado: false, resultadoPadrao: random.integer(14, 51).toString() },
        { descricao: 'GGT', valor: random.integer(12, 62).toString(), unidade1: 'U/L', liberado: true, prejudicado: false, resultadoPadrao: random.integer(12, 62).toString() },
      ],
    };
  }

  if (/(covid|sars|influenza|hiv|hepat|dengue|vdrl|igg|igm|antigeno|anticorpo)/.test(normalized)) {
    const qualitative = random.chance(0.82) ? 'Nao reagente' : 'Reagente fraco';
    return {
      key: 'qualitativo',
      observacao: 'Exame qualitativo sintetico para validacao end-to-end.',
      parametros: [
        { descricao: description || 'Exame qualitativo', valor: qualitative, liberado: true, prejudicado: false, resultadoPadrao: qualitative },
      ],
    };
  }

  return buildGenericScenario(description, random);
}

export function buildSyntheticExamArtifacts(params: {
  tenantId: string;
  exam: PendingExam;
  examDetail?: PendingExamDetail | null;
  now: Date;
}) : GeneratedExamArtifacts {
  const detailItem = params.examDetail?.itens.find(item => item.agendaExameItemId === params.exam.agendaExameItemId) ?? null;
  const description = detailItem?.descricaoExame || params.exam.descricaoExame || `Exame ${params.exam.codexame}`;
  const seed = [
    params.tenantId,
    params.exam.agendaExameId,
    params.exam.agendaExameItemId,
    params.exam.codexame,
    description,
    params.now.toISOString(),
  ].join('|');
  const random = new SeededRandom(seed);
  const scenario = buildScenario(description, random);
  const result = buildResultadoComum(scenario.observacao, scenario.parametros);
  const resultPreview = buildPreview(result.parametros);
  const pdfLines = [
    'RESULTADO LABORATORIAL - QA',
    `Exame: ${description}`,
    `Tenant: ${params.tenantId}`,
    `AgendaExameId: ${params.exam.agendaExameId}`,
    `AgendaExameItemId: ${params.exam.agendaExameItemId}`,
    `CodExame: ${params.exam.codexame}`,
    `GeradoEm: ${params.now.toISOString()}`,
    `Cenario: ${scenario.key}`,
    '---',
    ...result.parametros.map(parametro => `${parametro.descricao}: ${parametro.valor}${parametro.unidade1 ? ` ${parametro.unidade1}` : ''}`),
    '---',
    result.observacao,
  ];
  const pdfBuffer = buildPdfBuffer(pdfLines);

  return {
    scenarioKey: scenario.key,
    result,
    resultPreview,
    pdfBuffer,
    pdfBase64: pdfBuffer.toString('base64'),
    pdfFileName: `resultado-${params.exam.agendaExameId}-${params.exam.agendaExameItemId}.pdf`,
  };
}
