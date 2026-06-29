# Cota máxima de financiamento (SBPE) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar `cotaMaxima` (SBPE SAC/Price) ao payload, preenchida por extração com LLM via OpenRouter no CI, com guardas que só publicam dado plausível de fonte oficial.

**Architecture:** Espelha o pipeline atual — fetch I/O isolado em `sources.ts` (nunca lança), decisão pura em `update.ts` (testável), wiring em `index.ts`. A cota entra como os indexadores: guarda anti-lixo preserva o valor anterior se a extração falhar/for implausível.

**Tech Stack:** TypeScript (ESM), Node 24 `fetch` nativo (sem SDK), Vitest, OpenRouter (API OpenAI-compatible) com web search plugin + structured outputs.

**Spec:** `docs/superpowers/specs/2026-06-29-cota-maxima-financiamento-design.md`

---

### Task 1: Tipos + seed + helper de teste

Adiciona `CotaMaxima`/`CotaRaw` aos tipos, torna `cotaMaxima` obrigatório em `RatesPayload`, e
preenche o seed e o helper de teste para manter compilação/testes verdes.

**Files:**
- Modify: `src/types.ts`
- Modify: `data/taxas-financiamento.json`
- Modify: `test/update.test.ts` (helper `makeOld`)

- [ ] **Step 1: Adicionar tipos em `src/types.ts`**

Após a interface `IndexersRaw` (fim do arquivo), e dentro de `RatesPayload`:

```ts
// Em RatesPayload, adicionar o campo cotaMaxima (entre `indexers` e `meta`):
//   indexers: { trMonthlyPct: number; poupancaMonthlyPct: number };
//   cotaMaxima: CotaMaxima;
//   meta: { ... };

// Cota máxima de financiamento SBPE (% do valor do imóvel). Aditivo ao contrato.
export interface CotaMaxima {
  sbpe: { sac: number; price: number };
  fonteUrl: string;
  atualizadoEm: string; // ISO 8601 — quando o pipeline gravou este valor
}

// Saída crua da extração de cota via LLM (null se a chamada/parse falhou).
export interface CotaRaw {
  sac: number;
  price: number;
  fonteUrl: string;
}
```

- [ ] **Step 2: Adicionar `cotaMaxima` ao seed `data/taxas-financiamento.json`**

Inserir entre `"indexers"` e `"meta"`:

```jsonc
  "cotaMaxima": {
    "sbpe": { "sac": 80, "price": 70 },
    "fonteUrl": "https://caixanoticias.caixa.gov.br/Paginas/Not%C3%ADcias/2025/10-OUTUBRO/CAIXA-e-Governo-Federal-fortalecem-politica-habitacional-com-novas-medidas-para-o-credito-imobiliario.aspx",
    "atualizadoEm": "2026-06-29T00:00:00.000Z"
  },
```

- [ ] **Step 3: Atualizar `makeOld` em `test/update.test.ts` para incluir `cotaMaxima`**

No objeto retornado por `makeOld`, antes de `meta:`:

```ts
    cotaMaxima: {
      sbpe: { sac: 80, price: 70 },
      fonteUrl: "https://caixanoticias.caixa.gov.br/x",
      atualizadoEm: "2026-06-01T00:00:00.000Z",
    },
```

- [ ] **Step 4: Rodar testes (devem continuar passando)**

Run: `npm test`
Expected: PASS (os testes existentes ainda passam; nada de novo ainda).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts data/taxas-financiamento.json test/update.test.ts
git commit -m "feat(types): cotaMaxima no contrato + seed SBPE 80/70"
```

---

### Task 2: `isCotaPlausible`

Guarda anti-lixo da cota: faixa, `price ≤ sac` e domínio oficial obrigatório.

**Files:**
- Modify: `src/update.ts`
- Test: `test/update.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao fim de `test/update.test.ts` (e no import: `import { decideUpdate, isCotaPlausible, sha256 } from "../src/update";`):

