const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');

const SHEET = 'Desglossament';
const SHEET_REF = `'${SHEET}'`;
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const DRAWING_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`;

const CHART_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartStyle" Target="style1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartColorStyle" Target="colors1.xml"/></Relationships>`;

const SHEET2_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;

const STYLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartStyle xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" val="18"/>`;

const COLORS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartColorStyle xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" val="4"/>`;

function serie(idx, f, name, color) {
  return `<c:ser>
          <c:idx val="${idx}"/>
          <c:order val="${idx}"/>
          <c:tx><c:strRef><c:f>${f.header}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
          <c:cat><c:strRef><c:f>${f.cat}</c:f><c:strCache><c:ptCount val="0"/></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:f>${f.val}</c:f><c:numCache><c:formatCode val="0.000"/><c:ptCount val="0"/></c:numCache></c:numRef></c:val>
        </c:ser>`;
}

function buildChartXml(n) {
  const last = n + 1;
  const base = (col) => `${SHEET_REF}!$${col}$2:$${col}$${last}`;
  const catRef = `${SHEET_REF}!$A$2:$A$${last}`;
  const refs = {
    D: { header: `${SHEET_REF}!$D$1`, val: base('D'), cat: catRef },
    F: { header: `${SHEET_REF}!$F$1`, val: base('F'), cat: catRef },
    G: { header: `${SHEET_REF}!$G$1`, val: base('G'), cat: catRef },
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:date1904 val="0"/>
  <c:lang val="ca-ES"/>
  <c:roundedCorners val="0"/>
  <c:chart>
    <c:title>
      <c:tx><c:rich>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="ca-ES"/><a:t>Balanç energètic</a:t></a:r></a:p>
      </c:rich></c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:plotArea>
      <c:layout/>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        ${serie(0, refs.D, 'Generació solar', 'FFD93D')}
        ${serie(1, refs.F, 'Consum total', '1A1A2E')}
        ${serie(2, refs.G, 'Excedent / Xarxa', '4A90D9')}
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="2"/>
        <c:numFmt formatCode="General" sourceLinked="0"/>
        <c:crosses val="min"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
        <c:tickLblPos val="nextTo"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines/>
        <c:title><c:tx><c:rich>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:r><a:rPr lang="ca-ES"/><a:t>kWh</a:t></a:r></a:p>
        </c:rich></c:tx><c:overlay val="0"/></c:title>
        <c:numFmt formatCode="0.000" sourceLinked="0"/>
        <c:crossAx val="1"/>
        <c:crosses val="autoZero"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:layout/>
      <c:overlay val="0"/>
      <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="ca-ES"/></a:p></c:txPr>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>23</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>13</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>42</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="3" name="Chart 1"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;

function distinctDays(rows) {
  const set = new Set();
  for (const r of rows) {
    const d = (r && r.date) ? String(r.date).slice(0, 10) : '';
    if (d) set.add(d);
  }
  return set.size;
}

function kwh(wh) {
  return Math.round((wh || 0) / 10) / 100;
}

function fmtTs(ts) {
  const dt = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${String(dt.getFullYear()).slice(2)} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

async function generateStatisticsExcel({ period, balance }) {
  const rows = (balance && Array.isArray(balance.intervals) && balance.intervals) || [];
  if (!rows.length) throw new Error('No hi ha dades de balanç energètic per generar l\'informe Excel.');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PescaEnergia';
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.getRow(1).values = ['Data', 'Consum (xarxa) kWh', 'Excedent kWh', 'Generació kWh', 'Autoconsum kWh', 'Consum total kWh', 'Excedent / Xarxa kWh'];
  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  ws.columns = [
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 13 },
    { width: 14 },
    { width: 14 },
  ];

  for (const r of rows) {
    const consumTotalWh = r.consumption || 0;
    const gridWh = r.grid || 0;
    ws.addRow([
      fmtTs(r.date),
      kwh(gridWh),
      kwh(r.export || 0),
      kwh(r.solar || 0),
      kwh(Math.max(0, consumTotalWh - gridWh)),
    ]);
  }

  const first = 2;
  const last = first + rows.length - 1;
  const totalsRow = last + 1;

  for (let r = first; r <= last; r++) {
    ws.getCell(`F${r}`).value = { formula: `B${r}+E${r}` };
    ws.getCell(`G${r}`).value = { formula: `C${r}-B${r}` };
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G']) {
      ws.getCell(`${col}${r}`).numFmt = '0.000';
    }
  }

  ws.getRow(totalsRow).font = { bold: true };
  ws.getRow(totalsRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8F0' } };
  ws.getCell(`A${totalsRow}`).value = 'TOTALS';
  for (const col of ['B', 'C', 'D', 'E', 'F', 'G']) {
    ws.getCell(`${col}${totalsRow}`).value = { formula: `SUM(${col}${first}:${col}${last})` };
    ws.getCell(`${col}${totalsRow}`).numFmt = '0.000';
  }

  const days = distinctDays(rows);

  const rs = wb.addWorksheet('Resum');
  rs.getCell('A1').value = 'Resum del període';
  rs.getCell('A1').font = { bold: true, size: 13 };
  const g = `${SHEET_REF}!G${totalsRow}`;
  const b = `${SHEET_REF}!B${totalsRow}`;
  const c = `${SHEET_REF}!C${totalsRow}`;
  const d = `${SHEET_REF}!D${totalsRow}`;
  const e = `${SHEET_REF}!E${totalsRow}`;
  const f = `${SHEET_REF}!F${totalsRow}`;

  const itemsPeriode = [
    ['Consum total (kWh)', { formula: f }, '0.000'],
    ['Energia de xarxa (kWh)', { formula: b }, '0.000'],
    ['Energia del sol autoconsumida (kWh)', { formula: e }, '0.000'],
    ['Generació solar (kWh)', { formula: d }, '0.000'],
    ['Excedent d\u2019energia (kWh)', { formula: c }, '0.000'],
    ['Excedent / Xarxa net (kWh)', { formula: g }, '0.000'],
    ['Percentatge d\u2019autoconsum solar', { formula: `${e}/${f}` }, '0%'],
    ['Percentatge de solar aprofitada', { formula: `${e}/${d}` }, '0%'],
    ['Dies analitzats', days, '0'],
    ['Estalvi de CO2 (kg)', { formula: `${d}*0.253` }, '0.000'],
    ['Estalvi econòmic (€)', { formula: `${d}*0.126` }, '0.00 "€"'],
  ];
  itemsPeriode.forEach(([label, val, fmt], i) => {
    const row = i + 2;
    rs.getCell(`A${row}`).value = label;
    const cv = rs.getCell(`B${row}`);
    cv.value = val;
    cv.numFmt = fmt;
  });
  const daysCell = 'B10';

  rs.getCell('A14').value = 'Mitjana diària';
  rs.getCell('A14').font = { bold: true, size: 13 };
  const itemsMitjana = [
    ['Consum mitjà diari (kWh)', `B2/${daysCell}`, '0.000'],
    ['Energia de xarxa diària (kWh)', `B3/${daysCell}`, '0.000'],
    ['Energia del sol autoconsumida diària (kWh)', `B4/${daysCell}`, '0.000'],
    ['Generació solar diària (kWh)', `B5/${daysCell}`, '0.000'],
    ['Excedent energètic diari (kWh)', `B6/${daysCell}`, '0.000'],
    ['Estalvi de CO2 diari (kg)', `B11/${daysCell}`, '0.000'],
  ];
  itemsMitjana.forEach(([label, formula, fmt], i) => {
    const row = i + 15;
    rs.getCell(`A${row}`).value = label;
    const cv = rs.getCell(`B${row}`);
    cv.value = { formula };
    cv.numFmt = fmt;
  });
  rs.getColumn('A').width = 40;
  rs.getColumn('B').width = 18;

  const buf = await wb.xlsx.writeBuffer();
  return injectChart(Buffer.from(buf), rows.length);
}

function injectChart(buf, n) {
  const zip = new AdmZip(buf);

  zip.addFile('xl/charts/chart1.xml', Buffer.from(buildChartXml(n), 'utf8'));
  zip.addFile('xl/charts/style1.xml', Buffer.from(STYLE_XML, 'utf8'));
  zip.addFile('xl/charts/colors1.xml', Buffer.from(COLORS_XML, 'utf8'));
  zip.addFile('xl/charts/_rels/chart1.xml.rels', Buffer.from(CHART_RELS_XML, 'utf8'));
  zip.addFile('xl/drawings/drawing1.xml', Buffer.from(DRAWING_XML, 'utf8'));
  zip.addFile('xl/drawings/_rels/drawing1.xml.rels', Buffer.from(DRAWING_RELS_XML, 'utf8'));
  zip.addFile('xl/worksheets/_rels/sheet2.xml.rels', Buffer.from(SHEET2_RELS_XML, 'utf8'));

  let s2 = zip.readAsText('xl/worksheets/sheet2.xml');
  s2 = s2.replace(
    '</worksheet>',
    '<drawing r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></worksheet>',
  );
  zip.getEntry('xl/worksheets/sheet2.xml').setData(Buffer.from(s2, 'utf8'));

  let ct = zip.readAsText('[Content_Types].xml');
  const overrides =
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
    '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
    '<Override PartName="/xl/charts/style1.xml" ContentType="application/vnd.ms-office.chartstyle+xml"/>' +
    '<Override PartName="/xl/charts/colors1.xml" ContentType="application/vnd.ms-office.chartcolorstyle+xml"/>';
  ct = ct.replace('</Types>', `${overrides}</Types>`);
  zip.getEntry('[Content_Types].xml').setData(Buffer.from(ct, 'utf8'));

  return zip.toBuffer();
}

module.exports = { generateStatisticsExcel, XLSX_CONTENT_TYPE };