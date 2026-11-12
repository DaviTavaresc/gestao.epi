import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";
import { allowedBranchIds, canAccessAllBranches } from "../utils/branchScope";
import { armazenamento } from "../utils/storage";
import { excluirFilialEmCascata, levantarImpacto, somarImpacto } from "../utils/excluirFilial";

export const branchesRouter = Router();
branchesRouter.use(requireAuth);

// Um <select> vazio chega como "", não como ausente, e o zod trataria "" como
// um id de empresa. Vazio aqui quer dizer "este registro é a empresa".
const vazioComoNulo = (valor: unknown) => (valor === "" || valor === undefined ? null : valor);

const upsertSchema = z.object({
  nome: z.string().min(2),
  // Empresa a que esta filial pertence. Nulo = o próprio registro é a empresa.
  parentId: z.preprocess(vazioComoNulo, z.string().min(1).nullable()).default(null),
  codigo: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  uf: z.string().max(2).optional().nullable(),
  cidade: z.string().optional().nullable(),
  endereco: z.string().optional().nullable(),
  responsavel: z.string().optional().nullable(),
});

// A árvore tem dois andares e só dois: empresa em cima, filial embaixo.
// Permitir filial de filial criaria uma hierarquia sem fim que nenhuma tela
// sabe desenhar e que faria o escopo de acesso ter de subir recursivamente.
// `idDoRegistro` é informado na edição, para barrar os dois casos em que um
// registro deixaria de ser um andar válido.
async function validarEmpresaPai(
  organizationId: string,
  parentId: string | null,
  idDoRegistro?: string
): Promise<void> {
  if (idDoRegistro) {
    const filhas = await prisma.branch.count({ where: { parentId: idDoRegistro } });
    if (parentId && filhas > 0) {
      throw badRequest(
        `Este registro é uma empresa e já tem ${filhas} filial(is) vinculada(s): ele não pode virar filial de outra. ` +
          "Mova as filiais antes, ou deixe o campo Empresa em branco."
      );
    }
    if (parentId === idDoRegistro) {
      throw badRequest("Uma filial não pode ser vinculada a ela mesma.");
    }
  }

  if (!parentId) return;

  const empresa = await prisma.branch.findFirst({ where: { id: parentId, organizationId } });
  if (!empresa) throw badRequest("Empresa inválida.");
  if (empresa.parentId) {
    throw badRequest(
      `"${empresa.nome}" é uma filial, não uma empresa. Escolha a empresa (o CNPJ) à qual esta filial pertence.`
    );
  }
}

// Listagem: usuários restritos a uma filial só enxergam a própria.
branchesRouter.get("/", async (req, res, next) => {
  try {
    const user = req.user!;
    const status = req.query.status as string | undefined;

    const branches = await prisma.branch.findMany({
      where: {
        organizationId: user.organizationId,
        ...(status ? { status: status as "ATIVO" | "INATIVO" } : {}),
        ...(canAccessAllBranches(user) ? {} : { id: { in: allowedBranchIds(user) } }),
      },
      orderBy: { nome: "asc" },
      // Conta apenas colaboradores ativos — desligados não representam a operação da filial.
      include: {
        parent: { select: { id: true, nome: true, cnpj: true } },
        _count: { select: { employees: { where: { status: "ATIVO" } }, stocks: true, filiais: true } },
      },
    });

    res.json(branches);
  } catch (err) {
    next(err);
  }
});

