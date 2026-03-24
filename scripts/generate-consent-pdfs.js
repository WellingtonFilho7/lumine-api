#!/usr/bin/env node

'use strict';

/**
 * Gera um PDF do Termo de Autorização de Dados e Imagem para cada criança
 * cadastrada no sistema.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/generate-consent-pdfs.js
 *
 * Os arquivos são salvos em: output/termos-consentimento/
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { createClient } = require('@supabase/supabase-js');

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  process.exit(1);
}

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'termos-consentimento');

// ─── Layout constants ─────────────────────────────────────────────────────────

// A4: 595.28 × 841.89 pt
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 52; // margin
const CW = PAGE_W - M * 2; // content width

// Colours
const CORAL = '#D95F3B';
const INK = '#1C1C2E';
const MUTED = '#6B7280';
const BORDER = '#D1D5DB';
const FILL_BG = '#F9FAFB';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
}

function hRule(doc, y, color = BORDER, width = 0.5) {
  doc.save()
    .moveTo(M, y)
    .lineTo(PAGE_W - M, y)
    .strokeColor(color)
    .lineWidth(width)
    .stroke()
    .restore();
}

/**
 * Draws a labelled input box.
 * @param {PDFDocument} doc
 * @param {object} opts
 * @param {string}  opts.label   - Field label (displayed above the box)
 * @param {string|null} opts.value - Pre-filled value, or null for blank
 * @param {string|null} opts.hint  - Hint text shown when blank
 * @param {number}  opts.x
 * @param {number}  opts.y
 * @param {number}  opts.w       - Box width
 * @param {number}  [opts.h=22]  - Box height
 * @returns {number} y position below the field
 */
function field(doc, { label, value, hint, x, y, w, h = 22 }) {
  // Label
  doc.save()
    .fontSize(7.5)
    .fillColor(MUTED)
    .font('Helvetica')
    .text(label.toUpperCase(), x, y, { lineBreak: false })
    .restore();

  const boxY = y + 13;

  // Box
  doc.save()
    .rect(x, boxY, w, h)
    .fillAndStroke(value ? FILL_BG : '#FFFFFF', BORDER)
    .restore();

  if (value) {
    doc.save()
      .fontSize(10.5)
      .fillColor(INK)
      .font('Helvetica-Bold')
      .text(value, x + 7, boxY + (h - 10.5) / 2, { width: w - 14, lineBreak: false, ellipsis: true })
      .restore();
  } else if (hint) {
    doc.save()
      .fontSize(9)
      .fillColor('#BABBC4')
      .font('Helvetica')
      .text(hint, x + 7, boxY + (h - 9) / 2, { width: w - 14, lineBreak: false })
      .restore();
  }

  return boxY + h + 10; // next Y
}

/**
 * Draws a checkbox option line.
 * Returns next Y.
 */
function checkbox(doc, text, x, y, w) {
  const size = 11;
  doc.save()
    .rect(x, y, size, size)
    .strokeColor(CORAL)
    .lineWidth(1)
    .stroke()
    .restore();

  doc.save()
    .fontSize(10)
    .fillColor(INK)
    .font('Helvetica')
    .text(text, x + size + 8, y, { width: w - size - 8 })
    .restore();

  return doc.y + 6;
}

// ─── PDF generation ───────────────────────────────────────────────────────────

