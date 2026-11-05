import fs from "fs";
import path from "path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env";
import { authRouter } from "./routes/auth.routes";
import { branchesRouter } from "./routes/branches.routes";
import { positionsRouter } from "./routes/positions.routes";
import { departmentsRouter } from "./routes/departments.routes";
import { employeesRouter } from "./routes/employees.routes";
import { ppeCategoriesRouter } from "./routes/ppeCategories.routes";
import { ppeItemsRouter } from "./routes/ppeItems.routes";
import { ppeKitsRouter } from "./routes/ppeKits.routes";
import { positionRequirementsRouter } from "./routes/positionRequirements.routes";
import { suppliersRouter } from "./routes/suppliers.routes";
import { purchasesRouter } from "./routes/purchases.routes";
import { stockRouter } from "./routes/stockMovements.routes";
import { deliveriesRouter } from "./routes/deliveries.routes";
import { ppeReturnsRouter } from "./routes/ppeReturns.routes";
import { chargesRouter } from "./routes/charges.routes";
import { alertsRouter } from "./routes/alerts.routes";
import { notificationsRouter } from "./routes/notifications.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { usersRouter } from "./routes/users.routes";
import { organizationRouter } from "./routes/organization.routes";
import { auditLogsRouter } from "./routes/auditLogs.routes";
import { searchRouter } from "./routes/search.routes";
import { documentsRouter } from "./routes/documents.routes";
import { reportsRouter } from "./routes/reports.routes";
import { importsRouter } from "./routes/imports.routes";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

export const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // A foto da confirmação é protegida: o front a baixa com o header
        // Authorization e a exibe por URL de objeto (blob:) — a prévia da câmera
        // também. O padrão do helmet é "img-src 'self' data:", que bloqueia blob:,
        // e o bloqueio só apareceria em produção, onde o HTML sai desta aplicação.
        // Sem blob: aqui, a prova da entrega do EPI não aparece na tela.
        "img-src": ["'self'", "data:", "blob:"],
      },
    },
  })
);
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/branches", branchesRouter);
app.use("/api/positions", positionsRouter);
app.use("/api/departments", departmentsRouter);
app.use("/api/employees", employeesRouter);
app.use("/api/ppe-categories", ppeCategoriesRouter);
app.use("/api/ppe-items", ppeItemsRouter);
app.use("/api/ppe-kits", ppeKitsRouter);
app.use("/api/position-requirements", positionRequirementsRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/purchases", purchasesRouter);
app.use("/api/stock", stockRouter);
app.use("/api/deliveries", deliveriesRouter);
app.use("/api/returns", ppeReturnsRouter);
app.use("/api/charges", chargesRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/users", usersRouter);
app.use("/api/organization", organizationRouter);
app.use("/api/audit-logs", auditLogsRouter);
app.use("/api/search", searchRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/imports", importsRouter);

// Rota /api desconhecida responde em JSON. Tem de vir antes do frontend, senão o
// cliente receberia o index.html com status 200 e tentaria lê-lo como JSON.
app.use("/api", notFoundHandler);

// ----- Frontend servido pela própria aplicação (produção) -----
// Site e API na mesma origem: o cookie de refresh é SameSite=Lax e o navegador
// não o envia entre domínios distintos. Nas hospedagens gratuitas cada serviço
// recebe um subdomínio próprio (*.onrender.com, *.pages.dev) que o navegador
// trata como site separado, e o login cairia a cada expiração do access token.
if (env.serveWebDir) {
  // Resolvido a partir de apps/api (o pai de src/ e de dist/), e não de
  // process.cwd(), para que o mesmo valor sirva rodando por tsx ou compilado.
  const raizWeb = path.isAbsolute(env.serveWebDir)
    ? env.serveWebDir
    : path.resolve(__dirname, "..", env.serveWebDir);
  const indexHtml = path.join(raizWeb, "index.html");

  if (!fs.existsSync(indexHtml)) {
    throw new Error(
      `SERVE_WEB_DIR aponta para "${raizWeb}", onde não existe index.html. ` +
        `Rode o build do frontend antes de iniciar a aplicação.`
    );
  }

  // Os arquivos de assets levam hash no nome, então podem ser cacheados por muito
  // tempo. O index.html não: cacheado, o navegador continuaria pedindo o JS da
  // versão anterior depois de um deploy, e a tela quebraria sem erro visível.
  app.use(express.static(raizWeb, { index: false, maxAge: "1y" }));
  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexHtml);
  });
}

app.use(notFoundHandler);
app.use(errorHandler);
