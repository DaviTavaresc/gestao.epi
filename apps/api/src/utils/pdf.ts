import PDFDocument from "pdfkit";
import { Response } from "express";
import fs from "fs";

export function exportListPdf(
  res: Response,
  filename: string,
  title: string,
  columns: { header: string; width: number }[],
  rows: string[][]
) {
  const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).text(title, { align: "left" });
  doc.fontSize(9).fillColor("#64748b").text(`Gerado em ${new Date().toLocaleString("pt-BR")}`);
  doc.moveDown();

  let y = doc.y;
  let x = doc.page.margins.left;
  doc.fontSize(9).fillColor("#0f172a");
  columns.forEach((col) => {
    doc.text(col.header, x, y, { width: col.width, continued: false });
    x += col.width;
  });
  y += 16;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor("#cbd5e1").stroke();
  y += 6;

  for (const row of rows) {
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage({ margin: 40, size: "A4", layout: "landscape" });
      y = doc.page.margins.top;
    }
    x = doc.page.margins.left;
    doc.fontSize(8).fillColor("#1e293b");
    row.forEach((cell, i) => {
      doc.text(cell ?? "", x, y, { width: columns[i].width });
      x += columns[i].width;
    });
    y += 16;
  }

  doc.end();
}

export type DeliveryTermData = {
  organization: { razaoSocial: string; cnpj: string; endereco?: string | null; logoPath?: string | null };
  employee: {
    nomeCompleto: string;
    cpf: string;
    matricula: string;
    cargo?: string | null;
    setor?: string | null;
    filial?: string | null;
  };
  delivery: {
    id: string;
    createdAt: Date;
    motivo: string;
    responsavel: string;
    cancelada?: boolean;
    cancelamentoMotivo?: string | null;
    canceladoEm?: Date | null;
  };
  items: { nome: string; ca: string; quantidade: number; dataPrevistaTroca: Date }[];
  confirmation?: { nomeDigitado: string; confirmedAt: Date; id: string; photoPath?: string | null } | null;
};

