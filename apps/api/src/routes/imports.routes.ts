import { Router } from "express";
import multer from "multer";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest } from "../utils/httpError";
import { parseWorkbookRows } from "../utils/excelImport";
import { writeAuditLog } from "../utils/audit";

export const importsRouter = Router();
importsRouter.use(requireAuth, requireWriteRole("SEGURANCA_TRABALHO"));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

type RowResult = { row: number; data: Record<string, string>; errors: string[] };

function parseDate(value: string): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value);
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function validateDepartments(rows: Record<string, string>[], organizationId: string): Promise<RowResult[]> {
  return Promise.all(
    rows.map(async (data, idx) => {
      const errors: string[] = [];
      if (!data.nome) errors.push("Campo 'nome' é obrigatório.");
      else {
        const dup = await prisma.department.findFirst({ where: { organizationId, nome: data.nome } });
        if (dup) errors.push("Já existe um setor com este nome.");
      }
      return { row: idx + 2, data, errors };
    })
  );
}

async function validatePositions(rows: Record<string, string>[], organizationId: string): Promise<RowResult[]> {
  return Promise.all(
    rows.map(async (data, idx) => {
      const errors: string[] = [];
      if (!data.nome) errors.push("Campo 'nome' é obrigatório.");
      else {
        const dup = await prisma.position.findFirst({ where: { organizationId, nome: data.nome } });
        if (dup) errors.push("Já existe um cargo com este nome.");
      }
      return { row: idx + 2, data, errors };
    })
  );
}

async function validateEmployees(rows: Record<string, string>[], organizationId: string): Promise<RowResult[]> {
  return Promise.all(
    rows.map(async (data, idx) => {
      const errors: string[] = [];
      if (!data.nomeCompleto) errors.push("Campo 'nomeCompleto' é obrigatório.");
      if (!data.cpf) errors.push("Campo 'cpf' é obrigatório.");
      if (!data.matricula) errors.push("Campo 'matricula' é obrigatório.");
      if (!data.dataAdmissao || !parseDate(data.dataAdmissao)) errors.push("Campo 'dataAdmissao' inválido (use AAAA-MM-DD ou DD/MM/AAAA).");

      if (!data.filial) {
        errors.push("Campo 'filial' é obrigatório.");
      } else {
        const branch = await prisma.branch.findFirst({ where: { organizationId, nome: data.filial } });
        if (!branch) errors.push(`Filial "${data.filial}" não encontrada.`);
      }

      if (data.cpf) {
        const dup = await prisma.employee.findFirst({ where: { organizationId, cpf: data.cpf } });
        if (dup) errors.push("CPF já cadastrado.");
      }
      if (data.cargo) {
        const position = await prisma.position.findFirst({ where: { organizationId, nome: data.cargo } });
        if (!position) errors.push(`Cargo "${data.cargo}" não encontrado.`);
      }
      if (data.setor) {
        const department = await prisma.department.findFirst({ where: { organizationId, nome: data.setor } });
        if (!department) errors.push(`Setor "${data.setor}" não encontrado.`);
      }
      return { row: idx + 2, data, errors };
    })
  );
}

async function validatePpeItems(rows: Record<string, string>[], organizationId: string): Promise<RowResult[]> {
  return Promise.all(
    rows.map(async (data, idx) => {
      const errors: string[] = [];
      if (!data.nome) errors.push("Campo 'nome' é obrigatório.");
      if (!data.codigoInterno) errors.push("Campo 'codigoInterno' é obrigatório.");
      if (!data.ca) errors.push("Campo 'ca' é obrigatório.");
      if (!data.caValidade || !parseDate(data.caValidade)) errors.push("Campo 'caValidade' inválido.");
      if (!data.categoria) errors.push("Campo 'categoria' é obrigatório.");
      if (!data.vidaUtilDias || Number.isNaN(Number(data.vidaUtilDias))) errors.push("Campo 'vidaUtilDias' inválido.");

      if (data.codigoInterno) {
        const dup = await prisma.ppeItem.findFirst({ where: { organizationId, codigoInterno: data.codigoInterno } });
        if (dup) errors.push("Código interno já cadastrado.");
      }
      if (data.categoria) {
        const category = await prisma.ppeCategory.findFirst({ where: { organizationId, nome: data.categoria } });
        if (!category) errors.push(`Categoria "${data.categoria}" não encontrada.`);
      }
      return { row: idx + 2, data, errors };
    })
  );
}

