# Sistema de Gestão de EPI

Sistema completo de gestão de Equipamentos de Proteção Individual, multiempresa, com rastreabilidade total do ciclo de vida do EPI: compra → estoque → entrega → confirmação eletrônica → troca → devolução → auditoria.

## Stack

- **Frontend**: React + TypeScript + Vite, Tailwind CSS v4, TanStack Query, React Router, React Hook Form + Zod, Recharts.
- **Backend**: Node.js + Express + TypeScript, Prisma ORM, JWT (access + refresh token rotation via cookie httpOnly), Zod.
- **Banco de dados**: PostgreSQL 17 (instalado localmente nesta máquina via winget).

## Pré-requisitos

- **Node.js 20+** e **PostgreSQL 17**.
- Um banco de dados criado (ex.: `epi_db`) com um usuário próprio da aplicação.
- Copie `apps/api/.env.example` para `apps/api/.env` e preencha com os dados do seu ambiente.
  Esse arquivo contém segredos e por isso não é versionado.

```powershell
# Instalar dependências (na raiz do projeto)
npm install

# Criar as tabelas
npm run prisma:migrate
```

## Como rodar

O sistema tem duas partes que precisam estar no ar ao mesmo tempo: a **API** (porta 4000, fala com o banco) e a
**interface web** (porta 5173, é o que você abre no navegador). Um comando sobe as duas:

```powershell
cd "C:\Users\pneuforte\Documents\PROJETO EPI"
npm run dev
```

Depois acesse **http://localhost:5173**. Para parar, `Ctrl+C` uma vez — derruba as duas.

Se preferir separar em dois terminais (útil para ver o log de cada uma isoladamente):

```powershell
npm run dev:api   # terminal 1 — porta 4000
npm run dev:web   # terminal 2 — porta 5173
```

O Vite faz proxy de `/api` para `http://localhost:4000`, por isso o navegador só precisa da porta 5173.
O PostgreSQL roda como serviço do Windows e inicia sozinho — para conferir: `Get-Service postgresql-x64-17`.

> Se aparecer o erro "execução de scripts foi desabilitada neste sistema", rode uma vez:
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

## Dados de demonstração (apenas desenvolvimento)

```powershell
cd apps/api
npm run prisma:seed
```

Cria uma organização de demonstração com duas filiais (Pará e Amazonas) e cinco usuários:

| Perfil | E-mail | Senha | Filial |
|---|---|---|---|
| Administrador | admin@demoepi.com.br | Demo@12345 | Todas |
| Segurança do Trabalho | seguranca@demoepi.com.br | Demo@12345 | Todas |
| Consulta | consulta@demoepi.com.br | Demo@12345 | Todas |
| Almoxarifado | almoxarifado@demoepi.com.br | Demo@12345 | Filial Pará |
| Almoxarifado | almoxarifado.am@demoepi.com.br | Demo@12345 | Filial Amazonas |

Ou crie sua própria empresa em `/registrar`.

## Filiais

Cada filial é um almoxarifado independente:

- Colaboradores, compras, entregas e movimentações pertencem a uma filial.
- O estoque vive em `BranchStock` (por filial) — o mesmo EPI pode estar zerado no Amazonas e normal no Pará.
- A entrega sempre baixa do estoque da filial do colaborador e bloqueia se não houver saldo **naquela** filial.
- Usuário com filial definida só enxerga e opera a própria filial (regra aplicada no backend, não só na tela).
  Usuário sem filial (`branchId` nulo) tem visão corporativa de todas as filiais — é o caso de Admin e SST.

## Foto na confirmação de recebimento

A confirmação eletrônica aceita uma foto capturada pela câmera do notebook ou do celular, no estilo do registro de
ponto por selfie. A foto é opcional por padrão e pode ser tornada **obrigatória** em Configurações
("Exigir foto do colaborador na confirmação").

- A foto fica fora da pasta pública, servida apenas por rota autenticada e restrita à organização/filial.
- O termo de entrega em PDF traz a foto, a data e a **hora** da entrega, a filial e os dados da confirmação.
- A captura exige contexto seguro do navegador: funciona em `localhost` e, em produção, **somente sob HTTPS**.
- Atenção à LGPD: imagem de rosto é dado pessoal — defina retenção e informe o colaborador antes de exigir a foto.

## Migrações de banco

```powershell
cd apps/api
npx prisma migrate dev --name minha_mudanca   # ambiente interativo
npx prisma studio                              # inspecionar dados visualmente
```

## Estrutura

```
apps/
  api/      Backend Express + Prisma
    prisma/schema.prisma   Schema completo (todas as entidades)
    src/routes/            Um arquivo por módulo (employees, deliveries, purchases, ...)
  web/      Frontend React
    src/pages/              Uma pasta por módulo do menu
    src/components/ui/      Componentes de UI reutilizáveis
```

## O que está implementado

Autenticação (login, registro de empresa, recuperação de senha, sessão persistente), RBAC real no backend (4 perfis),
multiempresa com isolamento por `organizationId` em toda consulta, **filiais com estoque e acesso próprios**,
Colaboradores/Cargos/Setores, EPIs/Categorias/Kits, Matriz Cargo x EPI com motor de regras (CA vencido bloqueia entrega,
estoque insuficiente na filial bloqueia, etc.), Estoque por filial com movimentações auditáveis, Compras com recebimento
transacional (entrada na filial de destino), Fornecedores, Entregas com fluxo completo (preparação inteligente → baixa do
estoque da filial → confirmação eletrônica por digitação de nome **+ foto pela câmera** → termo de entrega em PDF com a
foto e o horário), Devoluções, Trocas, Calendário de substituições, Alertas automáticos por filial (estoque, CA, vida
útil), Notificações roteadas por perfil e filial, Relatórios (17 tipos, exportação Excel/PDF), Custos, Auditoria
completa, Usuários/Permissões/Filial, Configurações da empresa (incluindo logo), Busca global, Importação de planilhas
Excel com validação prévia.

## Pendências conhecidas / próximos passos sugeridos

- Mapeamento de colunas customizável na importação Excel (hoje usa cabeçalhos fixos documentados em cada modal de importação).
- Envio de e-mail real para recuperação de senha (hoje, em desenvolvimento, o token é devolvido na própria resposta da API).
- Transferência de estoque entre filiais (hoje o ajuste manual cobre o caso, mas sem um documento de transferência vinculando as duas pontas).
- HTTPS em produção — obrigatório para a câmera funcionar fora de `localhost`.
- Testes automatizados, Docker/CI e rotação dos segredos de desenvolvimento antes de ir para produção.
- Considerar `npm audit fix` nas dependências antes de produção.

## Backup do banco

Dumps contêm dados pessoais (CPF, hashes de senha) e **não são versionados** — ficam apenas na máquina.

```powershell
# Gerar backup
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U postgres -h localhost -d epi_db -f backup-epi_db.sql

# Restaurar
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -d epi_db -f backup-epi_db.sql
```