branchesRouter.get("/:id", async (req, res, next) => {
  try {
    const user = req.user!;
    const branch = await prisma.branch.findFirst({
      where: {
        id: req.params.id,
        organizationId: user.organizationId,
        ...(canAccessAllBranches(user) ? {} : { id: { in: allowedBranchIds(user) } }),
      },
      include: {
        parent: { select: { id: true, nome: true, cnpj: true } },
        filiais: { select: { id: true, nome: true, status: true }, orderBy: { nome: "asc" } },
        _count: { select: { employees: true, deliveries: true } },
      },
    });
    if (!branch) throw notFound("Filial não encontrada.");
    res.json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.post("/", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.branch.findFirst({ where: { organizationId, nome: data.nome } });
    // O nome é único na organização inteira, não dentro de cada empresa, porque
    // é por ele que as telas e os relatórios identificam de onde saiu o EPI.
    // Duas lojas "Centro" em CNPJs diferentes viram o mesmo rótulo no termo de
    // entrega, e aí ninguém sabe qual almoxarifado foi.
    if (existing) {
      throw conflict(
        'Já existe uma empresa ou filial com este nome. Acrescente a cidade ou a empresa para diferenciar — ex.: "Centro (Porto Velho)".'
      );
    }

    await validarEmpresaPai(organizationId, data.parentId);

    const branch = await prisma.branch.create({
      data: { ...data, uf: data.uf?.toUpperCase() ?? null, organizationId },
      include: { parent: { select: { id: true, nome: true } } },
    });
    await writeAuditLog(prisma, { organizationId, userId, action: "CRIACAO", entityType: "Branch", entityId: branch.id, newData: data });

    res.status(201).json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.put("/:id", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Filial não encontrada.");

    const duplicate = await prisma.branch.findFirst({
      where: { organizationId, nome: data.nome, NOT: { id: existing.id } },
    });
    if (duplicate) {
      throw conflict(
        'Já existe uma empresa ou filial com este nome. Acrescente a cidade ou a empresa para diferenciar — ex.: "Centro (Porto Velho)".'
      );
    }

    await validarEmpresaPai(organizationId, data.parentId, existing.id);

    const branch = await prisma.branch.update({
      where: { id: existing.id },
      data: { ...data, uf: data.uf?.toUpperCase() ?? null },
      include: { parent: { select: { id: true, nome: true } } },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "ALTERACAO",
      entityType: "Branch",
      entityId: branch.id,
      oldData: existing,
      newData: data,
    });

    res.json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.patch("/:id/status", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const { status } = z.object({ status: z.enum(["ATIVO", "INATIVO"]) }).parse(req.body);

    const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Filial não encontrada.");

    // Empresa inativa com loja ativa embaixo é um estado que não existe na
    // prática: o CNPJ parou, mas as telas continuariam oferecendo o estoque
    // daquelas lojas. Quem encerra a empresa encerra as filiais primeiro.
    if (status === "INATIVO") {
      const filiaisAtivas = await prisma.branch.count({ where: { parentId: existing.id, status: "ATIVO" } });
      if (filiaisAtivas > 0) {
        throw badRequest(
          `Esta empresa tem ${filiaisAtivas} filial(is) ativa(s). Inative as filiais antes de inativar a empresa.`
        );
      }
    }

    const branch = await prisma.branch.update({ where: { id: existing.id }, data: { status } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "Branch",
      entityId: branch.id,
      newData: { status },
    });

    res.json(branch);
  } catch (err) {
    next(err);
  }
});

// Prévia da exclusão: quanto some junto. A tela mostra esses números antes de
// pedir a confirmação, porque "excluir a empresa" não diz nada sobre apagar o
// histórico de entrega de 69 pessoas — os números dizem.
branchesRouter.get("/:id/impacto", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Cadastro não encontrado.");

    const detalhe = await levantarImpacto(prisma, existing.id);
    res.json({ ...detalhe, totais: somarImpacto(detalhe) });
  } catch (err) {
    next(err);
  }
});

// Exclusão definitiva de uma empresa ou filial, com tudo que depende dela:
// colaboradores lotados nela, entregas, termos assinados, devoluções,
// cobranças, compras, movimentações e estoque. As filiais de uma empresa saem
// junto. Não tem volta e apaga prova legal de entrega de EPI — por isso exige
// digitar o nome exato e está restrita a ADMIN e RH.
//
// O que não some: a conta de acesso, que é desvinculada e inativada, e o
// colaborador que só tinha contrato com esta empresa mas trabalha em outra
// filial, que apenas perde o vínculo. O porquê está em utils/excluirFilial.ts.
branchesRouter.delete("/:id", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Cadastro não encontrado.");

    // A confirmação vem no corpo porque o DELETE é disparado por um clique e
    // o clique sozinho não prova que a pessoa leu o que ia acontecer.
    const { confirmacao } = z
      .object({ confirmacao: z.string().optional() })
      .parse(req.body ?? {});
    if ((confirmacao ?? "").trim() !== existing.nome) {
      throw badRequest(
        `Para excluir, digite o nome exato do cadastro: "${existing.nome}". ` +
          "Esta exclusão apaga o histórico de entregas vinculado e não tem volta."
      );
    }

    const impacto = await levantarImpacto(prisma, existing.id);
    const totais = somarImpacto(impacto);

    // Tudo numa transação só: uma exclusão pela metade deixaria entrega sem
    // colaborador e estoque sem filial. O tempo é alargado porque uma empresa
    // grande tem milhares de linhas para apagar, e o padrão do Prisma (5s)
    // abortaria no meio.
    const arquivos = await prisma.$transaction(
      async (tx) => {
        const removidos = await excluirFilialEmCascata(tx, existing.id);
        // A auditoria é gravada dentro da transação e guarda a contagem do que
        // saiu: depois disso não existe mais nenhum registro para consultar.
        await writeAuditLog(tx, {
          organizationId,
          userId,
          // O enum de auditoria nao tem EXCLUSAO; o codigo ja usa ALTERACAO
          // para apagar entrega. O que marca a exclusao e newData.excluida.
          action: "ALTERACAO",
          entityType: "Branch",
          entityId: existing.id,
          oldData: {
            nome: existing.nome,
            cnpj: existing.cnpj,
            parentId: existing.parentId,
            filiaisExcluidas: impacto.filiais.map((f) => f.nome),
          },
          newData: { excluida: true, ...totais },
        });
        return removidos;
      },
      { timeout: 120_000, maxWait: 20_000 }
    );

    // Arquivos só depois do commit: remoção de arquivo não tem rollback.
    await Promise.all(
      arquivos.map((a) => armazenamento.remover(a.pasta, a.nome).catch(() => undefined))
    );

    res.json({ excluida: existing.nome, filiais: impacto.filiais.map((f) => f.nome), ...totais });
  } catch (err) {
    next(err);
  }
});
