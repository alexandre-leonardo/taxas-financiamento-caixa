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
