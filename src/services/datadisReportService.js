const PDFDocument = require('pdfkit');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '../public/images/pescaenergia-logo-rgb.png');

const colorPrimary = '#1a1a2e';
const colorSolar = '#ffd93d';
const colorGreen = '#8bc34a';
const colorRed = '#ff6b6b';
const colorBlue = '#4a90d9';
const colorGray = '#666666';
const colorLight = '#f0f0f0';

function fmtKwh(v) {
  if (v === null || v === undefined) return '--';
  const n = Math.round(v * 1000) / 1000;
  return n.toLocaleString('ca-ES', { maximumFractionDigits: 3 }) + ' kWh';
}

function generateDatadisReportPdf({ period, data, userName }) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const totals = (data && data.totals) || {};
  const rows = (data && data.rows) || [];

  const xarxa = totals.consumptionKwh || 0;
  const aprofitada = totals.selfConsumptionKwh || 0;
  const generacio = totals.generationKwh || 0;
  const excedent = totals.surplusKwh || 0;
  const consumTotal = xarxa + aprofitada;

  const daysSet = new Set(
    rows.map((r) => r.date || (r.datetime || '').split('T')[0]).filter(Boolean)
  );
  const days = daysSet.size || 1;

  const selfPct = consumTotal > 0 ? Math.round((aprofitada / consumTotal) * 100) : 0;
  const usePct = generacio > 0 ? Math.round((aprofitada / generacio) * 100) : 0;
  const co2 = Math.round(generacio * 0.253 * 100) / 100;
  const div = (v) => (days > 0 ? v / days : 0);

  // Capçalera amb logo
  try {
    doc.image(LOGO_PATH, 50, 40, { width: 160 });
  } catch (err) {
    // Si el logo no es pot llegir, seguim sense ell
  }

  doc.moveDown(4);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(colorPrimary)
    .text(`Hola, ${userName || 'usuari'}!`);
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(11).fillColor(colorGray)
    .text('Aquest és el teu informe energètic de Datadis entre el període:', { lineGap: 8 })
    .font('Helvetica-Bold').fillColor(colorPrimary)
    .text(`${period.from} — ${period.to}`, { lineGap: 3 })
    .font('Helvetica').fillColor(colorGray)
    .text(`Generat el ${new Date().toLocaleString('ca-ES')}`, { lineGap: 8 })
    .text(`Distribuidora: ${(data && data.distributor) || 'no indicada'}`);
  doc.moveDown(1);

  // Secció de KPIs en dues columnes
  const drawKpiSection = (title, leftRows, rightRows) => {
    doc.x = doc.page.margins.left;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(colorPrimary)
      .text(title);
    doc.moveDown(0.3);

    const colWidth = 245;
    const leftX = doc.page.margins.left;
    const rightX = leftX + colWidth + 20;

    const rowHeight = 26;

    const drawColumn = (columnRows, x, startY) => {
      let y = startY;
      columnRows.forEach((row) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        doc.roundedRect(x, y, colWidth, rowHeight - 4, 4)
          .fillColor(colorLight)
          .fill();
        doc.fillColor(colorPrimary)
          .font('Helvetica-Bold').fontSize(9)
          .text(row.label, x + 8, y + 4, { width: colWidth - 90 });
        doc.fillColor(row.color || colorPrimary)
          .font('Helvetica-Bold').fontSize(11)
          .text(row.value, x + colWidth - 85, y + 4, { width: 78, align: 'right' });
        y += rowHeight;
      });
      return y;
    };

    const startY = doc.y;
    const leftEnd = drawColumn(leftRows, leftX, startY);
    const rightEnd = drawColumn(rightRows, rightX, startY);
    doc.y = Math.max(leftEnd, rightEnd);

    doc.moveDown(0.5);
    return doc.y;
  };

  // Resum del període
  drawKpiSection('Resum del període', [
    { label: 'Consum total', value: fmtKwh(consumTotal), color: colorPrimary },
    { label: 'Energia de xarxa', value: fmtKwh(xarxa), color: colorRed },
    { label: 'Energia del sol', value: fmtKwh(aprofitada), color: colorGreen },
    { label: '% autoconsum solar', value: selfPct + '%', color: colorPrimary },
    { label: 'Dies analitzats', value: days + ' dies', color: colorPrimary },
  ], [
    { label: 'Generació solar', value: fmtKwh(generacio), color: colorSolar },
    { label: 'Energia aprofitada', value: fmtKwh(aprofitada), color: colorGreen },
    { label: 'Excedent energètic', value: fmtKwh(excedent), color: colorBlue },
    { label: '% solar aprofitada', value: usePct + '%', color: colorPrimary },
    { label: 'Estalvi de CO2', value: '~' + Math.round(co2 * 10) / 10 + ' kg', color: colorGreen },
  ]);

  doc.moveDown(0.5);

  // Resum Solar i Xarxa (donuts)
  const drawDonut = (cx, cy, r, th, segments) => {
    const total = segments.reduce((a, s) => a + s.value, 0);
    if (total <= 0) return;
    let cur = -Math.PI / 2;
    segments.forEach((s) => {
      if (s.value <= 0) return;
      const span = (s.value / total) * Math.PI * 2;
      doc.save();
      doc.lineWidth(th).strokeColor(s.color);
      doc.arc(cx, cy, r, cur, cur + span);
      doc.stroke();
      doc.restore();
      cur += span;
    });
  };

  const drawDonutSection = (title, centerValue, centerLabel, cx, titleY, segments) => {
    const cy = titleY + 60;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#555')
      .text(title, cx - 90, titleY, { width: 180, align: 'center' });
    drawDonut(cx, cy, 38, 16, segments);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(colorPrimary)
      .text(centerValue, cx - 60, cy - 7, { width: 120, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(colorGray)
      .text(centerLabel, cx - 60, cy + 6, { width: 120, align: 'center' });

    const total = segments.reduce((a, s) => a + s.value, 0);
    let ly = cy + 52;
    segments.forEach((s) => {
      const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
      doc.rect(cx - 70, ly + 2, 8, 8).fillColor(s.color).fill();
      doc.fillColor(colorGray).font('Helvetica').fontSize(8)
        .text(s.label, cx - 58, ly, { width: 70 });
      doc.fillColor(colorPrimary).font('Helvetica-Bold').fontSize(8)
        .text(pct + '% (' + fmtKwh(s.value) + ')', cx + 15, ly, { width: 90 });
      ly += 16;
    });
  };

  const cardTop = doc.y;
  doc.x = doc.page.margins.left;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(colorPrimary)
    .text('Resum Solar i Xarxa');
  doc.moveDown(0.3);

  const donutTop = doc.y;

  const cardX = doc.page.margins.left - 10;
  const cardW = doc.page.width - doc.page.margins.left - doc.page.margins.right + 20;
  const cardBottom = donutTop + 175;
  doc.save();
  doc.roundedRect(cardX, cardTop - 8, cardW, cardBottom - cardTop + 16, 12)
    .fillColor('#f8f9fa').fill()
    .lineWidth(1).strokeColor('#b0b0b0').stroke();
  doc.restore();

  const donutCx1 = doc.page.margins.left + 125;
  const donutCx2 = donutCx1 + 245 + 20;
  drawDonutSection('Origen del consum', fmtKwh(consumTotal), 'Consum total',
    donutCx1, donutTop,
    [
      { label: 'Energia Solar', value: aprofitada, color: colorSolar },
      { label: 'Energia de Xarxa', value: xarxa, color: colorRed },
    ]);
  drawDonutSection('Us de la generacio', fmtKwh(generacio), 'Generacio total',
    donutCx2, donutTop,
    [
      { label: 'Solar aprofitada', value: aprofitada, color: colorGreen },
      { label: 'Exportada a la xarxa', value: excedent, color: colorBlue },
    ]);
  doc.y = donutTop + 185;
  doc.moveDown(0.5);

  // Mitjana diària
  drawKpiSection('Mitjana diària', [
    { label: 'Consum mitjà diari', value: fmtKwh(div(consumTotal)) + '/dia', color: colorPrimary },
    { label: 'Energia de xarxa diària', value: fmtKwh(div(xarxa)) + '/dia', color: colorRed },
    { label: 'Energia del sol diària', value: fmtKwh(div(aprofitada)) + '/dia', color: colorGreen },
    { label: '% autoconsum solar', value: selfPct + '%', color: colorPrimary },
  ], [
    { label: 'Generació solar diària', value: fmtKwh(div(generacio)) + '/dia', color: colorSolar },
    { label: 'Energia aprofitada diària', value: fmtKwh(div(aprofitada)) + '/dia', color: colorGreen },
    { label: 'Excedent energètic diari', value: fmtKwh(div(excedent)) + '/dia', color: colorBlue },
    { label: '% solar aprofitada', value: usePct + '%', color: colorPrimary },
    { label: 'Estalvi de CO2 diari', value: '~' + Math.round(div(co2) * 10) / 10 + ' kg/dia', color: colorGreen },
  ]);

  doc.x = doc.page.margins.left;
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(8).fillColor(colorGray)
    .text(
      'Informe generat automàticament per PescaEnergia.',
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'left' }
    );

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = { generateDatadisReportPdf };