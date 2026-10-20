import ExcelJS from "exceljs";
import { Response } from "express";

export type ExcelColumn = { header: string; key: string; width?: number };

export async function sendExcel(
  res: Response,
  filename: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[]
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dados");
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 22 }));
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}
