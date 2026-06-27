# taxas-financiamento-caixa — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o repositório público que serve as taxas de financiamento (MCMV/SBPE) como JSON estático versionado, atualizado por GitHub Action e consumido via jsDelivr.

**Architecture:** Script Node/TS (porte do scraper Deno do engaja) que raspa gov.br + BCB e, via lógica pura `decideUpdate`, escreve `data/taxas-financiamento.json` só quando muda. Uma GitHub Action semanal roda o script e commita a mudança. Consumidores fazem `fetch` no JSON via CDN, com seed embutido de fallback. Sem banco, sem servidor — o git é o "banco".

**Tech Stack:** Node 24, TypeScript, tsx (run sem build), Vitest, GitHub Actions, jsDelivr.

**Contexto importante para o executor:**
- O parser (`src/parser.ts`) é um **porte 1:1** de `d:/Projetos Claude/engaja-amiz/supabase/functions/financing-rates-sync/parser.ts` — NÃO reinventar a lógica de regex/âncora.
- A fixture de teste (174 KB) e o teste do parser também vêm do engaja — copiar/portar.
- Os repos `engaja-amiz` e `projeto-simuladores` são **somente leitura** — nunca escrever neles.
- Repo alvo no GitHub: `alexandre-leonardo/taxas-financiamento-caixa` (público). `gh` já está autenticado como `alexandre-leonardo`.
- Diretório de trabalho: `d:/Projetos Claude/taxas-financiamento-caixa` (git já inicializado, branch `main`; a spec já está commitada).

**Convenção de import:** projeto ESM (`"type": "module"`) com `moduleResolution: "Bundler"`. Use imports **sem extensão** (`./parser`, `./types`) — tsx e Vitest resolvem `.ts` automaticamente.

---

## Estrutura de arquivos (decomposição)

| Arquivo | Responsabilidade |
|---------|------------------|
| `src/types.ts` | Contrato: `RatesPayload`, `ParsedRates`, `RateRegion`, `RateByCotistaRegion`, `IndexersRaw`. |
| `src/parser.ts` | Puro: HTML → `ParsedRates` + `isPlausible`. Porte do engaja. |
| `src/sources.ts` | I/O de rede: `fetchGovBrHtml`, `fetchBcbMonthly`, `SOURCE_URL`. |
| `src/update.ts` | Puro: `sha256`, `decideUpdate`, constante `SOURCE_NAME`. Núcleo de decisão. |
| `src/index.ts` | Orquestra: lê arquivo → rede → `decideUpdate` → escreve → exit code. |
| `test/parser.test.ts` | Porte do teste do engaja + caso de layout quebrado. |
| `test/update.test.ts` | `decideUpdate` em 5 cenários. |
| `test/fixtures/mcmv-govbr.html` | Fixture real copiada do engaja. |
| `data/taxas-financiamento.json` | O "banco" — semeado no v0.1.0. |
| `.github/workflows/update-rates.yml` | Cron + dispatch + commit condicional + purge. |
| `package.json`, `tsconfig.json`, `.gitignore` | Scaffold. |
| `.env.example`, `.claude/settings.json`, `CLAUDE.md`, `README.md`, `LICENSE` | Convenções/docs. |
| `docs/migracao-consumidores.md` | Plano de migração documentado. |

---

