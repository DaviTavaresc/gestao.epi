import { app } from "./app";
import { env } from "./env";

app.listen(env.port, () => {
  console.log(`API do Sistema de Gestão de EPI rodando em http://localhost:${env.port}`);
});