```ts
describe("isCotaPlausible", () => {
  const ok = { sac: 80, price: 70, fonteUrl: "https://caixanoticias.caixa.gov.br/x" };
  it("aceita cota válida de fonte oficial", () => {
    expect(isCotaPlausible(ok)).toBe(true);
  });
  it("aceita subdomínio gov.br", () => {
    expect(isCotaPlausible({ ...ok, fonteUrl: "https://www.gov.br/cidades/x" })).toBe(true);
  });
  it("rejeita null", () => {
    expect(isCotaPlausible(null)).toBe(false);
  });
  it("rejeita price > sac", () => {
    expect(isCotaPlausible({ ...ok, sac: 70, price: 80 })).toBe(false);
  });
  it("rejeita fora da faixa 30–100", () => {
    expect(isCotaPlausible({ ...ok, sac: 120 })).toBe(false);
    expect(isCotaPlausible({ ...ok, price: 10, sac: 10 })).toBe(false);
  });
  it("rejeita domínio não-oficial (blog)", () => {
    expect(isCotaPlausible({ ...ok, fonteUrl: "https://lokatell.com.br/blog" })).toBe(false);
  });
  it("rejeita fonteUrl malformada", () => {
    expect(isCotaPlausible({ ...ok, fonteUrl: "não é url" })).toBe(false);
  });
  it("rejeita valores NaN", () => {
    expect(isCotaPlausible({ ...ok, sac: NaN })).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npm test`
Expected: FAIL — `isCotaPlausible is not a function` / import inexistente.

- [ ] **Step 3: Implementar `isCotaPlausible` em `src/update.ts`**

Atualizar o import de tipos e adicionar a função (após `sha256`):

```ts
import type { CotaRaw, IndexersRaw, ParsedRates, RatesPayload } from "./types";

/** Cota plausível: SAC/Price em 30–100, price ≤ sac, e fonteUrl em domínio oficial gov.br. */
export function isCotaPlausible(c: CotaRaw | null): c is CotaRaw {
  if (!c) return false;
  const { sac, price, fonteUrl } = c;
  if (typeof sac !== "number" || typeof price !== "number" || Number.isNaN(sac) || Number.isNaN(price))
    return false;
  if (sac < 30 || sac > 100 || price < 30 || price > 100) return false;
  if (price > sac) return false;
  if (typeof fonteUrl !== "string") return false;
  let host: string;
  try {
    host = new URL(fonteUrl).hostname;
  } catch {
    return false;
  }
  return host === "gov.br" || host.endsWith(".gov.br");
}
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `npm test`
Expected: PASS (todos, incluindo o novo bloco).

- [ ] **Step 5: Commit**

```bash
git add src/update.ts test/update.test.ts
git commit -m "feat(update): isCotaPlausible (faixa, price<=sac, dominio oficial)"
```

---

### Task 3: `parseCotaResponse`

Parser puro do conteúdo do LLM → `CotaRaw | null`.

**Files:**
- Modify: `src/sources.ts`
- Test: `test/sources.test.ts` (novo)

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `test/sources.test.ts`:

```ts
// test/sources.test.ts
import { describe, it, expect } from "vitest";
import { parseCotaResponse } from "../src/sources";

