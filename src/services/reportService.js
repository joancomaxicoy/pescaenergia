const PDFDocument = require('pdfkit');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '../public/images/pescaenergia-logo-rgb.png');

const DEVICE_NAMES = {
  'total': 'Total',
  'depuradora': 'Bomba depuradora',
  'bombaNet': 'Bomba net',
  'clorador': 'Clorador salí',
};

function formatKwh(wh) {
  if (!wh && wh !== 0) return '--';
  const kwh = wh / 1000;
  if (kwh >= 1000) return Math.round(kwh).toLocaleString('ca-ES') + ' kWh';
  return kwh.toFixed(1) + ' kWh';
}

function deviceName(tag) {
  return DEVICE_NAMES[tag] || tag;
}

function generateReportPdf({ period, summary, userName }) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const totalConsumption = summary.totalConsumption || 0;
  const totalGrid = summary.totalGrid || 0;
  const totalSolar = summary.totalSolar || 0;
  const totalExport = summary.totalExport || 0;
  const solarUsed = Math.max(0, totalConsumption - totalGrid);
  const days = summary.daysAnalyzed || 1;
  const selfConsPct = totalConsumption > 0
    ? Math.round((solarUsed / totalConsumption) * 100)
    : 0;
  const solarUsedPct = totalSolar > 0
    ? Math.round((solarUsed / totalSolar) * 100)
    : 0;
  const div = (v) => (days > 0 ? v / days : 0);

  const colorPrimary = '#1a1a2e';
  const colorSolar = '#ffd93d';
  const colorGreen = '#8bc34a';
  const colorRed = '#ff6b6b';
  const colorBlue = '#4a90d9';
  const colorGray = '#666666';
  const colorLight = '#f0f0f0';

  // Capçalera amb logo
  try {
    doc.image(LOGO_PATH, 50, 40, { width: 160 });
  } catch (err) {
    // Si el logo no es pot llegir, seguim sense ell
  }

  doc.moveDown(3);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(colorPrimary)
    .text(`Hola, ${userName || 'usuari'}!`);
  doc.font('Helvetica').fontSize(11).fillColor(colorGray)
    .text('Aquest és el teu informe energètic entre el període:')
    .font('Helvetica-Bold').fillColor(colorPrimary)
    .text(`${period.from} — ${period.to}`)
    .font('Helvetica').fillColor(colorGray)
    .text(`Generat el ${new Date().toLocaleString('ca-ES')}`);
  doc.moveDown(1);

  // Funció per dibuixar una secció de KPIs en dues columnes
  const drawKpiSection = (title, leftRows, rightRows) => {
    doc.x = doc.page.margins.left;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(colorPrimary)
      .text(title);
    doc.moveDown(0.3);

    const colWidth = 245;
    const leftX = doc.page.margins.left;
    const rightX = leftX + colWidth + 20;

    const rowHeight = 26;

    const drawColumn = (rows, x, startY) => {
      let y = startY;
      rows.forEach((row) => {
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
    { label: 'Consum total', value: formatKwh(totalConsumption), color: colorPrimary },
    { label: 'Energia de xarxa', value: formatKwh(totalGrid), color: colorRed },
    { label: 'Energia del sol', value: formatKwh(solarUsed), color: colorGreen },
    { label: '% autoconsum solar', value: selfConsPct + '%', color: colorPrimary },
    { label: 'Dies analitzats', value: days + ' dies', color: colorPrimary },
  ], [
    { label: 'Generació solar', value: formatKwh(totalSolar), color: colorSolar },
    { label: 'Energia aprofitada', value: formatKwh(solarUsed), color: colorGreen },
    { label: 'Excedent energètic', value: formatKwh(totalExport), color: colorBlue },
    { label: '% solar aprofitada', value: solarUsedPct + '%', color: colorPrimary },
    { label: 'Estalvi de CO2', value: '~' + (summary.co2Saved || 0) + ' kg', color: colorGreen },
  ]);

  doc.moveDown(0.5);

  // Resum Solar i Xarxa (donuts)
  const solarSelfConsumed = Math.max(0, totalSolar - totalExport);

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
        .text(pct + '% (' + formatKwh(s.value) + ')', cx + 15, ly, { width: 90 });
      ly += 16;
    });
  };

  const cardTop = doc.y;
  doc.x = doc.page.margins.left;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(colorPrimary)
    .text('Resum Solar i Xarxa');
  doc.moveDown(0.3);

  const donutTop = doc.y;

  // Marc de targeta
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
  drawDonutSection('Origen del consum', formatKwh(totalConsumption), 'Consum total',
    donutCx1, donutTop,
    [
      { label: 'Energia Solar', value: solarUsed, color: '#ffd93d' },
      { label: 'Energia de Xarxa', value: totalGrid, color: '#ff6b6b' },
    ]);
  drawDonutSection('Us de la generacio', formatKwh(totalSolar), 'Generacio total',
    donutCx2, donutTop,
    [
      { label: 'Solar aprofitada', value: solarSelfConsumed, color: '#8bc34a' },
      { label: 'Exportada a la xarxa', value: totalExport, color: '#4a90d9' },
    ]);
  doc.y = donutTop + 185;
  doc.moveDown(0.5);

  // Mitjana diària
  drawKpiSection('Mitjana diària', [
    { label: 'Consum mitjà diari', value: formatKwh(div(totalConsumption)) + '/dia', color: colorPrimary },
    { label: 'Energia de xarxa diària', value: formatKwh(div(totalGrid)) + '/dia', color: colorRed },
    { label: 'Energia del sol diària', value: formatKwh(div(solarUsed)) + '/dia', color: colorGreen },
    { label: '% autoconsum solar', value: selfConsPct + '%', color: colorPrimary },
  ], [
    { label: 'Generació solar diària', value: formatKwh(div(totalSolar)) + '/dia', color: colorSolar },
    { label: 'Energia aprofitada diària', value: formatKwh(div(solarUsed)) + '/dia', color: colorGreen },
    { label: 'Excedent energètic diari', value: formatKwh(div(totalExport)) + '/dia', color: colorBlue },
    { label: '% solar aprofitada', value: solarUsedPct + '%', color: colorPrimary },
    { label: 'Estalvi de CO2 diari', value: '~' + (div(summary.co2Saved || 0)).toFixed(1) + ' kg/dia', color: colorGreen },
  ]);

  // Desglossament per aparells
  const devices = Object.entries(summary.devices || {})
    .filter(([tag]) => tag !== 'total')
    .map(([tag, wh]) => ({ tag, name: deviceName(tag), wh }))
    .sort((a, b) => b.wh - a.wh);

  if (devices.length > 0) {
    doc.addPage();
    doc.x = doc.page.margins.left;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(colorPrimary)
      .text('Desglossament per aparells');
    doc.moveDown(0.2);

    const tableX = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colName = 200;
    const colValue = 110;
    const colPct = 100;
    const headerY = doc.y;

    // Capçalera de taula
    doc.rect(tableX, headerY, tableWidth, 22).fillColor(colorPrimary).fill();
    doc.fillColor('#ffffff')
      .font('Helvetica-Bold').fontSize(10)
      .text('Aparell', tableX + 8, headerY + 6)
      .text('Energia', tableX + colName + 8, headerY + 6, { width: colValue, align: 'right' })
      .text('% del consum', tableX + colName + colValue + 8, headerY + 6, { width: colPct, align: 'right' });

    let rowY = headerY + 22;
    devices.forEach((dev, i) => {
      if (rowY + 22 > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage();
        rowY = doc.page.margins.top;
        doc.rect(tableX, rowY, tableWidth, 22).fillColor(colorPrimary).fill();
        doc.fillColor('#ffffff')
          .font('Helvetica-Bold').fontSize(10)
          .text('Aparell', tableX + 8, rowY + 6)
          .text('Energia', tableX + colName + 8, rowY + 6, { width: colValue, align: 'right' })
          .text('% del consum', tableX + colName + colValue + 8, rowY + 6, { width: colPct, align: 'right' });
        rowY += 22;
      }

      if (i % 2 === 0) {
        doc.rect(tableX, rowY, tableWidth, 22).fillColor('#fafafa').fill();
      }
      doc.fillColor(colorPrimary)
        .font('Helvetica').fontSize(10)
        .text(dev.name, tableX + 8, rowY + 6)
        .text(formatKwh(dev.wh), tableX + colName + 8, rowY + 6, { width: colValue, align: 'right' })
        .text(((dev.wh / (totalConsumption || 1)) * 100).toFixed(1) + '%', tableX + colName + colValue + 8, rowY + 6, { width: colPct, align: 'right' });

      rowY += 22;
    });

    doc.moveDown(0.5);
  }

  doc.font('Helvetica').fontSize(8).fillColor(colorGray)
    .text('Informe generat automàticament per PescaEnergia.', { align: 'center' });

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = { generateReportPdf };