const validators: Record<string, (rows: Record<string, string>[], organizationId: string) => Promise<RowResult[]>> = {
  departments: validateDepartments,
  positions: validatePositions,
  employees: validateEmployees,
  ppeItems: validatePpeItems,
};

importsRouter.post("/:type/preview", upload.single("file"), async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const validator = validators[req.params.type];
    if (!validator) throw badRequest("Tipo de importação inválido.");
    if (!req.file) throw badRequest("Nenhum arquivo enviado.");

    const rows = await parseWorkbookRows(req.file.buffer);
    if (rows.length === 0) throw badRequest("A planilha não contém dados.");
    if (rows.length > 2000) throw badRequest("Limite de 2000 linhas por importação.");

    const results = await validator(rows, organizationId);
    res.json({
      total: results.length,
      validas: results.filter((r) => r.errors.length === 0).length,
      invalidas: results.filter((r) => r.errors.length > 0).length,
      linhas: results,
    });
  } catch (err) {
    next(err);
  }
});

importsRouter.post("/:type/commit", upload.single("file"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const validator = validators[req.params.type];
    if (!validator) throw badRequest("Tipo de importação inválido.");
    if (!req.file) throw badRequest("Nenhum arquivo enviado.");

    const rows = await parseWorkbookRows(req.file.buffer);
    const results = await validator(rows, organizationId);
    const invalid = results.filter((r) => r.errors.length > 0);
    if (invalid.length > 0) {
      throw badRequest("A planilha contém linhas inválidas. Corrija-as antes de importar.", { linhas: invalid });
    }

    let imported = 0;
    await prisma.$transaction(async (tx) => {
      for (const { data } of results) {
        if (req.params.type === "departments") {
          await tx.department.create({ data: { organizationId, nome: data.nome, descricao: data.descricao || null, responsavel: data.responsavel || null } });
        } else if (req.params.type === "positions") {
          await tx.position.create({ data: { organizationId, nome: data.nome, descricao: data.descricao || null } });
        } else if (req.params.type === "employees") {
          const position = data.cargo ? await tx.position.findFirst({ where: { organizationId, nome: data.cargo } }) : null;
          const department = data.setor ? await tx.department.findFirst({ where: { organizationId, nome: data.setor } }) : null;
          const branch = await tx.branch.findFirst({ where: { organizationId, nome: data.filial } });
          await tx.employee.create({
            data: {
              organizationId,
              branchId: branch!.id,
              nomeCompleto: data.nomeCompleto,
              cpf: data.cpf,
              matricula: data.matricula,
              dataAdmissao: parseDate(data.dataAdmissao)!,
              email: data.email || null,
              telefone: data.telefone || null,
              positionId: position?.id,
              departmentId: department?.id,
            },
          });
        } else if (req.params.type === "ppeItems") {
          const category = await tx.ppeCategory.findFirst({ where: { organizationId, nome: data.categoria } });
          await tx.ppeItem.create({
            data: {
              organizationId,
              nome: data.nome,
              codigoInterno: data.codigoInterno,
              ca: data.ca,
              caValidade: parseDate(data.caValidade)!,
              categoryId: category!.id,
              fabricante: data.fabricante || null,
              modelo: data.modelo || null,
              unidade: data.unidade || "UN",
              vidaUtilDias: Number(data.vidaUtilDias),
              estoqueMinimo: Number(data.estoqueMinimo || 0),
              estoqueMaximo: Number(data.estoqueMaximo || 0),
              custoUnitario: Number(data.custoUnitario || 0),
            },
          });
        }
        imported++;
      }
      await writeAuditLog(tx, { organizationId, userId, action: "CRIACAO", entityType: `Import:${req.params.type}`, newData: { imported } });
    });

    res.json({ imported });
  } catch (err) {
    next(err);
  }
});
