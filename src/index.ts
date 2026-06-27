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
