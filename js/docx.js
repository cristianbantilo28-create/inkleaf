/* Inkleaf — "Share as Word": builds a .docx (a zip of XML parts) from a notebook, on the device, with no library.
   Typed and converted text becomes paragraphs; photos, video posters and any handwriting still in ink become pictures,
   placed in the order they sit on the page; video links become links. */
(function () {
  const IL = (window.IL = window.IL || {});
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const PAGE = () => IL.editor.PAGE;
  const CONTENT_W = 9638 * 635;      // A4 minus 2 cm margins, in EMU (635 EMU per twip)
  const MAX_H = 13800 * 635;
  const esc = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- zip writer (deflate when the browser can, otherwise stored) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try { const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); } catch (e) { return null; }
  }
  async function zip(entries) {
    const enc = new TextEncoder(); const parts = [], central = []; let offset = 0;
    const d = new Date(); const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const e of entries) {
      const name = enc.encode(e.name); const data = e.data instanceof Uint8Array ? e.data : enc.encode(e.data); const crc = crc32(data);
      let method = 0, payload = data;
      if (e.compress !== false && data.length > 80) { const z = await deflate(data); if (z && z.length < data.length) { method = 8; payload = z; } }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, payload.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, payload);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, method, true); cd.setUint16(12, time, true); cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, payload.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + payload.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true); eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: MIME });
  }

  /* ---------- pictures ---------- */
  async function loadImage(blob) { const url = URL.createObjectURL(blob); try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); } }
  function canvasBytes(canvas, type, q) { return new Promise((res, rej) => canvas.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('encode')), type, q)); }
  /* a photo as it sits on the page (rotation baked in), at most 1600 px on its longer side */
  async function photoBytes(blob, rot) {
    const img = await loadImage(blob); const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
    const k = Math.min(1, 1600 / Math.max(w, h)); const rw = Math.round(w * k), rh = Math.round(h * k);
    const a = ((rot || 0) % 360) * Math.PI / 180; const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const cw = Math.max(1, Math.round(rw * c + rh * s)), ch = Math.max(1, Math.round(rw * s + rh * c));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const ctx = cv.getContext('2d');
    ctx.translate(cw / 2, ch / 2); ctx.rotate(a); ctx.drawImage(img, -rw / 2, -rh / 2, rw, rh);
    const png = rot || /png|gif|webp/i.test(blob.type);
    return { data: await canvasBytes(cv, png ? 'image/png' : 'image/jpeg', 0.86), ext: png ? 'png' : 'jpeg', w: cw, h: ch };
  }
  /* the page's ink (highlighter and pen) cropped to what was written, 2 px per page unit, transparent background */
  async function inkBytes(strokes) {
    const P = PAGE(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of strokes) { const pad = (st.width || 2) * 1.5 + 4; for (const p of st.pts) { if (p[0] - pad < x0) x0 = p[0] - pad; if (p[0] + pad > x1) x1 = p[0] + pad; if (p[1] - pad < y0) y0 = p[1] - pad; if (p[1] + pad > y1) y1 = p[1] + pad; } }
    if (!isFinite(x0)) return null;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(P.W, Math.ceil(x1)); y1 = Math.min(P.H, Math.ceil(y1));
    const bw = Math.max(8, x1 - x0), bh = Math.max(8, y1 - y0); const k = 2;
    const cv = document.createElement('canvas'); cv.width = Math.round(bw * k); cv.height = Math.round(bh * k); const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    for (const st of strokes) if (st.kind === 'hl') IL.editor.drawStroke(ctx, st);
    for (const st of strokes) if (st.kind !== 'hl') IL.editor.drawStroke(ctx, st);
    return { data: await canvasBytes(cv, 'image/png'), ext: 'png', w: cv.width, h: cv.height, box: { x: x0, y: y0, w: bw, h: bh } };
  }

  /* ---------- the document ---------- */
  function paragraph(text, style) { return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`; }
  function picture(rId, n, cx, cy, name) {
    return `<w:p><w:pPr><w:spacing w:before="60" w:after="120"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${n}" name="${esc(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  function link(rId, text) { return `<w:p><w:hyperlink r:id="${rId}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:hyperlink></w:p>`; }
  const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  /* picture size in EMU: everything is scaled by the same factor, the page width → the text width, so a photo or a line of
     ink is as large in Word as it is on the page */
  function fit(unitsW, unitsH) {
    let cx = Math.round(unitsW / PAGE().W * CONTENT_W), cy = Math.round(unitsH / PAGE().W * CONTENT_W);
    if (cx > CONTENT_W) { cy = Math.round(cy * CONTENT_W / cx); cx = CONTENT_W; }
    if (cy > MAX_H) { cx = Math.round(cx * MAX_H / cy); cy = MAX_H; }
    return { cx: Math.max(cx, 12700), cy: Math.max(cy, 12700) };
  }
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="1B1F2A"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:color w:val="5B6372"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="2D4FC9"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr><w:rPr><w:i/><w:color w:val="5B6372"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2D4FC9"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;
  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

  /* nb: the notebook record; pages: its page records in order. Resolves a Blob (and reports progress through onProgress(i, n)). */
  async function build(nb, pages, onProgress) {
    const P = PAGE(); const L = IL.editor.SPACING[(nb.settings && nb.settings.spacing) || 'medium'] || 34;
    const body = []; const rels = [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`]; const media = [];
    let rid = 1, pic = 0;
    const addImage = (bytes, ext) => { const n = media.length + 1; media.push({ name: `word/media/image${n}.${ext}`, data: bytes }); const id = 'rId' + (++rid); rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${n}.${ext}"/>`); return id; };
    const addLink = url => { const id = 'rId' + (++rid); rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`); return id; };
    const when = new Date();
    body.push(paragraph(nb.title || 'Notebook', 'Title'));
    body.push(paragraph(`${pages.length} page${pages.length === 1 ? '' : 's'} · from Inkleaf, ${when.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`, 'Subtitle'));
    let skipped = 0;
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi]; onProgress && onProgress(pi, pages.length);
      if (pi > 0) body.push(pageBreak());
      body.push(paragraph(`Page ${pi + 1}`, 'Heading1'));
      const blocks = [];
      (page.rows || []).forEach((t, i) => { if (t && t.trim()) blocks.push({ y: P.top + i * L, order: 0, xml: paragraph(t) }); });
      for (const m of page.media || []) {
        try {
          if (m.type === 'image' && m.key) {
            const rec = await IL.blobs.get(m.key); if (!rec) { skipped++; continue; }
            const im = await photoBytes(rec.blob, m.rot);
            const size = fit(m.w, m.w * im.h / im.w);   // as wide as on the page; the height follows the picture's own proportions
            blocks.push({ y: m.y, order: 1, xml: picture(addImage(im.data, im.ext), ++pic, size.cx, size.cy, rec.name || `Photo ${pic}`) });
          } else if (m.type === 'video') {
            let xml = '';
            if (m.poster) { const rec = await IL.blobs.get(m.poster); if (rec) { const im = await photoBytes(rec.blob, 0); const size = fit(m.w, m.w * im.h / im.w); xml = picture(addImage(im.data, im.ext), ++pic, size.cx, size.cy, m.name || 'Video'); } }
            xml += paragraph(`▶ Video: ${m.name || 'video'}${m.duration ? ` (${Math.round(m.duration)} s)` : ''} — the video itself stays in the notebook.`, 'Caption');
            blocks.push({ y: m.y, order: 1, xml });
          } else if (m.type === 'link' && m.url) {
            blocks.push({ y: m.y, order: 1, xml: link(addLink(m.url), `▶ ${m.name || 'Video link'}: ${m.url}`) });
          }
        } catch (e) { skipped++; console.warn('docx: media skipped', e); }
      }
      const ink = (page.strokes || []).filter(st => st && st.pts && st.pts.length);
      if (ink.length) {
        try {
          const im = await inkBytes(ink);
          if (im) { const size = fit(im.box.w, im.box.h); blocks.push({ y: im.box.y, order: 2, xml: picture(addImage(im.data, 'png'), ++pic, size.cx, size.cy, 'Handwriting') + paragraph('Handwriting (not converted to text)', 'Caption') }); }
        } catch (e) { skipped++; console.warn('docx: ink skipped', e); }
      }
      blocks.sort((a, b) => a.y - b.y || a.order - b.order);
      if (!blocks.length) body.push(paragraph('(empty page)', 'Caption'));
      for (const b of blocks) body.push(b.xml);
    }
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
    const iso = when.toISOString().replace(/\.\d+Z$/, 'Z');
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(nb.title || 'Notebook')}</dc:title><dc:creator>Inkleaf</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
    const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Inkleaf</Application></Properties>`;
    const blob = await zip([
      { name: '[Content_Types].xml', data: CONTENT_TYPES }, { name: '_rels/.rels', data: ROOT_RELS },
      { name: 'word/document.xml', data: document }, { name: 'word/_rels/document.xml.rels', data: docRels }, { name: 'word/styles.xml', data: STYLES },
      { name: 'docProps/core.xml', data: core }, { name: 'docProps/app.xml', data: app },
      ...media.map(m => ({ name: m.name, data: m.data, compress: false }))
    ]);
    onProgress && onProgress(pages.length, pages.length);
    blob.skipped = skipped; return blob;
  }
  const fileName = nb => `${(nb.title || 'Notebook').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Notebook'}.docx`;
  IL.docx = { MIME, build, fileName, zip, crc32 };
})();