function generatePdf(child, responsavel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: M, bottom: M, left: M, right: M },
      info: {
        Title: `Termo de Autorização – ${child.nome}`,
        Author: 'Instituto Lumine',
        Subject: 'Autorização de Dados e Imagem',
      },
    });

    const id = child.child_public_id || child.id.slice(0, 8).toUpperCase();
    const filename = `TERMO_${id}_${slugify(child.nome)}.pdf`;
    const outputPath = path.join(OUTPUT_DIR, filename);

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    stream.on('finish', () => resolve({ filename, outputPath }));
    stream.on('error', reject);

    // ── Header bar ──────────────────────────────────────────────────────────

    const HEADER_H = 78;
    doc.rect(0, 0, PAGE_W, HEADER_H).fillColor(CORAL).fill();

    doc.save()
      .fontSize(20)
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .text('INSTITUTO LUMINE', 0, 16, { width: PAGE_W, align: 'center' })
      .restore();

    doc.save()
      .fontSize(9.5)
      .fillColor('rgba(255,255,255,0.82)')
      .font('Helvetica')
      .text(
        'Termo Simplificado de Autorização de Dados e Imagem',
        0, 44, { width: PAGE_W, align: 'center' }
      )
      .restore();

    let y = HEADER_H + 26;

    // ── Seção 1 – Identificação ──────────────────────────────────────────────

    doc.save()
      .fontSize(10.5)
      .fillColor(CORAL)
      .font('Helvetica-Bold')
      .text('1.  IDENTIFICAÇÃO', M, y)
      .restore();

    y += 16;
    hRule(doc, y, CORAL, 0.8);
    y += 14;

    // Nome da criança (linha inteira)
    y = field(doc, { label: 'Nome da criança', value: child.nome, x: M, y, w: CW });

    // Data de nascimento | Nome do responsável
    const half = (CW - 14) / 2;
    const birthStr = fmtDate(child.data_nascimento);

    const yLeft1  = field(doc, {
      label: 'Data de nascimento',
      value: birthStr,
      hint: 'DD/MM/AAAA',
      x: M,
      y,
      w: half,
    });

    const yRight1 = field(doc, {
      label: 'Nome do responsável',
      value: responsavel?.nome || null,
      x: M + half + 14,
      y,
      w: half,
    });

    y = Math.max(yLeft1, yRight1);

    // CPF | Telefone
    const yLeft2 = field(doc, {
      label: 'CPF do responsável',
      hint: 'XXX.XXX.XXX-XX',
      x: M,
      y,
      w: half,
    });

    const yRight2 = field(doc, {
      label: 'Telefone',
      value: responsavel?.telefone_principal || null,
      x: M + half + 14,
      y,
      w: half,
    });

    y = Math.max(yLeft2, yRight2) + 6;

    // ── Seção 2 – Uso de Dados ───────────────────────────────────────────────

    doc.save()
      .fontSize(10.5)
      .fillColor(CORAL)
      .font('Helvetica-Bold')
      .text('2.  USO DE DADOS DA CRIANÇA', M, y)
      .restore();

    y += 16;
    hRule(doc, y, CORAL, 0.8);
    y += 14;

    doc.save()
      .fontSize(9.8)
      .fillColor(INK)
      .font('Helvetica')
      .text(
        'Autorizo o Instituto Lumine a utilizar os dados da criança — como nome, idade, informações de saúde, ' +
        'frequência e contato — para organizar e acompanhar as atividades do projeto.',
        M, y, { width: CW, align: 'justify', lineGap: 2 }
      )
      .restore();

    y = doc.y + 8;

    doc.save()
      .fontSize(9.8)
      .fillColor(INK)
      .font('Helvetica')
      .text(
        'O Instituto se compromete a cuidar dessas informações com responsabilidade e não as compartilhar ' +
        'com terceiros, exceto quando necessário para o funcionamento do projeto. Caso necessário, ' +
        'posso solicitar acesso, correção ou exclusão dos dados a qualquer momento pelo contato abaixo.',
        M, y, { width: CW, align: 'justify', lineGap: 2 }
      )
      .restore();

    y = doc.y + 10;

    y = field(doc, {
      label: 'Contato do Instituto',
      hint: 'E-mail ou telefone',
      x: M,
      y,
      w: CW,
    });

    y += 4;

    // ── Seção 3 – Uso de Imagem ──────────────────────────────────────────────

    doc.save()
      .fontSize(10.5)
      .fillColor(CORAL)
      .font('Helvetica-Bold')
      .text('3.  USO DE IMAGEM', M, y)
      .restore();

    y += 16;
    hRule(doc, y, CORAL, 0.8);
    y += 14;

    doc.save()
      .fontSize(9.8)
      .fillColor(INK)
      .font('Helvetica')
      .text(
        'O Instituto Lumine poderá utilizar fotos e vídeos das atividades para fins institucionais. ' +
        'Marque a opção de sua preferência:',
        M, y, { width: CW }
      )
      .restore();

    y = doc.y + 12;

    y = checkbox(doc, 'Autorizo o uso de imagem somente para registros internos da instituição.', M, y, CW);
    y = checkbox(doc,
      'Autorizo o uso de imagem em materiais de comunicação do Instituto (redes sociais, relatórios para parceiros).',
      M, y, CW);
    y = checkbox(doc, 'Não autorizo o uso de imagem.', M, y, CW);

    y += 8;

    // ── Seção 4 – Declaração ─────────────────────────────────────────────────

    doc.save()
      .fontSize(10.5)
      .fillColor(CORAL)
      .font('Helvetica-Bold')
      .text('4.  DECLARAÇÃO', M, y)
      .restore();

    y += 16;
    hRule(doc, y, CORAL, 0.8);
    y += 14;

    doc.save()
      .fontSize(9.8)
      .fillColor(INK)
      .font('Helvetica')
      .text('Declaro que li e estou de acordo com as informações acima.', M, y, { width: CW })
      .restore();

    y = doc.y + 16;

    // Local | Data (side by side)
    const localW = CW * 0.58;
    const dateW  = CW - localW - 14;

    const yLocal = field(doc, { label: 'Local', x: M,                  y, w: localW, hint: 'Cidade' });
    const yDate  = field(doc, { label: 'Data',  x: M + localW + 14, y, w: dateW,  hint: 'DD/MM/AAAA' });
    y = Math.max(yLocal, yDate) + 18;

    // Signature line
    const sigW = CW * 0.68;
    const sigX = M + (CW - sigW) / 2;

    doc.save()
      .moveTo(sigX, y + 28)
      .lineTo(sigX + sigW, y + 28)
      .strokeColor(INK)
      .lineWidth(0.6)
      .stroke()
      .restore();

    doc.save()
      .fontSize(8.5)
      .fillColor(MUTED)
      .font('Helvetica')
      .text('Assinatura do responsável', 0, y + 32, { width: PAGE_W, align: 'center' })
      .restore();

    y += 50;

    field(doc, { label: 'Nome legível', x: sigX, y, w: sigW });

    // ── Footer ───────────────────────────────────────────────────────────────

    const footerY = PAGE_H - 32;
    hRule(doc, footerY - 10);

    doc.save()
      .fontSize(7.5)
      .fillColor(MUTED)
      .font('Helvetica')
      .text(
        `Documento gerado em ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}` +
        `  ·  Instituto Lumine  ·  Ref. ${id}`,
        0, footerY,
        { width: PAGE_W, align: 'center' }
      )
      .restore();

    doc.end();
  });
}