describe("parseCotaResponse", () => {
  it("extrai CotaRaw de JSON válido", () => {
    const c = parseCotaResponse('{"sac":80,"price":70,"fonteUrl":"https://x.gov.br"}');
    expect(c).toEqual({ sac: 80, price: 70, fonteUrl: "https://x.gov.br" });
  });
  it("retorna null para JSON inválido", () => {
    expect(parseCotaResponse("isto não é json")).toBeNull();
  });
  it("retorna null se faltar campo", () => {
    expect(parseCotaResponse('{"sac":80,"price":70}')).toBeNull();
  });
  it("retorna null se sac não for número", () => {
    expect(parseCotaResponse('{"sac":"80","price":70,"fonteUrl":"https://x.gov.br"}')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npm test`
Expected: FAIL — `parseCotaResponse` não exportado.

- [ ] **Step 3: Implementar `parseCotaResponse` em `src/sources.ts`**

Adicionar o import de tipo e a função (no topo, junto aos outros exports):

```ts
import type { CotaRaw, IndexersRaw } from "./types";

/** Parser puro do conteúdo do LLM (JSON) → CotaRaw. null se inválido/incompleto. */
export function parseCotaResponse(content: string): CotaRaw | null {
  try {
    const o = JSON.parse(content) as Record<string, unknown>;
    if (typeof o.sac !== "number" || typeof o.price !== "number" || typeof o.fonteUrl !== "string")
      return null;
    return { sac: o.sac, price: o.price, fonteUrl: o.fonteUrl };
  } catch {
    return null;
  }
}
```

(Se `src/sources.ts` já importa `IndexersRaw`, manter um único import de tipos com ambos.)

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources.ts test/sources.test.ts
git commit -m "feat(sources): parseCotaResponse (LLM JSON -> CotaRaw)"
```

---

### Task 4: `fetchCotaMaxima` (I/O OpenRouter)

Chamada de rede ao OpenRouter — nunca lança, retorna `null` em qualquer falha ou sem chave.
Sem teste unitário (I/O, igual aos fetchers do BCB); validado no scrape real (Task 7).

**Files:**
- Modify: `src/sources.ts`

- [ ] **Step 1: Implementar `fetchCotaMaxima` em `src/sources.ts`**

Adicionar as constantes de config (junto a `BCB_BASE`) e a função:

```ts
const OPENROUTER_BASE = process.env.OPENROUTER_BASE ?? "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

const COTA_PROMPT =
  "Você é um verificador de dados oficiais. Descubra a cota máxima de financiamento imobiliário " +
  "SBPE da Caixa Econômica Federal ATUALMENTE VIGENTE, para os sistemas SAC e Price (Tabela Price) " +
  "— o percentual máximo do valor do imóvel que pode ser financiado.\n" +
  "REGRAS:\n" +
  "- Confirme o valor em FONTE OFICIAL: domínio caixa.gov.br (inclui caixanoticias.caixa.gov.br) " +
  "ou gov.br. NÃO aceite blogs, imobiliárias ou portais comerciais como fonte.\n" +
  "- fonteUrl DEVE ser a URL oficial onde o número aparece. Se não conseguir confirmar em fonte " +
  "oficial, retorne sac/price com os valores mais prováveis e fonteUrl como string vazia.\n" +
  "Busque na web quantas vezes precisar para achar a fonte oficial.";

/**
 * Extrai a cota máxima SBPE (SAC/Price) via OpenRouter com web search.
 * Nunca lança: sem OPENROUTER_API_KEY, erro de rede, status não-2xx ou parse inválido → null.
 */
export async function fetchCotaMaxima(): Promise<CotaRaw | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/alexandre-leonardo/taxas-financiamento-caixa",
        "X-Title": "taxas-financiamento-caixa",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        plugins: [{ id: "web", max_results: 10 }],
        messages: [{ role: "user", content: COTA_PROMPT }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "cota_maxima",
            strict: true,
            schema: {
              type: "object",
              properties: {
                sac: { type: "number" },
                price: { type: "number" },
                fonteUrl: { type: "string" },
              },
              required: ["sac", "price", "fonteUrl"],
              additionalProperties: false,
            },
          },
        },
        temperature: 0,
        max_tokens: 600,
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j?.choices?.[0]?.message?.content;
    return content ? parseCotaResponse(content) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Rodar testes (nada deve quebrar)**

Run: `npm test`
Expected: PASS (função nova, não usada ainda).

- [ ] **Step 3: Commit**

```bash
git add src/sources.ts
git commit -m "feat(sources): fetchCotaMaxima via OpenRouter (web search + json_schema)"
```

---

### Task 5: Integrar cota no `decideUpdate` + wiring no `index.ts`

Muda a assinatura de `decideUpdate` (novo param `cotaRaw`) e conecta `fetchCotaMaxima` no pipeline.
Atualiza no mesmo commit os call sites existentes (testes + index) para manter a árvore consistente.

**Files:**
- Modify: `src/update.ts`
- Modify: `src/index.ts`
- Test: `test/update.test.ts`

- [ ] **Step 1: Escrever/atualizar testes (falhando)**

No `test/update.test.ts`: (a) inserir `null` como 4º argumento nas 5 chamadas existentes de
`decideUpdate`; (b) adicionar o bloco de testes de cota abaixo.

Exemplo da atualização das chamadas existentes (inserir `null` antes de `now`):

```ts
// antes: decideUpdate(makeOld(), parsed, { trRaw: 0.1709, poupRaw: 0.6734 }, now, SOURCE)
// depois:
decideUpdate(makeOld(), parsed, { trRaw: 0.1709, poupRaw: 0.6734 }, null, now, SOURCE)
```

Novo bloco (no fim do arquivo):

```ts
describe("decideUpdate — cota", () => {
  const same = { trRaw: 0.1709, poupRaw: 0.6734 }; // indexers iguais ao makeOld
  const oficial = "https://caixanoticias.caixa.gov.br/y";

  it("cota null mantém old.cotaMaxima e não marca changed", () => {
    const r = decideUpdate(makeOld(), parsed, same, null, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.cotaMaxima).toEqual(makeOld().cotaMaxima);
  });

  it("publica quando sac/price mudam (atualizadoEm e fonteUrl novos)", () => {
    const r = decideUpdate(
      makeOld(),
      parsed,
      same,
      { sac: 70, price: 60, fonteUrl: oficial },
      now,
      SOURCE,
    );
    expect(r.changed).toBe(true);
    expect(r.payload.cotaMaxima.sbpe).toEqual({ sac: 70, price: 60 });
    expect(r.payload.cotaMaxima.fonteUrl).toBe(oficial);
    expect(r.payload.cotaMaxima.atualizadoEm).toBe(now.toISOString());
  });

  it("cota implausível (price>sac) mantém old e não publica", () => {
    const r = decideUpdate(
      makeOld(),
      parsed,
      same,
      { sac: 70, price: 80, fonteUrl: oficial },
      now,
      SOURCE,
    );
    expect(r.changed).toBe(false);
    expect(r.payload.cotaMaxima).toEqual(makeOld().cotaMaxima);
  });

  it("cota de fonte não-oficial mantém old", () => {
    const r = decideUpdate(
      makeOld(),
      parsed,
      same,
      { sac: 75, price: 65, fonteUrl: "https://blog.com.br/x" },
      now,
      SOURCE,
    );
    expect(r.changed).toBe(false);
  });

  it("anti-churn: sac/price iguais com fonteUrl diferente NÃO publica", () => {
    const r = decideUpdate(
      makeOld(),
      parsed,
      same,
      { sac: 80, price: 70, fonteUrl: "https://caixanoticias.caixa.gov.br/OUTRA" },
      now,
      SOURCE,
    );
    expect(r.changed).toBe(false);
    expect(r.payload.cotaMaxima).toEqual(makeOld().cotaMaxima);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npm test`
Expected: FAIL — `decideUpdate` recebe 5 args mas chamadas passam 6 (erro de tipo/aridade) e o novo bloco falha.

- [ ] **Step 3: Implementar a mudança em `src/update.ts`**

Adicionar `cotaRaw` à assinatura (após `raw`) e a lógica da cota:

```ts
export function decideUpdate(
  old: RatesPayload,
  parsed: ParsedRates,
  raw: IndexersRaw,
  cotaRaw: CotaRaw | null,
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

  // Cota: só publica se plausível E o número (sac/price) mudou. fonteUrl varia entre runs
  // com o mesmo valor — comparar fonteUrl geraria commit semanal espúrio.
  let cotaMaxima = old.cotaMaxima;
  let cotaChanged = false;
  if (
    isCotaPlausible(cotaRaw) &&
    (cotaRaw.sac !== old.cotaMaxima.sbpe.sac || cotaRaw.price !== old.cotaMaxima.sbpe.price)
  ) {
    cotaChanged = true;
    cotaMaxima = {
      sbpe: { sac: cotaRaw.sac, price: cotaRaw.price },
      fonteUrl: cotaRaw.fonteUrl,
      atualizadoEm: now.toISOString(),
    };
  }

  const changed =
    old.meta.contentHash !== contentHash ||
    old.indexers.trMonthlyPct !== tr ||
    old.indexers.poupancaMonthlyPct !== poup ||
    cotaChanged;

  if (!changed) return { changed: false, payload: old };

  const payload: RatesPayload = {
    faixa2: parsed.faixa2,
    faixa3: parsed.faixa3,
    classeMedia: parsed.classeMedia,
    indexers: { trMonthlyPct: tr, poupancaMonthlyPct: poup },
    cotaMaxima,
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

- [ ] **Step 4: Conectar no `src/index.ts`**

Atualizar o import e o corpo de `main`:

```ts
// import:
import { fetchGovBrHtml, fetchIndexers, fetchCotaMaxima, SOURCE_URL } from "./sources";

// no main(), substituir o bloco de fetch dos indexadores + decideUpdate por:
  const [raw, cotaRaw] = await Promise.all([fetchIndexers(), fetchCotaMaxima()]);
  const { changed, payload } = decideUpdate(old, parsed, raw, cotaRaw, new Date(), SOURCE_URL);

// e no log de sucesso, acrescentar a cota:
  console.log(
    `[scrape] atualizado — publishedAt=${payload.meta.publishedAt} ` +
      `retrievedAt=${payload.meta.retrievedAt} ` +
      `tr=${payload.indexers.trMonthlyPct} poup=${payload.indexers.poupancaMonthlyPct} ` +
      `cota=SAC ${payload.cotaMaxima.sbpe.sac}%/Price ${payload.cotaMaxima.sbpe.price}%`,
  );
```

- [ ] **Step 5: Rodar para confirmar que passa**

Run: `npm test`
Expected: PASS (todos os blocos, incluindo cota).

- [ ] **Step 6: Commit**

```bash
git add src/update.ts src/index.ts test/update.test.ts
git commit -m "feat(update): integra cota no decideUpdate + wiring no index"
```

---

### Task 6: CI + `.env.example`

Passa a chave ao passo de scrape e documenta a variável.

**Files:**
- Modify: `.github/workflows/update-rates.yml`
- Create/Modify: `.env.example`

- [ ] **Step 1: Adicionar `env` ao passo de scrape**

Em `.github/workflows/update-rates.yml`, no step "Raspar fontes e atualizar JSON se mudou":

```yaml
      - name: Raspar fontes e atualizar JSON se mudou
        run: npm run scrape
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

- [ ] **Step 2: Documentar a chave em `.env.example`**

Criar (ou acrescentar a) `.env.example` na raiz:

```
# Chave do OpenRouter para extração da cota máxima (web search + LLM).
# Sem ela, o scrape roda normalmente e apenas preserva a cota anterior.
OPENROUTER_API_KEY=
# Opcionais — trocar modelo/endpoint sem mexer no código:
# OPENROUTER_MODEL=openai/gpt-4o-mini
# OPENROUTER_BASE=https://openrouter.ai/api/v1
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/update-rates.yml .env.example
git commit -m "ci: passa OPENROUTER_API_KEY ao scrape + .env.example"
```

---

### Task 7: Verificação do scrape real + docs

Roda o scraper de verdade com a chave para confirmar a extração end-to-end, e atualiza a documentação.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Rodar o scrape real com a chave (verificação manual)**

Run (PowerShell, chave vinda do amiz-os — não commitar):
```powershell
$env:OPENROUTER_API_KEY = (Select-String -Path "d:\Projetos Claude\amiz-os\apps\api\.env" -Pattern 'OPENROUTER_API_KEY="?([^"\r\n]+)"?').Matches[0].Groups[1].Value
npm run scrape
```
Expected: log `[scrape] unchanged` (cota já é 80/70 no seed e taxas iguais) OU um update com
`cota=SAC 80%/Price 70%`. **NÃO** deve dar erro fatal. Confirmar que `git diff data/` não
introduz fonteUrl de blog nem valores fora de 80/70.

- [ ] **Step 2: Atualizar `CLAUDE.md`**

Na seção "Como funciona", acrescentar a cota; na seção "Contrato", citar o campo novo; em
"Regras", a guarda da cota. Texto a inserir em "Como funciona" (após o bullet do `src/index.ts`):

```markdown
- A cota máxima SBPE (`cotaMaxima`, SAC/Price) é extraída por LLM via OpenRouter (web search) em
  `src/sources.ts:fetchCotaMaxima`. Guarda anti-lixo (`src/update.ts:isCotaPlausible`): só publica
  se plausível (30–100, price≤sac) e de domínio oficial `gov.br`. Sem `OPENROUTER_API_KEY`, o
  scrape preserva a cota anterior. Requer o secret `OPENROUTER_API_KEY` no repo.
```

- [ ] **Step 3: Atualizar `README.md`**

Acrescentar `cotaMaxima` à descrição do payload / exemplo de consumo (uma linha citando
`cotaMaxima.sbpe.sac` / `.price` como o % máximo de financiamento SBPE).

- [ ] **Step 4: Rodar testes finais**

Run: `npm test`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: cotaMaxima no contrato e no fluxo (CLAUDE.md, README)"
```

---

## Notas de execução
- **Segredo:** a chave do OpenRouter vem de `d:\Projetos Claude\amiz-os\apps\api\.env`. Usar só
  via env em runtime — **nunca** escrever em arquivo commitado.
- **Ordem importa:** Task 1 mantém a árvore verde antes das mudanças de assinatura (Task 5).
- **Custo:** ~$0.0055 por run (dominado pelo web search Exa). 1×/semana.
