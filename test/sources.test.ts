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
