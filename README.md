# Oneaboarding

Dashboard de acompanhamento de onboarding de clientes, integrado com Google Sheets e Claude AI.

## Instalação

```bash
npm install
```

## Configuração

Preencha o arquivo `.env` na raiz do projeto:

```env
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_SHEET_ID=id_da_sua_planilha
PORT=3000
```

Adicione o arquivo `credentials.json` (Service Account do Google Cloud) na raiz do projeto.  
A Service Account precisa ter acesso de **Editor** à planilha.

### Estrutura esperada na planilha

**Aba `Clientes`** — cabeçalho na linha 1:
| ID | Nome | DataInicio | Responsavel |

**Aba `Etapas`** — cabeçalho na linha 1:
| ClienteID | EtapaNum | Status | DataConclusao | Observacao |

## Como rodar

```bash
npm start
```

## Acesso

Abra no navegador: [http://localhost:3000](http://localhost:3000)

## Funcionalidades

- Cadastro de clientes com criação automática das 13 etapas de onboarding
- Checklist interativo com marcação de etapas e observações
- Barra de progresso com indicador de prazo (5 dias úteis)
- Templates de WhatsApp prontos para as etapas 2, 3 e 7
- Diagnóstico estratégico gerado por IA (Claude) na etapa 6