## Task 1: Scaffold do projeto

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "taxas-financiamento-caixa",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "description": "Fonte única de verdade das taxas de financiamento imobiliário (MCMV/SBPE) da Caixa/gov.br, servida via JSON estático + jsDelivr.",
  "license": "MIT",
  "scripts": {
    "scrape": "tsx src/index.ts",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Criar `.gitignore`**

```
node_modules/
*.log
.env
dist/
```

- [ ] **Step 4: Instalar dependências (gera o `package-lock.json` necessário ao `npm ci` da Action)**

Run: `npm install`
Expected: cria `node_modules/` e `package-lock.json` sem erros.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore package-lock.json
git commit -m "chore: scaffold do projeto (ts + tsx + vitest)"
```

---

## Task 2: Tipos do contrato (`src/types.ts`)

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Criar `src/types.ts`** (contrato idêntico ao engaja)

```ts
// src/types.ts
// Contrato público das taxas. IDÊNTICO ao RatesPayload usado hoje pelo engaja-amiz
// (src/lib/financing/finance/rate.ts) — não alterar shape, para não quebrar consumidores.

export type RateRegion = "N_NE" | "S_SE_CO";

export interface RateByCotistaRegion {
  cotista: Record<RateRegion, number>;
  naoCotista: Record<RateRegion, number>;
}

export interface RatesPayload {
  faixa2: RateByCotistaRegion;
  faixa3: RateByCotistaRegion;
  classeMedia: number;
  indexers: { trMonthlyPct: number; poupancaMonthlyPct: number };
  meta: {
    sourceUrl: string;
    sourceName: string;
    retrievedAt: string; // ISO 8601
    publishedAt: string | null; // "DD/MM/YYYY" do gov.br
    contentHash: string; // sha256 do parsed (faixas/classe-média)
    rulesStale: boolean; // sempre false ao escrever; o cliente recalcula por idade
  };
}

// Saída do parser (sem indexers/meta — só o que sai do HTML do gov.br).
export interface ParsedRates {
  faixa2: RateByCotistaRegion;
  faixa3: RateByCotistaRegion;
  classeMedia: number;
  publishedAt: string | null;
}

// Indexadores crus vindos do BCB (null se a chamada falhou).
export interface IndexersRaw {
  trRaw: number | null;
  poupRaw: number | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: tipos do contrato (RatesPayload, ParsedRates, IndexersRaw)"
```

---

## Task 3: Parser (`src/parser.ts`) — TDD com fixture real

**Files:**
- Create: `test/fixtures/mcmv-govbr.html` (copiar do engaja)
- Create: `test/parser.test.ts`
- Create: `src/parser.ts`

- [ ] **Step 1: Copiar a fixture real do engaja (somente leitura na origem)**

Run (bash):
```bash
mkdir -p test/fixtures
cp "d:/Projetos Claude/engaja-amiz/src/lib/__tests__/fixtures/mcmv-govbr.html" "test/fixtures/mcmv-govbr.html"
wc -c test/fixtures/mcmv-govbr.html
```
Expected: arquivo com ~174025 bytes.

- [ ] **Step 2: Escrever o teste que falha (`test/parser.test.ts`)**

```ts
// test/parser.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMcmvRatesHtml, isPlausible } from "../src/parser";

const html = readFileSync(
  fileURLToPath(new URL("./fixtures/mcmv-govbr.html", import.meta.url)),
  "utf-8",
);

describe("parseMcmvRatesHtml", () => {
  it("extrai taxas conhecidas da fixture", () => {
    const r = parseMcmvRatesHtml(html);
    expect(r.faixa3.cotista.N_NE).toBeCloseTo(7.66, 2);
    expect(r.faixa3.cotista.S_SE_CO).toBeCloseTo(8.16, 2);
    expect(r.classeMedia).toBeCloseTo(10.0, 2);
    expect(r.publishedAt).toMatch(/2026/);
  });

  it("extrai Faixa 2 com 4 valores plausíveis", () => {
    const r = parseMcmvRatesHtml(html);
    expect(r.faixa2.cotista.N_NE).toBeCloseTo(4.75, 2);
    expect(r.faixa2.cotista.S_SE_CO).toBeCloseTo(5.0, 2);
    expect(r.faixa2.naoCotista.N_NE).toBeCloseTo(5.25, 2);
    expect(r.faixa2.naoCotista.S_SE_CO).toBeCloseTo(5.5, 2);
  });

  it("Faixa 3 naoCotista = cotista (tabela sem distinção)", () => {
    const r = parseMcmvRatesHtml(html);
    expect(r.faixa3.naoCotista.N_NE).toBeCloseTo(7.66, 2);
    expect(r.faixa3.naoCotista.S_SE_CO).toBeCloseTo(8.16, 2);
  });
});

describe("isPlausible", () => {
  it("aceita payload completo e plausível", () => {
    expect(isPlausible(parseMcmvRatesHtml(html))).toBe(true);
  });
  it("rejeita taxa fora de 0–20%", () => {
    const bad = parseMcmvRatesHtml(html);
    bad.classeMedia = 99;
    expect(isPlausible(bad)).toBe(false);
  });
  it("rejeita faixa faltando", () => {
    const bad: any = parseMcmvRatesHtml(html);
    delete bad.faixa3;
    expect(isPlausible(bad)).toBe(false);
  });
  it("layout quebrado (sem âncora) → implausível", () => {
    const r = parseMcmvRatesHtml("<html><body>página sem tabela de taxas</body></html>");
    expect(isPlausible(r)).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar o teste para confirmar que falha**

Run: `npx vitest run test/parser.test.ts`
Expected: FAIL — `Failed to resolve import "../src/parser"` (arquivo ainda não existe).

- [ ] **Step 4: Criar `src/parser.ts`** (porte 1:1 do engaja, importando `ParsedRates` de `./types`)

```ts
// src/parser.ts
// Porte 1:1 de engaja-amiz/supabase/functions/financing-rates-sync/parser.ts.
// Parser sem dependência de DOM — roda igual em Node e Vitest.
//
// Âncora "TAXA DE JUROS NOMINAL" isola a tabela de taxas.
// Faixa 2 — janela 300 chars captura os 4 valores do 1º sub-bracket.
// Faixa 3 — 2 valores; cotista === naoCotista (tabela tem uma linha só).
// publishedAt — "Atualizado em DD/MM/YYYY" no rodapé (busca na página inteira).
import type { ParsedRates } from "./types";

/** "4,75%" → 4.75 */
function pct(raw: string): number {
  return parseFloat(raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
}

/** Acha `label` em `text` e extrai os primeiros `count` tokens de % na janela seguinte. */
function pctsAfter(text: string, label: RegExp, count: number, windowSize = 600): number[] {
  const idx = text.search(label);
  if (idx < 0) return [];
  const slice = text.slice(idx, idx + windowSize);
  const matches = slice.match(/\d{1,2},\d{2}\s*%/g) || [];
  return matches.slice(0, count).map(pct);
}

export function parseMcmvRatesHtml(html: string): ParsedRates {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const tableStart = text.search(/TAXA DE JUROS\s+NOMINAL/i);
  const tableText = tableStart >= 0 ? text.slice(tableStart, tableStart + 1200) : text;

  // Faixa 2 — [cotista N_NE, cotista S_SE_CO, naoCotista N_NE, naoCotista S_SE_CO]
  const f2 = pctsAfter(tableText, /Faixa\s*2/i, 4, 300);
  // Faixa 3 — [N_NE, S_SE_CO]; cotista === naoCotista
  const f3 = pctsAfter(tableText, /Faixa\s*3/i, 2);
  // Classe Média — taxa única
  const cm = pctsAfter(tableText, /Classe\s*M[eé]dia/i, 1);

  const dt = text.match(/atualizad[oa][^\/\d]{0,20}(\d{2}\/\d{2}\/\d{4})/i);

  return {
    faixa2: {
      cotista: { N_NE: f2[0], S_SE_CO: f2[1] },
      naoCotista: { N_NE: f2[2], S_SE_CO: f2[3] },
    },
    faixa3: {
      cotista: { N_NE: f3[0], S_SE_CO: f3[1] },
      naoCotista: { N_NE: f3[0], S_SE_CO: f3[1] },
    },
    classeMedia: cm[0],
    publishedAt: dt ? dt[1] : null,
  };
}

export function isPlausible(r: ParsedRates): boolean {
  if (!r?.faixa2 || !r?.faixa3) return false;
  const vals = [
    r.faixa2?.cotista?.N_NE,
    r.faixa2?.cotista?.S_SE_CO,
    r.faixa2?.naoCotista?.N_NE,
    r.faixa2?.naoCotista?.S_SE_CO,
    r.faixa3?.cotista?.N_NE,
    r.faixa3?.cotista?.S_SE_CO,
    r.classeMedia,
  ];
  if (vals.some((v) => typeof v !== "number" || Number.isNaN(v))) return false;
  return vals.every((v) => v > 0 && v < 20);
}
```

- [ ] **Step 5: Rodar o teste para confirmar que passa**

Run: `npx vitest run test/parser.test.ts`
Expected: PASS (7 testes verdes).

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/mcmv-govbr.html test/parser.test.ts src/parser.ts
git commit -m "feat: parser do gov.br (porte do engaja) + testes com fixture real"
```

---

## Task 4: Lógica de decisão (`src/update.ts`) — TDD

**Files:**
- Create: `test/update.test.ts`
- Create: `src/update.ts`

- [ ] **Step 1: Escrever o teste que falha (`test/update.test.ts`)**

```ts
// test/update.test.ts
import { describe, it, expect } from "vitest";
import { decideUpdate, sha256 } from "../src/update";
import type { ParsedRates, RatesPayload } from "../src/types";

const SOURCE = "https://www.gov.br/cidades/mcmv-fgts";

const parsed: ParsedRates = {
  faixa2: { cotista: { N_NE: 4.75, S_SE_CO: 5 }, naoCotista: { N_NE: 5.25, S_SE_CO: 5.5 } },
  faixa3: { cotista: { N_NE: 7.66, S_SE_CO: 8.16 }, naoCotista: { N_NE: 7.66, S_SE_CO: 8.16 } },
  classeMedia: 10,
  publishedAt: "16/04/2026",
};

function makeOld(over: Partial<RatesPayload> = {}): RatesPayload {
  return {
    faixa2: parsed.faixa2,
    faixa3: parsed.faixa3,
    classeMedia: parsed.classeMedia,
    indexers: { trMonthlyPct: 0.1709, poupancaMonthlyPct: 0.6734 },
    meta: {
      sourceUrl: SOURCE,
      sourceName: "Ministério das Cidades — MCMV Linha Financiada",
      retrievedAt: "2026-06-01T00:00:00.000Z",
      publishedAt: "16/04/2026",
      contentHash: sha256(JSON.stringify(parsed)),
      rulesStale: false,
    },
    ...over,
  };
}

const now = new Date("2026-06-27T12:00:00.000Z");

describe("decideUpdate", () => {
  it("não muda quando faixas e indexers são iguais", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: 0.1709, poupRaw: 0.6734 }, now, SOURCE);
    expect(r.changed).toBe(false);
  });

  it("muda quando as faixas mudam (contentHash novo)", () => {
    const parsedNovo = { ...parsed, classeMedia: 11 };
    const r = decideUpdate(makeOld(), parsedNovo, { trRaw: 0.1709, poupRaw: 0.6734 }, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.classeMedia).toBe(11);
    expect(r.payload.meta.contentHash).not.toBe(makeOld().meta.contentHash);
    expect(r.payload.meta.rulesStale).toBe(false);
    expect(r.payload.meta.retrievedAt).toBe(now.toISOString());
  });

  it("muda quando só os indexers mudam (faixas iguais)", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: 0.2, poupRaw: 0.7 }, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.indexers.trMonthlyPct).toBe(0.2);
    expect(r.payload.indexers.poupancaMonthlyPct).toBe(0.7);
  });

  it("guarda anti-zero: BCB null preserva indexers antigos e não marca changed", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: null, poupRaw: null }, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.indexers.trMonthlyPct).toBe(0.1709);
    expect(r.payload.indexers.poupancaMonthlyPct).toBe(0.6734);
  });

  it("guarda anti-zero: BCB 0 preserva indexers antigos", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: 0, poupRaw: 0 }, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.indexers.trMonthlyPct).toBe(0.1709);
  });
});