// ─── Supabase query ───────────────────────────────────────────────────────────

async function fetchChildren() {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await db
    .from('criancas')
    .select(
      `id, child_public_id, nome, data_nascimento, enrollment_status,
       responsaveis ( id, nome, telefone_principal, parentesco )`
    )
    .in('enrollment_status', ['matriculado', 'aprovado', 'em_triagem', 'lista_espera'])
    .order('nome');

  if (error) throw error;
  return data || [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📄  Gerando Termos de Autorização de Dados e Imagem…\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let children;
  try {
    children = await fetchChildren();
  } catch (err) {
    console.error('❌  Erro ao buscar dados do banco:', err.message);
    process.exit(1);
  }

  if (children.length === 0) {
    console.log('⚠️   Nenhuma criança encontrada com status ativo.');
    return;
  }

  console.log(`👶  ${children.length} criança(s) encontrada(s)\n`);

  let ok = 0;
  let fail = 0;

  for (const child of children) {
    const responsavel = Array.isArray(child.responsaveis)
      ? child.responsaveis[0]
      : child.responsaveis;

    try {
      const { filename } = await generatePdf(child, responsavel || null);
      const status = child.enrollment_status;
      console.log(`  ✓  ${filename}  [${status}]`);
      ok++;
    } catch (err) {
      console.error(`  ✗  ${child.nome}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n📁  Arquivos em: ${OUTPUT_DIR}`);
  console.log(`✅  ${ok} gerado(s)${fail > 0 ? `  ·  ❌ ${fail} com erro` : ''}\n`);
}

main().catch(err => {
  console.error('❌  Erro fatal:', err.message);
  process.exit(1);
});
