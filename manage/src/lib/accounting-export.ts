// Accounting Pro downloads, generated in the browser from data the API has
// already permission-checked. Loaded lazily (only when someone exports).
import { API_URL } from "./env";

type Identity = { name?: string; legalName?: string | null; ice?: string | null; taxId?: string | null; registryNumber?: string | null; address?: string | null };

const fmt = (v: string | number) => new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
const frDate = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function pdfDoc(orientation: "portrait" | "landscape" = "landscape") {
  const [{ jsPDF }, autoTable] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  return { doc, autoTable: (autoTable as any).default ?? (autoTable as any).autoTable };
}

// Official header on every page: association identity, document title, year.
function header(doc: any, identity: Identity, title: string, subtitle: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(identity.legalName || identity.name || "", 14, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const ids = [identity.ice && `ICE : ${identity.ice}`, identity.taxId && `IF : ${identity.taxId}`, identity.registryNumber && `RC/N° : ${identity.registryNumber}`].filter(Boolean).join("   ·   ");
  if (ids) doc.text(ids, 14, 19);
  if (identity.address) doc.text(identity.address, 14, 23.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(title, w - 14, 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(subtitle, w - 14, 19, { align: "right" });
  doc.setDrawColor(11, 42, 107);
  doc.setLineWidth(0.4);
  doc.line(14, 27, w - 14, 27);
}

function footer(doc: any) {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(`Généré le ${new Date().toLocaleString("fr-MA")} · Page ${i}/${pages}`, w - 14, h - 7, { align: "right" });
    doc.setTextColor(0);
  }
}

const tableStyle = {
  styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.4, overflow: "linebreak" as const },
  headStyles: { fillColor: [11, 42, 107] as [number, number, number], textColor: 255, fontStyle: "bold" as const },
  alternateRowStyles: { fillColor: [244, 246, 251] as [number, number, number] },
  margin: { top: 31, left: 14, right: 14, bottom: 12 },
};

/** Journal, grand livre and balance in one PDF with the association's letterhead. */
export async function exportLegalPackPdf(args: { identity: Identity; year: number; currency: string; entries: any[]; balance: any }) {
  const { identity, year, currency, entries, balance } = args;
  const { doc, autoTable } = await pdfDoc("landscape");
  const subtitle = `Exercice ${year} · Montants en ${currency}`;

  // 1. Journal
  const journalRows: any[] = [];
  let tD = 0, tC = 0;
  for (const e of entries) {
    for (const l of e.lines) {
      journalRows.push([e.number, frDate(e.date), e.journalCode, l.accountCode, l.accountLabel, e.pieceRef ?? "", l.label, Number(l.debit) ? fmt(l.debit) : "", Number(l.credit) ? fmt(l.credit) : "", l.analytic ?? ""]);
      tD += Number(l.debit); tC += Number(l.credit);
    }
  }
  journalRows.push([{ content: "Totaux", colSpan: 7, styles: { fontStyle: "bold", halign: "right" } }, { content: fmt(tD), styles: { fontStyle: "bold" } }, { content: fmt(tC), styles: { fontStyle: "bold" } }, ""]);
  autoTable(doc, {
    ...tableStyle,
    head: [["N° écriture", "Date", "Jnl", "Compte", "Intitulé du compte", "Pièce", "Libellé", "Débit", "Crédit", "Analytique"]],
    body: journalRows,
    columnStyles: { 7: { halign: "right" }, 8: { halign: "right" }, 6: { cellWidth: 70 } },
    didDrawPage: () => header(doc, identity, "Journal général", subtitle),
  });

  // 2. Grand livre: one block per account with a running balance.
  const byAccount = new Map<string, { label: string; rows: any[] }>();
  for (const e of entries) for (const l of e.lines) {
    if (!byAccount.has(l.accountCode)) byAccount.set(l.accountCode, { label: l.accountLabel, rows: [] });
    byAccount.get(l.accountCode)!.rows.push({ e, l });
  }
  const openings = new Map<string, number>((balance.accounts ?? []).map((a: any) => [a.code, Number(a.opening)]));
  doc.addPage();
  const ledgerRows: any[] = [];
  for (const [code, { label, rows }] of [...byAccount.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let running = openings.get(code) ?? 0;
    ledgerRows.push([{ content: `${code} — ${label}`, colSpan: 7, styles: { fontStyle: "bold", fillColor: [226, 232, 245] } }]);
    if (running) ledgerRows.push(["", "", "", "Report à nouveau", "", "", fmt(running)]);
    for (const { e, l } of rows) {
      running += Number(l.debit) - Number(l.credit);
      ledgerRows.push([frDate(e.date), e.number, e.pieceRef ?? "", l.label, Number(l.debit) ? fmt(l.debit) : "", Number(l.credit) ? fmt(l.credit) : "", fmt(running)]);
    }
  }
  autoTable(doc, {
    ...tableStyle,
    startY: 31,
    head: [["Date", "N° écriture", "Pièce", "Libellé", "Débit", "Crédit", "Solde"]],
    body: ledgerRows,
    columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 3: { cellWidth: 100 } },
    didDrawPage: () => header(doc, identity, "Grand livre", subtitle),
  });

  // 3. Balance
  doc.addPage();
  autoTable(doc, {
    ...tableStyle,
    startY: 31,
    head: [["Compte", "Intitulé", "Report", "Mouvements débit", "Mouvements crédit", "Solde débiteur", "Solde créditeur"]],
    body: [
      ...(balance.accounts ?? []).map((a: any) => [a.code, a.label, fmt(a.opening), fmt(a.debit), fmt(a.credit), Number(a.closingDebit) ? fmt(a.closingDebit) : "", Number(a.closingCredit) ? fmt(a.closingCredit) : ""]),
      [{ content: "Totaux", colSpan: 3, styles: { fontStyle: "bold", halign: "right" } }, ...[balance.totals.debit, balance.totals.credit, balance.totals.closingDebit, balance.totals.closingCredit].map((v: string) => ({ content: fmt(v), styles: { fontStyle: "bold" } }))],
    ],
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    didDrawPage: () => header(doc, identity, "Balance générale", `${subtitle} · ${balance.balanced ? "Équilibrée" : "NON ÉQUILIBRÉE"}`),
  });
  footer(doc);
  save(doc.output("blob"), `Pack_comptable_${year}.pdf`);
}

/** CPC and Bilan (simplified model) as one printable PDF. */
export async function exportStatementsPdf(st: any) {
  const { doc, autoTable } = await pdfDoc("portrait");
  const subtitle = `Exercice clos le 31/12/${st.year} · ${st.currency}`;
  const block = (rows: any[]) => rows.map((r) => [r.code, r.label, fmt(r.amount)]);
  autoTable(doc, {
    ...tableStyle,
    head: [["Compte", "Produits d'exploitation", "Montant"]],
    body: [...block(st.cpc.produits), [{ content: "Total des produits", colSpan: 2, styles: { fontStyle: "bold" } }, { content: fmt(st.cpc.totalProduits), styles: { fontStyle: "bold" } }]],
    columnStyles: { 2: { halign: "right" } },
    didDrawPage: () => header(doc, { ...st.identity, name: st.identity.name }, "CPC — Compte de produits et charges", subtitle),
  });
  autoTable(doc, {
    ...tableStyle,
    head: [["Compte", "Charges d'exploitation", "Montant"]],
    body: [
      ...block(st.cpc.charges),
      [{ content: "Total des charges", colSpan: 2, styles: { fontStyle: "bold" } }, { content: fmt(st.cpc.totalCharges), styles: { fontStyle: "bold" } }],
      [{ content: Number(st.cpc.resultat) >= 0 ? "Résultat net — excédent" : "Résultat net — déficit", colSpan: 2, styles: { fontStyle: "bold", fillColor: [226, 232, 245] } },
        { content: fmt(st.cpc.resultat), styles: { fontStyle: "bold", fillColor: [226, 232, 245] } }],
    ],
    columnStyles: { 2: { halign: "right" } },
  });
  doc.addPage();
  autoTable(doc, {
    ...tableStyle,
    startY: 31,
    head: [["Compte", "ACTIF", "Montant"]],
    body: [...block(st.bilan.actif), [{ content: "Total actif", colSpan: 2, styles: { fontStyle: "bold" } }, { content: fmt(st.bilan.totalActif), styles: { fontStyle: "bold" } }]],
    columnStyles: { 2: { halign: "right" } },
    didDrawPage: () => header(doc, st.identity, "Bilan", subtitle),
  });
  autoTable(doc, {
    ...tableStyle,
    head: [["Compte", "PASSIF", "Montant"]],
    body: [
      ...block(st.bilan.passif),
      ["", "Résultat net de l'exercice", fmt(st.bilan.resultat)],
      [{ content: "Total passif", colSpan: 2, styles: { fontStyle: "bold" } }, { content: fmt(st.bilan.totalPassif), styles: { fontStyle: "bold" } }],
    ],
    columnStyles: { 2: { halign: "right" } },
  });
  const y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text("Modèle simplifié établi automatiquement à partir de la balance. À valider par l'expert-comptable avant dépôt.", 14, y);
  doc.setTextColor(0);
  footer(doc);
  save(doc.output("blob"), `CPC_Bilan_${st.year}.pdf`);
}

/** FEC as an Excel workbook, columns in the agreed order, real numbers and dates. */
export async function exportFecXlsx(fec: { year: number; columns: readonly string[]; rows: any[] }, fileTag: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`FEC ${fec.year}`);
  ws.columns = fec.columns.map((c) => ({ header: c, key: c, width: c === "EcritureLib" ? 48 : c === "CompteLib" ? 34 : c === "Projet_Analytique" ? 26 : 14 }));
  for (const r of fec.rows) {
    ws.addRow({ ...r, EcritureDate: new Date(`${r.EcritureDate}T00:00:00Z`), PieceDate: new Date(`${r.PieceDate}T00:00:00Z`), Debit: Number(r.Debit), Credit: Number(r.Credit) });
  }
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2A6B" } };
  ws.getColumn("EcritureDate").numFmt = "dd/mm/yyyy";
  ws.getColumn("PieceDate").numFmt = "dd/mm/yyyy";
  ws.getColumn("Debit").numFmt = "#,##0.00";
  ws.getColumn("Credit").numFmt = "#,##0.00";
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  save(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `FEC_${fileTag}_${fec.year}.xlsx`);
}

/** All supporting documents, each named after its journal entry number. */
export async function exportArchiveZip(slug: string, year: number, items: { entryNumber: string; fileId: number; fileName: string }[], onProgress?: (done: number, total: number) => void) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const used = new Set<string>();
  let done = 0;
  for (const it of items) {
    const res = await fetch(`${API_URL}/api/org/${slug}/files/${it.fileId}`, { credentials: "include" });
    if (!res.ok) throw new Error(`Could not download ${it.fileName}`);
    const safe = it.fileName.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
    let name = `${it.entryNumber}_${safe}`;
    for (let i = 2; used.has(name); i++) name = `${it.entryNumber}_${i}_${safe}`;
    used.add(name);
    zip.file(name, await res.blob());
    onProgress?.(++done, items.length);
  }
  save(await zip.generateAsync({ type: "blob" }), `Pieces_justificatives_${year}.zip`);
}