describe("sha256", () => {
  it("é determinístico e hex de 64 chars", () => {
    const a = sha256("x");
    const b = sha256("x");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `npx vitest run test/update.test.ts`
Expected: FAIL — `Failed to resolve import "../src/update"`.

- [ ] **Step 3: Criar `src/update.ts`**

```ts
// src/update.ts
// Núcleo de decisão — lógica PURA, sem I/O (rede ou disco). Testável em isolamento.
import { createHash } from "node:crypto";
import type { IndexersRaw, ParsedRates, RatesPayload } from "./types";

export const SOURCE_NAME = "Ministério das Cidades — MCMV Linha Financiada";

/** SHA-256 hex de uma string. */
export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Decide se o JSON deve ser reescrito.
 *
 * Regras:
 *  - contentHash = sha256(parsed) — só faixas/classe-média (mesmo sentido do engaja).
 *  - Guarda anti-zero: indexador inválido (null/≤0) preserva o valor anterior (BCB fora do ar
 *    nunca zera bons indexadores).
 *  - changed se a tabela mudou OU se TR/poupança (válidos) mudaram.
 *  - Se nada mudou, retorna o `old` intacto (o chamador não reescreve o arquivo).
 */
export function decideUpdate(
  old: RatesPayload,
  parsed: ParsedRates,
  raw: IndexersRaw,
  now: Date,
  sourceUrl: string,
): { changed: boolean; payload: RatesPayload } {
  const contentHash = sha256(JSON.stringify(parsed));

  const tr =
    typeof raw.trRaw === "number" && raw.trRaw > 0 ? raw.trRaw : old.indexers.trMonthlyPct;
  const poup =
    typeof raw.poupRaw === "number" && raw.poupRaw > 0
      ? raw.poupRaw
      : old.indexers.poupancaMonthlyPct;

  const changed =
    old.meta.contentHash !== contentHash ||
    old.indexers.trMonthlyPct !== tr ||
    old.indexers.poupancaMonthlyPct !== poup;

  if (!changed) return { changed: false, payload: old };

  const payload: RatesPayload = {
    faixa2: parsed.faixa2,
    faixa3: parsed.faixa3,
    classeMedia: parsed.classeMedia,
    indexers: { trMonthlyPct: tr, poupancaMonthlyPct: poup },
    meta: {
      sourceUrl,
      sourceName: SOURCE_NAME,
      retrievedAt: now.toISOString(),
      publishedAt: parsed.publishedAt,
      contentHash,
      rulesStale: false,
    },
  };
  return { changed: true, payload };
}
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `npx vitest run test/update.test.ts`
Expected: PASS (6 testes verdes).

- [ ] **Step 5: Commit**

```bash
git add test/update.test.ts src/update.ts
git commit -m "feat: lógica de decisão decideUpdate com guarda anti-zero + testes"
```

---

## Task 5: Fontes de rede (`src/sources.ts`)

**Files:**
- Create: `src/sources.ts`

- [ ] **Step 1: Criar `src/sources.ts`**

```ts
// src/sources.ts
// I/O de rede isolado. Sem lógica de negócio — só busca e normaliza dados das fontes.
import type { IndexersRaw } from "./types";

export const SOURCE_URL =
  process.env.GOVBR_URL ??
  "https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/mcmv-fgts";

const BCB_BASE = process.env.BCB_BASE ?? "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

/** Baixa o HTML da página MCMV do gov.br. Lança em status não-2xx. */
export async function fetchGovBrHtml(): Promise<string> {
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AmizSim/1.0)" },
  });
  if (!res.ok) throw new Error(`gov.br HTTP ${res.status}`);
  return res.text();
}

/**
 * Última observação de uma série SGS do BCB (valor mensal %).
 * Séries: 7811 (TR mensal), 195 (poupança mensal %).
 * Retorna null em qualquer erro (rede/parse/campo ausente) — nunca lança.
 */
export async function fetchBcbMonthly(serie: number): Promise<number | null> {
  try {
    const res = await fetch(`${BCB_BASE}.${serie}/dados/ultimos/1?formato=json`, {
      headers: { "User-Agent": "AmizSim/1.0" },
    });
    const j = (await res.json()) as Array<{ valor?: string }>;
    const v = j?.[0]?.valor;
    return v != null ? parseFloat(String(v).replace(",", ".")) : null;
  } catch {
    return null;
  }
}

/** Conveniência: busca os dois indexadores em paralelo. */
export async function fetchIndexers(): Promise<IndexersRaw> {
  const [trRaw, poupRaw] = await Promise.all([fetchBcbMonthly(7811), fetchBcbMonthly(195)]);
  return { trRaw, poupRaw };
}
```

- [ ] **Step 2: Verificar que compila (typecheck)**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/sources.ts
git commit -m "feat: fontes de rede (gov.br + BCB SGS 7811/195)"
```

---

## Task 6: Orquestrador (`src/index.ts`)

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Criar `src/index.ts`**

```ts
// src/index.ts
// Entrypoint do scraper: lê o JSON atual, raspa as fontes, decide, escreve se mudou.
// Exit 1 em dados implausíveis ou erro fatal (faz a GitHub Action falhar = alerta visível).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isPlausible, parseMcmvRatesHtml } from "./parser";
import { decideUpdate } from "./update";
import { fetchGovBrHtml, fetchIndexers, SOURCE_URL } from "./sources";
import type { RatesPayload } from "./types";

const DATA_PATH = fileURLToPath(new URL("../data/taxas-financiamento.json", import.meta.url));

async function main(): Promise<void> {
  const old = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as RatesPayload;

  const html = await fetchGovBrHtml();
  const parsed = parseMcmvRatesHtml(html);

  if (!isPlausible(parsed)) {
    console.error("[scrape] taxas implausíveis — abortando sem escrever:", JSON.stringify(parsed));
    process.exit(1);
  }

  const raw = await fetchIndexers();
  const { changed, payload } = decideUpdate(old, parsed, raw, new Date(), SOURCE_URL);

  if (!changed) {
    console.log("[scrape] unchanged — nada a commitar.");
    return;
  }

  writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  console.log(
    `[scrape] atualizado — publishedAt=${payload.meta.publishedAt} ` +
      `retrievedAt=${payload.meta.retrievedAt} ` +
      `tr=${payload.indexers.trMonthlyPct} poup=${payload.indexers.poupancaMonthlyPct}`,
  );
}

main().catch((e) => {
  console.error("[scrape] erro fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros. (Não rodar `npm run scrape` ainda — `data/` será semeado na Task 7.)

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: orquestrador do scraper (lê, raspa, decide, escreve)"
```

---

## Task 7: Seed do dado (`data/taxas-financiamento.json`)

**Files:**
- Create: `data/taxas-financiamento.json`

- [ ] **Step 1: Criar `data/taxas-financiamento.json`** (valores reais; `contentHash: "seed"` força o 1º run a publicar)

```json
{
  "faixa2": {
    "cotista": { "N_NE": 4.75, "S_SE_CO": 5 },
    "naoCotista": { "N_NE": 5.25, "S_SE_CO": 5.5 }
  },
  "faixa3": {
    "cotista": { "N_NE": 7.66, "S_SE_CO": 8.16 },
    "naoCotista": { "N_NE": 7.66, "S_SE_CO": 8.16 }
  },
  "classeMedia": 10,
  "indexers": { "trMonthlyPct": 0.1709, "poupancaMonthlyPct": 0.6734 },
  "meta": {
    "sourceUrl": "https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/mcmv-fgts",
    "sourceName": "Ministério das Cidades — MCMV Linha Financiada",
    "retrievedAt": "2026-06-12T20:39:07.081Z",
    "publishedAt": "16/04/2026",
    "contentHash": "seed",
    "rulesStale": false
  }
}
```

- [ ] **Step 2: Smoke run local do scraper (verificação real de rede)**

Run: `npm run scrape`
Expected: um de dois resultados aceitáveis —
- `[scrape] atualizado — publishedAt=… retrievedAt=… tr=… poup=…` (raspou e reescreveu o JSON), ou
- `[scrape] unchanged — nada a commitar.` (sem mudança).
Em ambos, **sem** `exit 1`. Se sair `taxas implausíveis` ou erro de rede, investigar (pode ser bloqueio do gov.br no ambiente local) e registrar; a Action no GitHub roda em IP de datacenter.

- [ ] **Step 3: Conferir o JSON resultante e restaurar `contentHash: "seed"` se o smoke run o sobrescreveu**

Se o Step 2 reescreveu o arquivo (resultado "atualizado"), o `contentHash` agora é um sha real e os valores estão frescos — **isso é ok e desejável** (commitar o estado fresco). Se preferir manter o seed sentinela para o 1º run oficial da Action, descartar a mudança: `git checkout data/taxas-financiamento.json`.
Decisão padrão: **manter o resultado do smoke run** (dado fresco e real). Validar que o arquivo passa no contrato:

Run: `node --input-type=module -e "import('node:fs').then(fs=>{const p=JSON.parse(fs.readFileSync('data/taxas-financiamento.json','utf8'));console.log('faixa3.cotista', p.faixa3.cotista, 'classeMedia', p.classeMedia, 'hashlen', p.meta.contentHash.length)})"`
Expected: imprime as faixas e um hash (64 chars se foi raspado, ou "seed" se inalterado).

- [ ] **Step 4: Commit**

```bash
git add data/taxas-financiamento.json
git commit -m "feat: seed do data/taxas-financiamento.json (contrato RatesPayload)"
```

---

## Task 8: GitHub Action (`.github/workflows/update-rates.yml`)

**Files:**
- Create: `.github/workflows/update-rates.yml`

- [ ] **Step 1: Criar `.github/workflows/update-rates.yml`**

```yaml
name: Atualiza taxas de financiamento

on:
  schedule:
    - cron: "0 11 * * 1" # segunda 11h UTC = 08h BRT
  workflow_dispatch:

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - run: npm ci

      - name: Testes (guarda — não publica com parser quebrado)
        run: npm test

      - name: Raspar fontes e atualizar JSON se mudou
        run: npm run scrape

      - name: Commit + push + purge jsDelivr (se mudou)
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/taxas-financiamento.json
          if git diff --staged --quiet; then
            echo "Sem mudanças nas taxas."
          else
            PUB=$(jq -r '.meta.publishedAt' data/taxas-financiamento.json)
            RET=$(jq -r '.meta.retrievedAt' data/taxas-financiamento.json)
            git commit -m "chore(rates): atualiza taxas (publishedAt $PUB / retrievedAt $RET)"
            git push
            curl -sf "https://purge.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json" || true
          fi
```

- [ ] **Step 2: Validar YAML (sintaxe)**

Run: `node --input-type=module -e "import('node:fs').then(fs=>{const s=fs.readFileSync('.github/workflows/update-rates.yml','utf8');if(!/workflow_dispatch/.test(s)||!/cron:/.test(s))throw new Error('yaml incompleto');console.log('yaml ok')})"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/update-rates.yml
git commit -m "ci: action semanal de atualização das taxas (cron + dispatch + purge)"
```

---

## Task 9: Convenções e documentação

**Files:**
- Create: `.env.example`, `LICENSE`, `.claude/settings.json`, `CLAUDE.md`, `README.md`, `docs/migracao-consumidores.md`

- [ ] **Step 1: Criar `.env.example`**

```
# taxas-financiamento-caixa — NÃO requer segredos.
# As fontes (gov.br e BCB) são APIs públicas; não há chaves a configurar.
#
# Variáveis OPCIONAIS (apenas para desenvolvimento/teste — sobrescrevem os defaults):
# GOVBR_URL=https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/mcmv-fgts
# BCB_BASE=https://api.bcb.gov.br/dados/serie/bcdata.sgs
```

- [ ] **Step 2: Criar `LICENSE`** (MIT)

```
MIT License

Copyright (c) 2026 Alexandre Leonardo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Criar `.claude/settings.json`** (baseado no template do workspace; permite as ferramentas usadas)

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "deny": [
      "Bash(git push --force*)",
      "Bash(git reset --hard*)",
      "Bash(rm -rf*)"
    ],
    "allow": [
      "Bash(npm install*)",
      "Bash(npm ci)",
      "Bash(npm run scrape)",
      "Bash(npm test)",
      "Bash(npx vitest*)",
      "Bash(npx tsc*)",
      "Bash(node*)",
      "Bash(curl*)",
      "Bash(git status)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git add*)",
      "Bash(git commit*)",
      "Bash(git checkout*)",
      "Bash(git branch*)",
      "Bash(git pull*)",
      "Bash(git init*)",
      "Bash(git push origin main)",
      "Bash(git push*)",
      "Bash(git tag*)",
      "Bash(git fetch*)",
      "Bash(gh repo*)",
      "Bash(gh auth*)"
    ]
  }
}
```

- [ ] **Step 4: Criar `CLAUDE.md`** do projeto

```markdown
# taxas-financiamento-caixa

Fonte única de verdade das taxas de financiamento imobiliário (MCMV/SBPE) da Caixa/gov.br.
Serve um JSON estático versionado, atualizado semanalmente por GitHub Action e distribuído via
jsDelivr. Sem banco, sem servidor — o git é o "banco" (cada commit = uma versão auditável).

## Como funciona

- `src/index.ts` (via `npm run scrape`) raspa gov.br (tabela MCMV) + BCB SGS (TR 7811, poupança 195),
  e reescreve `data/taxas-financiamento.json` **somente quando muda** (`src/update.ts:decideUpdate`).
- A GitHub Action (`.github/workflows/update-rates.yml`) roda toda segunda 08h BRT (e sob demanda
  via `workflow_dispatch`), testa, raspa e commita a mudança; depois faz purge do jsDelivr.
- Consumidores leem o JSON via CDN e caem num seed embutido se o fetch falhar.

## Contrato

`data/taxas-financiamento.json` segue o tipo `RatesPayload` (`src/types.ts`) — **idêntico** ao usado
pelo engaja-amiz. Não alterar o shape sem migrar todos os consumidores.

## URL pública

`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json`

## Comandos

- `npm install` — instala deps.
- `npm test` — roda os testes (parser + decisão).
- `npm run scrape` — roda o scraper localmente (escreve `data/` se mudou).

## Regras

- O parser (`src/parser.ts`) é um porte do engaja — calibrado contra fixture real. Mudou o layout
  do gov.br? Atualize a fixture (`test/fixtures/mcmv-govbr.html`) e recalibre os testes.
- Toda taxa publicada passa por `isPlausible` (0 < v < 20). Implausível → a Action falha, não publica.
- Indexadores do BCB têm guarda anti-zero: falha de rede nunca zera bons valores.
```

- [ ] **Step 5: Criar `README.md`**

```markdown
# taxas-financiamento-caixa

Fonte pública e única de verdade das **taxas de financiamento imobiliário** (MCMV/SBPE) da
Caixa/gov.br, em JSON estático, atualizada semanalmente e servida via CDN. Custo zero.

## URL pública

```
https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json
```

> O `@main` tem cache de borda de até ~12h no jsDelivr (a Action faz purge a cada atualização).
> Para travar uma versão imutável, use uma tag: `…@v0.1.0/data/…`.

## Contrato (`RatesPayload`)

```json
{
  "faixa2": { "cotista": {"N_NE":4.75,"S_SE_CO":5}, "naoCotista": {"N_NE":5.25,"S_SE_CO":5.5} },
  "faixa3": { "cotista": {"N_NE":7.66,"S_SE_CO":8.16}, "naoCotista": {"N_NE":7.66,"S_SE_CO":8.16} },
  "classeMedia": 10,
  "indexers": { "trMonthlyPct": 0.1709, "poupancaMonthlyPct": 0.6734 },
  "meta": {
    "sourceUrl": "https://www.gov.br/cidades/...",
    "sourceName": "Ministério das Cidades — MCMV Linha Financiada",
    "retrievedAt": "2026-06-12T20:39:07.081Z",
    "publishedAt": "16/04/2026",
    "contentHash": "<sha256>",
    "rulesStale": false
  }
}
```

- `faixa2`/`faixa3`: taxa nominal anual (%) por cotista/não-cotista × região (`N_NE`, `S_SE_CO`).
- `classeMedia`: taxa nominal anual (%).
- `indexers`: TR e poupança mensais (%) do BCB.
- `meta.retrievedAt`: quando o dado foi raspado. `meta.publishedAt`: data informada pelo gov.br.
- `meta.rulesStale`: sempre `false` no arquivo; **o cliente recalcula** por idade (ver abaixo).

## Como um app novo consome (fetch + fallback + staleness)

```ts
import type { RatesPayload } from "./types"; // copie o shape de src/types.ts

const RATES_URL =
  "https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json";
const MAX_AGE_DAYS = 21;

// `seed` é um RatesPayload embutido no app (fallback offline).
export async function getFinancingRates(seed: RatesPayload): Promise<RatesPayload> {
  try {
    const res = await fetch(RATES_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return withStaleness((await res.json()) as RatesPayload);
  } catch {
    return withStaleness(seed);
  }
}

function withStaleness(p: RatesPayload): RatesPayload {
  const ageDays = (Date.now() - new Date(p.meta.retrievedAt).getTime()) / 86_400_000;
  return { ...p, meta: { ...p.meta, rulesStale: p.meta.rulesStale || ageDays > MAX_AGE_DAYS } };
}
```

## Desenvolvimento

```bash
npm install
npm test          # parser + lógica de decisão
npm run scrape    # raspa gov.br + BCB; escreve data/ só se mudou
```

## Como atualiza

Uma GitHub Action roda toda segunda 08h BRT (e via *Run workflow* manual). Ela testa, raspa e — se
as taxas ou os indexadores mudaram — commita o novo JSON e faz purge do jsDelivr. Cada atualização
é um commit: o histórico do git é a auditoria das taxas.

## Licença

MIT — as taxas são dado público do gov.br.
```

- [ ] **Step 6: Criar `docs/migracao-consumidores.md`**

```markdown
# Migração dos consumidores para o motor de taxas

Este repositório passa a ser a fonte única das taxas. Os apps abaixo devem migrar de suas fontes
atuais para o JSON público. **Editar esses repos é etapa posterior — este doc só descreve o como.**

URL pública:
`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json`

## projeto-simuladores

Arquivo: `src/hooks/useFinancingRates.ts` (hoje retorna `RATES_BOOTSTRAP` fixo).

Trocar o `queryFn` por um `fetch` na URL acima, mantendo `RATES_BOOTSTRAP` como fallback e o mesmo
shape de retorno (`{ data, isLoading }`). Aplicar `withStaleness` (ver README) para recalcular
`rulesStale` por idade no cliente. Exemplo:

```ts
queryFn: async () => {
  try {
    const res = await fetch(RATES_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return withStaleness(await res.json());
  } catch {
    return withStaleness(RATES_BOOTSTRAP);
  }
}
```

## engaja-amiz

Hoje é a **fonte** (Edge Functions `financing-rates-sync` + `get-financing-rates` + tabela
`financing_rate_versions`). Deve passar a **consumir** o mesmo JSON público, deixando de manter o
scraper próprio. Migração posterior; sem prazo definido aqui.

## Endpoint legado (referência)

`https://api.engaja.amiz.imb.br/functions/v1/get-financing-rates` permanece no ar como referência
até ser decomissionado após a migração dos consumidores.
```

- [ ] **Step 7: Typecheck final e testes completos**

Run: `npx tsc --noEmit && npm test`
Expected: sem erros de tipo; todos os testes verdes (parser + update).

- [ ] **Step 8: Commit**

```bash
git add .env.example LICENSE .claude/settings.json CLAUDE.md README.md docs/migracao-consumidores.md
git commit -m "docs: README, CLAUDE.md, settings, licença e plano de migração"
```

---

## Task 10: Publicar no GitHub (repo público + push + tag v0.1.0)

**Files:** nenhum arquivo novo — operações git/gh.

- [ ] **Step 1: Criar o repositório público e adicionar o remote** (sem push ainda)

Run (bash):
```bash
gh repo create alexandre-leonardo/taxas-financiamento-caixa \
  --public \
  --source=. \
  --remote=origin \
  --description="Fonte única de verdade das taxas de financiamento imobiliário (MCMV/SBPE) da Caixa/gov.br — JSON estático via jsDelivr, atualizado por GitHub Action."
```
Expected: cria o repo no GitHub e configura `origin`. (Se já existir, seguir para o Step 2.)

- [ ] **Step 2: Push do branch main**

Run: `git push -u origin main`
Expected: branch `main` publicado no GitHub.

- [ ] **Step 3: Criar e empurrar a tag `v0.1.0`**

Run (bash):
```bash
git tag -a v0.1.0 -m "v0.1.0 — motor de taxas: scraper + Action semanal + JSON via jsDelivr"
git push origin v0.1.0
```
Expected: tag `v0.1.0` visível no GitHub.

- [ ] **Step 4: Verificações finais (evidência antes de declarar concluído)**

Run (bash):
```bash
echo "== repo ==" ; gh repo view alexandre-leonardo/taxas-financiamento-caixa --json name,visibility,url -q '"\(.name) \(.visibility) \(.url)"'
echo "== tags ==" ; git ls-remote --tags origin
echo "== workflow registrado ==" ; gh workflow list --repo alexandre-leonardo/taxas-financiamento-caixa
echo "== jsDelivr (pode levar minutos p/ propagar) ==" ; curl -sf "https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@v0.1.0/data/taxas-financiamento.json" | head -c 200 || echo "(jsDelivr ainda propagando — normal nos primeiros minutos)"
```
Expected: repo público com URL; tag `v0.1.0` listada; workflow "Atualiza taxas de financiamento" listado. jsDelivr pode demorar alguns minutos para a primeira propagação (não bloquear conclusão por isso).

- [ ] **Step 5: (Opcional) Disparar a Action manualmente para validar o pipeline ponta-a-ponta**

Run: `gh workflow run "Atualiza taxas de financiamento" --repo alexandre-leonardo/taxas-financiamento-caixa`
Expected: run iniciado; conferir em `gh run list --repo alexandre-leonardo/taxas-financiamento-caixa`. Se o gov.br responder, a Action loga "unchanged" ou commita uma atualização.

---

## Self-Review (cobertura da spec)

- **§2 Decisões** → Tasks 1 (stack), 4 (indexers/guarda), 7 (seed), 8 (cron/purge), 9 (MIT/staleness). ✓
- **§3 Arquitetura/fontes** → Tasks 5 (gov.br + BCB), 6 (orquestração). ✓
- **§4 Estrutura** → todas as Tasks cobrem os arquivos listados. ✓
- **§5 Módulos** → types (T2), parser (T3), sources (T5), update (T4), index (T6). ✓
- **§6 Algoritmo decideUpdate** → Task 4 (código + 6 testes incl. guarda anti-zero). ✓
- **§7 Action** → Task 8 (cron `0 11 * * 1`, dispatch, `npm test`, purge). ✓
- **§8 Contrato/consumo** → Task 7 (seed), Task 9 (README snippet fetch+fallback+staleness). ✓
- **§9 Testes** → Tasks 3 e 4 (parser incl. layout quebrado; update 5 cenários). ✓
- **§10 Convenções** → Task 9 (CLAUDE.md, settings, .env.example, LICENSE). Task 1/9/10 (tag v0.1.0). ✓
- **§11 Migração** → Task 9 (`docs/migracao-consumidores.md`). ✓
- **§12 Critérios de aceitação** → cobertos por Tasks 3,4,7,8,9,10 + Step de verificação 10.4. ✓

Sem placeholders. Tipos consistentes entre tasks (`decideUpdate`, `IndexersRaw`, `RatesPayload`,
`fetchIndexers`, `SOURCE_URL`, `sha256`). Nomes de função idênticos onde referenciados.
