// Dados de DEMONSTRAÇÃO para ambiente de desenvolvimento apenas.
// Nunca é executado automaticamente em produção — rode manualmente com `npm run prisma:seed`.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.organization.findFirst();
  if (existing) {
    console.log("Já existem dados no banco. Seed de demonstração não será executado.");
    return;
  }

  const passwordHash = await bcrypt.hash("Demo@12345", 12);

  const organization = await prisma.organization.create({
    data: {
      razaoSocial: "Indústria Demonstração EPI Ltda",
      nomeFantasia: "Demo EPI",
      cnpj: "00000000000191",
      telefone: "(11) 4000-0000",
      email: "contato@demoepi.com.br",
      endereco: "Rua da Segurança, 123 - São Paulo/SP",
    },
  });

  const [filialPara, filialAmazonas] = await Promise.all([
    prisma.branch.create({
      data: {
        organizationId: organization.id,
        nome: "Filial Pará",
        codigo: "PA",
        uf: "PA",
        cidade: "Belém",
        endereco: "Rod. Augusto Montenegro, 1500 - Belém/PA",
        responsavel: "Ricardo Alves",
      },
    }),
    prisma.branch.create({
      data: {
        organizationId: organization.id,
        nome: "Filial Amazonas",
        codigo: "AM",
        uf: "AM",
        cidade: "Manaus",
        endereco: "Av. Torquato Tapajós, 2200 - Manaus/AM",
        responsavel: "Juliana Castro",
      },
    }),
  ]);

  await prisma.user.createMany({
    data: [
      // Admin e SST são corporativos (branchId nulo = enxergam todas as filiais).
      { organizationId: organization.id, name: "Administrador Demo", email: "admin@demoepi.com.br", passwordHash, role: "ADMIN" },
      { organizationId: organization.id, name: "Segurança do Trabalho Demo", email: "seguranca@demoepi.com.br", passwordHash, role: "SEGURANCA_TRABALHO" },
      { organizationId: organization.id, name: "Consulta Demo", email: "consulta@demoepi.com.br", passwordHash, role: "CONSULTA" },
      // Almoxarifes ficam restritos à própria filial.
      {
        organizationId: organization.id,
        branchId: filialPara.id,
        name: "Almoxarifado Pará",
        email: "almoxarifado@demoepi.com.br",
        passwordHash,
        role: "ALMOXARIFADO",
      },
      {
        organizationId: organization.id,
        branchId: filialAmazonas.id,
        name: "Almoxarifado Amazonas",
        email: "almoxarifado.am@demoepi.com.br",
        passwordHash,
        role: "ALMOXARIFADO",
      },
    ],
  });

  const [producao, manutencao] = await Promise.all([
    prisma.department.create({ data: { organizationId: organization.id, nome: "Produção", responsavel: "João Silva" } }),
    prisma.department.create({ data: { organizationId: organization.id, nome: "Manutenção", responsavel: "Maria Souza" } }),
  ]);

  const [soldador, operador] = await Promise.all([
    prisma.position.create({ data: { organizationId: organization.id, nome: "Soldador" } }),
    prisma.position.create({ data: { organizationId: organization.id, nome: "Operador de Máquinas" } }),
  ]);

  const categorias = await Promise.all(
    [
      "Proteção da cabeça",
      "Proteção dos olhos",
      "Proteção auditiva",
      "Proteção respiratória",
      "Proteção das mãos",
      "Proteção dos pés",
      "Proteção do corpo",
      "Proteção contra quedas",
      "Uniformes",
      "Outros",
    ].map((nome) => prisma.ppeCategory.create({ data: { organizationId: organization.id, nome } }))
  );
  const catMap = Object.fromEntries(categorias.map((c) => [c.nome, c.id]));

  const capacete = await prisma.ppeItem.create({
    data: {
      organizationId: organization.id,
      nome: "Capacete de Segurança",
      codigoInterno: "EPI-001",
      ca: "31469",
      caValidade: new Date(Date.now() + 1000 * 60 * 60 * 24 * 400),
      categoryId: catMap["Proteção da cabeça"],
      fabricante: "3M",
      modelo: "H-700",
      vidaUtilDias: 730,
      estoqueMinimo: 10,
      estoqueMaximo: 100,
      custoUnitario: 35.9,
    },
  });

  const mascaraSolda = await prisma.ppeItem.create({
    data: {
      organizationId: organization.id,
      nome: "Máscara de Solda",
      codigoInterno: "EPI-002",
      ca: "28921",
      caValidade: new Date(Date.now() + 1000 * 60 * 60 * 24 * 300),
      categoryId: catMap["Proteção dos olhos"],
      fabricante: "Carbografite",
      modelo: "Super Tig",
      vidaUtilDias: 365,
      estoqueMinimo: 5,
      estoqueMaximo: 40,
      custoUnitario: 89.0,
    },
  });

  const luvaCouro = await prisma.ppeItem.create({
    data: {
      organizationId: organization.id,
      nome: "Luva de Raspa de Couro",
      codigoInterno: "EPI-003",
      ca: "15575",
      caValidade: new Date(Date.now() + 1000 * 60 * 60 * 24 * 500),
      categoryId: catMap["Proteção das mãos"],
      fabricante: "Volk",
      modelo: "Standard",
      vidaUtilDias: 90,
      estoqueMinimo: 20,
      estoqueMaximo: 200,
      custoUnitario: 12.5,
    },
  });

  const botina = await prisma.ppeItem.create({
    data: {
      organizationId: organization.id,
      nome: "Botina de Segurança",
      codigoInterno: "EPI-004",
      ca: "40123",
      caValidade: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
      categoryId: catMap["Proteção dos pés"],
      fabricante: "Bracol",
      modelo: "Flex",
      vidaUtilDias: 365,
      estoqueMinimo: 10,
      estoqueMaximo: 60,
      custoUnitario: 120.0,
    },
  });

  // Camisas do uniforme entram como item de EPI sem Certificado de Aprovação:
  // aproveitam estoque por filial, entrega com confirmação, termo e cobrança,
  // sem controle de validade de CA. Um item por tamanho, já que o tamanho varia
  // de colaborador para colaborador.
  const camisas: { item: Awaited<ReturnType<typeof prisma.ppeItem.create>>; tamanho: string }[] = [];
  const modelosDeCamisa = [
    { base: "Camisa Manga Curta", prefixo: "CAM-MC", tamanhos: ["P", "M", "G", "GG", "XG"], custo: 45.0 },
    { base: "Camisa Manga Longa", prefixo: "CAM-ML", tamanhos: ["P", "M", "G", "GG"], custo: 56.0 },
  ];
  for (const modelo of modelosDeCamisa) {
    for (const tamanho of modelo.tamanhos) {
      const item = await prisma.ppeItem.create({
        data: {
          organizationId: organization.id,
          nome: `${modelo.base} - Tam ${tamanho}`,
          codigoInterno: `${modelo.prefixo}-${tamanho}`,
          exigeCa: false,
          categoryId: catMap["Uniformes"],
          vidaUtilDias: 180,
          estoqueMinimo: 5,
          estoqueMaximo: 60,
          custoUnitario: modelo.custo,
          descricao: `Camisa do uniforme, tamanho ${tamanho}. Item sem CA.`,
        },
      });
      camisas.push({ item, tamanho });
    }
  }

  await prisma.ppeKit.create({
    data: {
      organizationId: organization.id,
      nome: "Kit Uniforme (camisa manga curta M)",
      descricao: "Troque o item pelo tamanho do colaborador na preparação da entrega.",
      items: {
        create: [{ ppeItemId: camisas.find((c) => c.item.codigoInterno === "CAM-MC-M")!.item.id, quantidade: 2 }],
      },
    },
  });

  await prisma.positionPpeRequirement.createMany({
    data: [
      { organizationId: organization.id, positionId: soldador.id, ppeItemId: mascaraSolda.id, quantidade: 1 },
      { organizationId: organization.id, positionId: soldador.id, ppeItemId: luvaCouro.id, quantidade: 2 },
      { organizationId: organization.id, positionId: soldador.id, ppeItemId: botina.id, quantidade: 1 },
      { organizationId: organization.id, positionId: operador.id, ppeItemId: capacete.id, quantidade: 1 },
      { organizationId: organization.id, positionId: operador.id, ppeItemId: botina.id, quantidade: 1 },
    ],
  });

  // Estoque é por filial — cada almoxarifado tem seus próprios saldos.
  const estoquePorFilial = [
    { branch: filialPara, item: capacete, atual: 30, min: 10, max: 60 },
    { branch: filialPara, item: mascaraSolda, atual: 12, min: 5, max: 25 },
    { branch: filialPara, item: luvaCouro, atual: 60, min: 20, max: 120 },
    { branch: filialPara, item: botina, atual: 3, min: 10, max: 40 },
    { branch: filialAmazonas, item: capacete, atual: 20, min: 8, max: 40 },
    { branch: filialAmazonas, item: mascaraSolda, atual: 2, min: 5, max: 20 },
    { branch: filialAmazonas, item: luvaCouro, atual: 40, min: 15, max: 80 },
    { branch: filialAmazonas, item: botina, atual: 0, min: 6, max: 30 },
  ];

  for (const { item } of camisas) {
    estoquePorFilial.push(
      { branch: filialPara, item, atual: 20, min: 5, max: 60 },
      { branch: filialAmazonas, item, atual: 15, min: 5, max: 60 }
    );
  }

  for (const linha of estoquePorFilial) {
    await prisma.branchStock.create({
      data: {
        organizationId: organization.id,
        branchId: linha.branch.id,
        ppeItemId: linha.item.id,
        estoqueAtual: linha.atual,
        estoqueMinimo: linha.min,
        estoqueMaximo: linha.max,
      },
    });
  }

  await prisma.employee.createMany({
    data: [
      {
        organizationId: organization.id,
        branchId: filialPara.id,
        nomeCompleto: "Carlos Eduardo Santos",
        cpf: "11144477735",
        matricula: "0001",
        positionId: soldador.id,
        departmentId: producao.id,
        dataAdmissao: new Date(2022, 2, 10),
        email: "carlos.santos@demoepi.com.br",
      },
      {
        organizationId: organization.id,
        branchId: filialPara.id,
        nomeCompleto: "Fernanda Lima",
        cpf: "22255588846",
        matricula: "0002",
        positionId: operador.id,
        departmentId: manutencao.id,
        dataAdmissao: new Date(2023, 5, 1),
        email: "fernanda.lima@demoepi.com.br",
      },
      {
        organizationId: organization.id,
        branchId: filialAmazonas.id,
        nomeCompleto: "Marcos Pereira da Silva",
        cpf: "33366699957",
        matricula: "0003",
        positionId: soldador.id,
        departmentId: producao.id,
        dataAdmissao: new Date(2024, 0, 15),
        email: "marcos.silva@demoepi.com.br",
      },
    ],
  });

  await prisma.supplier.createMany({
    data: [
      {
        organizationId: organization.id,
        razaoSocial: "Equipamentos Norte Ltda",
        nomeFantasia: "EPI Norte",
        cnpj: "12345678000195",
        telefone: "(91) 3222-1000",
        email: "vendas@epinorte.com.br",
        endereco: "Av. Almirante Barroso, 900 - Belém/PA",
      },
      {
        organizationId: organization.id,
        razaoSocial: "Segurança Amazônia Comércio Ltda",
        nomeFantasia: "Segurança Amazônia",
        cnpj: "98765432000110",
        telefone: "(92) 3644-2200",
        email: "comercial@segurancaamazonia.com.br",
        endereco: "Av. Djalma Batista, 1200 - Manaus/AM",
      },
    ],
  });

  await prisma.ppeKit.create({
    data: {
      organizationId: organization.id,
      nome: "Kit Soldador",
      descricao: "Kit completo de EPIs para a função de soldador",
      items: {
        create: [
          { ppeItemId: mascaraSolda.id, quantidade: 1 },
          { ppeItemId: luvaCouro.id, quantidade: 2 },
          { ppeItemId: botina.id, quantidade: 1 },
        ],
      },
    },
  });

  console.log("Seed de demonstração criado com sucesso.");
  console.log("Login: admin@demoepi.com.br / Demo@12345");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