export function generateDeliveryTermPdf(res: Response, data: DeliveryTermData) {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="termo-entrega-${data.delivery.id}.pdf"`);
  doc.pipe(res);

  if (data.organization.logoPath && fs.existsSync(data.organization.logoPath)) {
    try {
      doc.image(data.organization.logoPath, 50, 45, { width: 80 });
    } catch {
      // Ignora falha ao renderizar logo — o termo segue sem a imagem.
    }
  }

  doc.fontSize(14).fillColor("#0f172a").text(data.organization.razaoSocial, 150, 50);
  doc.fontSize(9).fillColor("#475569").text(`CNPJ: ${data.organization.cnpj}`, 150);
  if (data.organization.endereco) doc.text(data.organization.endereco, 150);

  doc.moveDown(2);
  doc.fontSize(16).fillColor("#0f172a").text("TERMO DE ENTREGA DE EPI", { align: "center" });

  // Faixa de cancelamento: impede que um termo estornado seja confundido com um válido.
  if (data.delivery.cancelada) {
    doc.moveDown(0.5);
    doc.fontSize(13).fillColor("#b91c1c").text("ENTREGA CANCELADA — DOCUMENTO SEM VALIDADE", { align: "center" });
    doc.fontSize(8).fillColor("#b91c1c");
    if (data.delivery.canceladoEm) {
      doc.text(`Cancelada em ${data.delivery.canceladoEm.toLocaleString("pt-BR")}`, { align: "center" });
    }
    if (data.delivery.cancelamentoMotivo) {
      doc.text(`Justificativa: ${data.delivery.cancelamentoMotivo}`, { align: "center" });
    }
    doc.fillColor("#0f172a");
  }

  doc.moveDown();

  doc.fontSize(10).fillColor("#1e293b");
  doc.text(`Colaborador: ${data.employee.nomeCompleto}`);
  doc.text(`CPF: ${data.employee.cpf}      Matrícula: ${data.employee.matricula}`);
  doc.text(`Cargo: ${data.employee.cargo ?? "-"}      Setor: ${data.employee.setor ?? "-"}`);
  doc.text(`Filial: ${data.employee.filial ?? "-"}`);
  doc.text(
    `Data e hora da entrega: ${data.delivery.createdAt.toLocaleDateString("pt-BR")} às ${data.delivery.createdAt.toLocaleTimeString("pt-BR")}`
  );
  doc.text(`Responsável pela entrega: ${data.delivery.responsavel}`);
  doc.moveDown();

  doc.fontSize(11).text("EPIs entregues", { underline: true });
  doc.moveDown(0.5);

  let y = doc.y;
  const cols = [
    { header: "EPI", width: 200 },
    { header: "CA", width: 80 },
    { header: "Qtd", width: 50 },
    { header: "Troca prevista", width: 110 },
  ];
  let x = doc.page.margins.left;
  doc.fontSize(9).fillColor("#0f172a");
  cols.forEach((c) => {
    doc.text(c.header, x, y, { width: c.width });
    x += c.width;
  });
  y += 16;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
  y += 6;

  for (const item of data.items) {
    x = doc.page.margins.left;
    doc.fontSize(9).fillColor("#1e293b");
    doc.text(item.nome, x, y, { width: cols[0].width });
    x += cols[0].width;
    doc.text(item.ca, x, y, { width: cols[1].width });
    x += cols[1].width;
    doc.text(String(item.quantidade), x, y, { width: cols[2].width });
    x += cols[2].width;
    doc.text(item.dataPrevistaTroca.toLocaleDateString("pt-BR"), x, y, { width: cols[3].width });
    y += 16;
  }

  const left = doc.page.margins.left;
  const fullWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fontSize(9).fillColor("#1e293b").text(
    "Declaro que recebi os EPIs relacionados nesta entrega e estou ciente da responsabilidade pela utilização, " +
      "conservação e comunicação de qualquer necessidade de substituição.",
    left,
    y + 24,
    { width: fullWidth, align: "justify" }
  );
  doc.moveDown();

  doc.fontSize(11).fillColor("#0f172a").text("Confirmação eletrônica", left, doc.y, { width: fullWidth, underline: true });
  doc.moveDown(0.4);

  if (!data.confirmation) {
    doc.fontSize(9).fillColor("#b45309").text(
      "Esta entrega ainda não possui confirmação eletrônica de recebimento.",
      left,
      doc.y,
      { width: fullWidth }
    );
    doc.end();
    return;
  }

  // Dados à esquerda; quando há foto da câmera, ela fica à direita, lado a lado.
  const hasPhoto = !!data.confirmation.photoPath;
  const photoWidth = 130;
  const textWidth = hasPhoto ? fullWidth - photoWidth - 20 : fullWidth;
  const blockTop = doc.y;

  doc.fontSize(9).fillColor("#1e293b");
  doc.text(`Nome informado: ${data.confirmation.nomeDigitado.trim()}`, left, blockTop, { width: textWidth });
  doc.text(`Data e hora: ${data.confirmation.confirmedAt.toLocaleString("pt-BR")}`, left, doc.y, { width: textWidth });
  doc.text(`ID da confirmação: ${data.confirmation.id}`, left, doc.y, { width: textWidth });
  doc.text("Método: Confirmação eletrônica por digitação", left, doc.y, { width: textWidth });
  if (hasPhoto) {
    doc.text("Foto do recebimento capturada no ato da entrega.", left, doc.y, { width: textWidth });
  }

  if (hasPhoto) {
    try {
      doc.image(data.confirmation.photoPath!, left + textWidth + 20, blockTop, { fit: [photoWidth, photoWidth] });
      doc.fontSize(7).fillColor("#64748b").text(
        "Foto do recebimento",
        left + textWidth + 20,
        blockTop + photoWidth + 4,
        { width: photoWidth, align: "center" }
      );
    } catch {
      // Falha ao renderizar a foto não invalida o termo — o restante é emitido normalmente.
    }
  }

  doc.end();
}
